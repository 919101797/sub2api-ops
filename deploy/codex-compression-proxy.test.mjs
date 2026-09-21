import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createGzip, gzipSync, zstdCompressSync, constants} from 'node:zlib';
import WebSocket, {WebSocketServer} from 'ws';
import {createCompressionProxy} from './codex-compression-proxy.mjs';

async function setup(t, handler, options = {}) {
  const upstream = http.createServer(handler);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const logs = [];
  const proxy = createCompressionProxy({upstream: `http://127.0.0.1:${upstream.address().port}`, log: x => logs.push(x), ...options});
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => {proxy.closeAllConnections(); upstream.closeAllConnections(); proxy.close(); upstream.close();});
  return {upstream, proxy, logs, url: `http://127.0.0.1:${proxy.address().port}`};
}

function request(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url + '/v1/responses', {method: 'POST', ...options, headers: {authorization: 'Bearer test-only', ...options.headers}}, resolve);
    req.on('error', reject); req.end(body);
  });
}
async function bodyOf(res) {const chunks = []; for await (const b of res) chunks.push(b); return Buffer.concat(chunks);}

test('场景-010-01：gzip SSE 即时输出且中文和工具事件字节一致', async t => {
  let release;
  const gate = new Promise(r => release = r);
  const first = 'data: {"type":"response.output_text.delta","delta":"你好"}\n\n';
  const last = 'data: {"type":"response.custom_tool_call_input.done","input":"printf OK"}\n\ndata: {"type":"response.completed"}\n\n';
  const {url, logs} = await setup(t, async (req, res) => {
    assert.equal(req.headers['accept-encoding'], 'gzip');
    res.writeHead(200, {'content-type': 'text/event-stream', 'content-encoding': 'gzip'});
    const zip = createGzip(); zip.pipe(res); zip.write(first); zip.flush(constants.Z_SYNC_FLUSH);
    await gate; zip.end(last);
  });
  const res = await request(url);
  assert.equal(res.headers['content-encoding'], undefined);
  const firstChunk = await Promise.race([once(res, 'data'), new Promise((_, reject) => setTimeout(() => reject(Error('SSE buffered')), 1500).unref())]);
  assert.equal(firstChunk[0].toString(), first);
  release();
  assert.equal(Buffer.concat([firstChunk[0], await bodyOf(res)]).toString(), first + last);
  assert.equal(logs[0].encoding, 'gzip');
  assert.ok(logs[0].decodedBytes > 0);
});

for (const [encoding, compress] of [['zstd', zstdCompressSync], ['gzip', gzipSync]]) {
  test(`场景-010-02：${encoding} 上传转换为带准确长度的审计正文`, async t => {
    const text = Buffer.from('{"input":[{"role":"user","content":"审计测试"}]}');
    const {url, logs} = await setup(t, async (req, res) => {
      assert.equal(req.headers['content-encoding'], undefined);
      assert.equal(req.headers['content-length'], String(text.length));
      assert.equal(req.headers.authorization, 'Bearer test-only');
      assert.deepEqual(await bodyOf(req), text); res.end('OK');
    });
    assert.equal((await bodyOf(await request(url, {headers: {'content-encoding': encoding}}, compress(text)))).toString(), 'OK');
    assert.ok(!JSON.stringify(logs).includes('test-only'));
    assert.ok(!JSON.stringify(logs).includes('审计测试'));
  });
}

test('场景-010-03：客户端取消立即关闭上游且不重试', async t => {
  let calls = 0, closed;
  const cancelled = new Promise(r => closed = r);
  const {url} = await setup(t, (req, res) => {
    calls++; res.writeHead(200, {'content-type': 'text/event-stream'}); res.write('data: {}\n\n'); res.on('close', closed);
  });
  const res = await request(url); await once(res, 'data'); res.destroy();
  await Promise.race([cancelled, new Promise((_, reject) => setTimeout(() => reject(Error('upstream still open')), 1500).unref())]);
  assert.equal(calls, 1);
});

test('场景-010-03：损坏 gzip 不能被转换为正常 EOF', async t => {
  const {url} = await setup(t, (req, res) => {
    res.writeHead(200, {'content-encoding': 'gzip'}); res.end(gzipSync('hello').subarray(0, 15));
  });
  await assert.rejects(async () => bodyOf(await request(url)));
});

test('场景-010-04：保留上游错误状态和原文', async t => {
  const {url} = await setup(t, (req, res) => {res.writeHead(429, {'retry-after': '10'}); res.end('rate limited');});
  const res = await request(url); assert.equal(res.statusCode, 429); assert.equal(res.headers['retry-after'], '10');
  assert.equal((await bodyOf(res)).toString(), 'rate limited');
});

test('场景-010-05：WebSocket 压缩协商和工具帧保持透明', async t => {
  const {url, upstream} = await setup(t, (req, res) => res.end());
  const wss = new WebSocketServer({server: upstream, perMessageDeflate: true});
  wss.on('connection', ws => ws.on('message', data => ws.send(data)));
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/v1/responses', {headers: {authorization: 'Bearer test-only'}, perMessageDeflate: true});
  t.after(() => {ws.terminate(); for (const c of wss.clients) c.terminate(); wss.close();});
  await once(ws, 'open'); assert.equal(ws.extensions, 'permessage-deflate');
  const message = once(ws, 'message'); ws.send('{"tool":"中文工具"}');
  assert.equal((await message)[0].toString(), '{"tool":"中文工具"}');
  ws.close(); await once(ws, 'close');
});

test('场景-010-06：拒绝跨站、错误 Host、无凭据和超限解压', async t => {
  let calls = 0;
  const {url} = await setup(t, (req, res) => {calls++;res.end();}, {maxBodyBytes: 32});
  for (const headers of [{origin: 'https://untrusted.example'}, {host: 'untrusted.example'}]) {
    const res = await request(url, {headers}); assert.equal(res.statusCode, 403); await bodyOf(res);
  }
  const unauth = await request(url, {headers: {authorization: ''}}); assert.equal(unauth.statusCode, 401); await bodyOf(unauth);
  const big = await request(url, {headers: {'content-encoding': 'gzip'}}, gzipSync('x'.repeat(100)));
  assert.equal(big.statusCode, 413); await bodyOf(big);
  assert.equal(calls, 0);
});
