import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityPage } from './ActivityPage'
import { dashboardFixture } from '@/test/fixtures'
afterEach(cleanup)
describe('ActivityPage', () => {
  it('场景-008-10：组合关键词、类别与关注筛选，并可恢复空结果', () => {
    render(<ActivityPage dashboard={dashboardFixture()} />)
    fireEvent.change(screen.getByLabelText('活动类别'), { target: { value: 'capacity' } })
    expect(screen.getByText('主力账号容量已同步，预留 10% 后更新分组周限。')).toBeInTheDocument()
    expect(screen.queryByText('管理员更新了容量分配策略。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '需要关注' }))
    expect(screen.getByText('没有匹配的活动')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清空筛选' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索活动' }), { target: { value: '配置' } })
    expect(screen.getByText('管理员更新了容量分配策略。')).toBeInTheDocument()
    expect(screen.queryByText('主力账号容量已同步，预留 10% 后更新分组周限。')).not.toBeInTheDocument()
  })
  it('场景-008-11：只在管理员展开时显示决策证据', () => {
    render(<ActivityPage dashboard={dashboardFixture()} />)
    expect(screen.queryByText(/estimatedCapacityUsd/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '决策证据' }))
    expect(screen.getByText(/estimatedCapacityUsd/)).toBeVisible()
    expect(screen.getByRole('button', { name: '决策证据' })).toHaveAttribute('aria-expanded', 'true')
  })
})
