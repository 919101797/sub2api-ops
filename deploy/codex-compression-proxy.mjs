import http from 'node:http';
import https from 'node:https';
import {pipeline, Transform} from 'node:stream';
import {promisify} from 'node:util';
import {gunzip, zstdDecompress, createGunzip, createBrotliDecompress, createZstdDecompress} from 'node:zlib';
import {pathToFileURL} from 'node:url';

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function cleanHeaders(input) {
  const headers = {...input};
  for (const name of [...hopHeaders, ...String(input.connection || '').toLowerCase().split(',').map(x => x.trim())]) delete headers[name];
  return headers;
}
function reject(res, status) {res.writeHead(status, {'content-type': 'application/json', connection: 'close'}); res.end(JSON.stringify({error: {message: http.STATUS_CODES[status]}}));}

// 不保存凭据，不改变请求 JSON；传输交给 Node 的 HTTP/TLS/zlib 与流背压。
export function createCompressionProxy({upstream, maxBodyBytes = 100 * 1024 * 1024, log = () => {}}) {
  const origin = new URL(upstream);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/') throw Error('upstream must be an origin without credentials');
  const transport = origin.protocol === 'https:' ? https : http;
  const allowed = req => !req.headers.origin && /^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '') && /^\/v1\//.test(req.url || '') && !req.url.includes('\\');
  const authorized = req => !!(req.headers.authorization || req.headers['x-api-key']);
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && !req.headers.origin && /^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) {res.end('{"status":"ok"}'); return;}
    if (!allowed(req)) {reject(res, 403); return;}
    if (!authorized(req)) {reject(res, 401); return;}
    const started = Date.now();
    let body;
    try {
      if (Number(req.headers['content-length'] || 0) > maxBodyBytes) {reject(res, 413); return;}
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({destroyOnReturn: false})) {
        size += chunk.length; if (size > maxBodyBytes) throw Object.assign(Error('body limit'), {code: 'ERR_BUFFER_TOO_LARGE'});
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
      const encoding = req.headers['content-encoding'];
      if (encoding === 'gzip') body = await promisify(gunzip)(body, {maxOutputLength: maxBodyBytes});
      else if (encoding === 'zstd') body = await promisify(zstdDecompress)(body, {maxOutputLength: maxBodyBytes});
      else if (encoding && encoding !== 'identity') {reject(res, 415); return;}
    } catch (error) {
      if (!res.destroyed) reject(res, error.code === 'ERR_BUFFER_TOO_LARGE' ? 413 : 400);
      req.resume(); return;
    }
    if (res.destroyed) return;
    const headers = cleanHeaders(req.headers);
    headers.host = origin.host; headers['accept-encoding'] = 'gzip';
    delete headers['content-encoding'];
    if (body.length || req.method === 'POST') headers['content-length'] = String(body.length); else delete headers['content-length'];
    const metrics = {protocol: 'http', path: req.url.split('?')[0], encoding: 'identity', wireBytes: 0, decodedBytes: 0};
    let upstreamResponse, recorded = false, clientClosed = false, transferError;
    const record = error => {
      if (recorded) return; recorded = true;
      const failure = transferError || (!clientClosed && error);
      log({...metrics, durationMs: Date.now() - started, result: failure ? 'transport_error' : clientClosed ? 'client_closed' : 'end', error: failure?.code});
    };
    const up = transport.request(origin, {path: req.url, method: req.method, headers}, response => {
      upstreamResponse = response;
      response.on('aborted', () => {if (!clientClosed) transferError = {code: 'UPSTREAM_ABORTED'};});
      metrics.status = response.statusCode; metrics.requestId = response.headers['x-request-id'];
      metrics.encoding = response.headers['content-encoding'] || 'identity';
      const decode = {'gzip': createGunzip, br: createBrotliDecompress, zstd: createZstdDecompress}[metrics.encoding];
      if (metrics.encoding !== 'identity' && !decode) {response.destroy(); reject(res, 502); record({code: 'UNSUPPORTED_ENCODING'}); return;}
      const outputHeaders = cleanHeaders(response.headers);
      delete outputHeaders['content-encoding']; delete outputHeaders['content-length'];
      res.writeHead(response.statusCode, outputHeaders); res.flushHeaders();
      const wire = new Transform({transform(chunk, encoding, cb) {metrics.wireBytes += chunk.length; cb(null, chunk);}});
      const plain = new Transform({transform(chunk, encoding, cb) {metrics.decodedBytes += chunk.length; cb(null, chunk);}});
      const decoder = decode?.();
      decoder?.on('error', error => {if (!clientClosed) transferError = error;});
      pipeline(response, wire, ...(decoder ? [decoder] : []), plain, res, record);
    });
    up.setTimeout(3600_000, () => up.destroy(Object.assign(Error('upstream idle'), {code: 'ETIMEDOUT'})));
    up.on('error', error => {
      record(error);
      if (!res.destroyed) {if (!res.headersSent) reject(res, 502); else res.destroy(error);}
    });
    res.on('close', () => {if (!res.writableFinished) {clientClosed = true; up.destroy(); upstreamResponse?.destroy();}});
    up.end(body);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req) || !authorized(req)) {socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;}
    const up = transport.request(origin, {path: req.url, headers: {...req.headers, host: origin.host}});
    let peer;
    socket.on('error', () => {up.destroy(); peer?.destroy();});
    socket.on('close', () => {up.destroy(); peer?.destroy();});
    up.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      peer = upstreamSocket;
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${response.rawHeaders.reduce((s, v, i, a) => i % 2 === 0 ? s + v + ': ' + a[i + 1] + '\r\n' : s, '')}\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      peer.on('error', () => socket.destroy()); peer.on('close', () => socket.destroy());
      socket.pipe(peer); peer.pipe(socket);
      log({protocol: 'websocket', status: response.statusCode, result: 'upgraded'});
    });
    up.on('response', response => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
      response.pipe(socket); response.on('error', () => socket.destroy());
    });
    up.on('error', () => socket.destroy());
    up.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const upstream = process.argv[2], port = Number(process.argv[3] || 18086);
  if (!upstream?.startsWith('https://') || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Usage: node codex-compression-proxy.mjs https://upstream-host [port]');
  const server = createCompressionProxy({upstream, log: x => process.stdout.write(JSON.stringify(x) + '\n')});
  server.listen(port, '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {server.close(); setTimeout(() => process.exit(0), 5000).unref();});
}
