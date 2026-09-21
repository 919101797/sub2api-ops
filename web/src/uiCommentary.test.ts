import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageSources = import.meta.glob('./pages/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const componentSources = import.meta.glob('./components/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const rootSources = import.meta.glob(['./App.tsx', './main.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sourceEntries = Object.entries({ ...pageSources, ...componentSources })
const styles = readFileSync('web/src/styles/motion.css', 'utf8')

describe('console UI commentary', () => {
  it('does not render decorative eyebrow labels or the legacy PageHeading commentary API', () => {
    for (const [file, source] of sourceEntries) {
      expect(source, file).not.toContain('className="eyebrow"')
      expect(source, file).not.toMatch(/\beyebrow=/)
    }

    expect(componentSources['./components/ui.tsx']).not.toMatch(/\bdescription\??:/)
  })

  it('removes the repeated explanatory copy called out in the operations modules', () => {
    const repeatedCommentary = [
      '用图表先判断周限压力与容量差异',
      '与上游 OpenAI 周限和 sub2api standard cost 保持同步',
      '越靠近 100%，越需要留意新周期和容量写入',
      '整周期容量扣除预留量后，再按份数平分',
      '手动执行和定时运行共用同一套幂等与安全逻辑',
      '查看账号解析、当前周窗口以及实际写入的目标分组',
      '从新到旧保留检测、计算、写入与身份事件',
      '维护账号、同步策略、审计留存与服务器存储',
    ]

    const allSources = sourceEntries.map(([, source]) => source).join('\n')
    for (const copy of repeatedCommentary) expect(allSources).not.toContain(copy)
  })

  it('keeps dynamic status, safety and failure feedback', () => {
    expect(pageSources['./pages/OverviewPage.tsx']).toContain('数据生成于')
    expect(pageSources['./pages/ActivityPage.tsx']).toContain('最多保留 500 条')
    expect(pageSources['./pages/LoginPage.tsx']).toContain('6 位代码')
    expect(componentSources['./components/ui.tsx']).toContain('role="alert"')
  })

  it('keeps dashboard polling foreground-only and prompt audit explicitly queried', () => {
    expect(rootSources['./App.tsx']).toContain('refetchInterval: 60_000')
    expect(rootSources['./App.tsx']).toContain('refetchIntervalInBackground: false')
    expect(pageSources['./pages/InputHealthPage.tsx']).not.toContain('refetchInterval:')
    expect(pageSources['./pages/InputHealthPage.tsx']).toContain('aria-label="查询审计记录"')
    expect(rootSources['./main.tsx']).toContain('refetchOnWindowFocus: false')
  })

  it('场景-008-15：减少动态效果时所有组件取消连续动画和位移', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('animation-duration: .01ms !important')
    expect(styles).toContain('scroll-behavior: auto !important')
  })
})
