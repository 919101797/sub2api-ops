import { createServer } from 'node:http'

const accounts = {
  'primary@example.com': { id: 5, name: 'primary@example.com', status: 'active', proxy_id: 12, proxy: { id: 12, name: '示例代理 A', status: 'active', protocol: 'socks5h', host: '192.0.2.10', port: 1080, expires_at: null } },
  'secondary@example.com': { id: 8, name: 'secondary@example.com', status: 'active', proxy_id: 11, proxy: { id: 11, name: '示例代理 B', status: 'active', protocol: 'socks5h', host: '198.51.100.20', port: 1080, expires_at: null } },
}
const quotas = {
  5: { used_percent: 25, reset_at: 1_786_953_600 },
  8: { used_percent: 50, reset_at: 1_786_960_800 },
}
const costs = { 5: 100, 8: 200 }
const groupNames = {
  5: '示例分组 A-审核',
  6: 'Standard 分组',
  10: '示例测试分组',
  11: 'GPT-5.3-Codex-Spark',
  13: '示例分组 A-普通',
  14: '示例分组 B-审核',
  15: '示例分组 B-普通',
  16: '示例标准分组 B',
}

function send(response, data, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? 'success' : 'error', data }))
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:9090')
  const path = url.pathname.replace(/^\/api\/v1/, '')
  if (path === '/settings/public') return send(response, { site_name: 'Sub2API QA', turnstile_enabled: false, turnstile_site_key: '' })
  if (path === '/auth/login' || path === '/auth/login/2fa') return send(response, { access_token: 'qa-access', refresh_token: 'qa-refresh', expires_in: 3600, token_type: 'Bearer', user: { id: 1, email: 'admin@example.com', username: 'operator', role: 'admin', status: 'active' } })
  if (path === '/auth/me') return send(response, { id: 1, email: 'admin@example.com', username: 'operator', role: 'admin', status: 'active' })
  if (path === '/auth/refresh') return send(response, { access_token: 'qa-access', refresh_token: 'qa-refresh', expires_in: 3600, token_type: 'Bearer' })
  if (path === '/auth/logout') return send(response, { message: 'ok' })
  if (path === '/admin/accounts') {
    const search = url.searchParams.get('search')
    const listedAccounts = search ? [accounts[search]].filter(Boolean) : Object.values(accounts)
    return send(response, { items: listedAccounts, total: listedAccounts.length, page: 1, page_size: 100, pages: 1 })
  }
  const quota = path.match(/^\/admin\/openai\/accounts\/(\d+)\/quota$/)
  if (quota) return send(response, { rate_limit: { primary_window: quotas[quota[1]] }, fetched_at: Math.floor(Date.now() / 1000) })
  const usage = path.match(/^\/admin\/accounts\/(\d+)\/usage$/)
  if (usage) return send(response, { seven_day: { utilization: quotas[usage[1]].used_percent, resets_at: new Date(quotas[usage[1]].reset_at * 1000).toISOString(), window_stats: { standard_cost: costs[usage[1]] } } })
  if (path === '/admin/subscriptions') return send(response, { items: [
    { id: 101, group_id: 5, status: 'active' }, { id: 102, group_id: 13, status: 'active' },
    { id: 103, group_id: 14, status: 'active' }, { id: 104, group_id: 15, status: 'active' },
  ], total: 4, page: 1, page_size: 100, pages: 1 })
  if (path === '/admin/groups') {
    const groups = Object.entries(groupNames).map(([id, name]) => ({ id: Number(id), name, rate_multiplier: 1, daily_limit_usd: null, weekly_limit_usd: id === '10' ? 0 : 500, monthly_limit_usd: null }))
    return send(response, { items: groups, total: groups.length, page: 1, page_size: 100, pages: 1 })
  }
  const group = path.match(/^\/admin\/groups\/(\d+)$/)
  if (group) return send(response, { id: Number(group[1]), name: groupNames[group[1]], rate_multiplier: 1, daily_limit_usd: null, weekly_limit_usd: 500, monthly_limit_usd: null })
  if (/^\/admin\/subscriptions\/\d+\/reset-quota$/.test(path)) return send(response, { ok: true })
  return send(response, null, 404)
}).listen(9090, '127.0.0.1', () => console.log('mock upstream on 9090'))
