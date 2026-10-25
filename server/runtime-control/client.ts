import { request } from 'node:http'
import type { RuntimeSettingsInput, RuntimeSettingsStatus } from '../../shared/runtime-settings.js'

export class RuntimeControlError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
export class RuntimeControlClient {
  constructor(private readonly socketPath = '/runtime-control/control.sock') {}
  status() { return this.call('GET') }
  apply(input: RuntimeSettingsInput & { actor: string }) { return this.call('POST', input) }
  private call(method: string, input?: RuntimeSettingsInput & { actor: string }): Promise<RuntimeSettingsStatus> {
    return new Promise((resolve, reject) => {
      const unavailable = () => new RuntimeControlError('运行参数控制服务暂时不可用，请检查宿主机服务', 503)
      const payload = input ? JSON.stringify(input) : undefined
      const req = request({ socketPath: this.socketPath, path: '/settings', method,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      }, (response) => {
        let data = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          data += chunk
          if (data.length > 65_536) req.destroy(unavailable())
        })
        response.on('error', () => reject(unavailable()))
        response.on('end', () => {
          try {
            const result = JSON.parse(data) as RuntimeSettingsStatus & { error?: string }
            if (response.statusCode === 200 || response.statusCode === 202) resolve(result)
            else if ([400, 409, 422].includes(response.statusCode ?? 0)) reject(new RuntimeControlError(result.error ?? '参数校验失败', response.statusCode!))
            else reject(unavailable())
          } catch { reject(unavailable()) }
        })
      })
      req.setTimeout(6_000, () => req.destroy(unavailable()))
      req.on('error', () => reject(unavailable()))
      req.end(payload)
    })
  }
}
