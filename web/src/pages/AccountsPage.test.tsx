import { cleanup, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { AccountsPage } from './AccountsPage'
import { dashboardFixture } from '@/test/fixtures'
afterEach(cleanup)
it('场景-003-08/10：显示各账号的再均分开关、已追加轮数和剩余估值', () => {
  const dashboard = dashboardFixture()
  dashboard.config.accounts[0]!.redistributionEnabled = true
  dashboard.accounts[0]!.redistribution = { resetAt: 2000000000, rounds: 2, totalAddedPerShareUsd: 250, remainingUsd: 300,
    status: 'updated', message: '第 2 轮已完成，每份追加 $100.00', limits: [], lastTriggerUsage: {} }
  render(<BrowserRouter><AccountsPage dashboard={dashboard} /></BrowserRouter>)
  expect(screen.getByText('第 2 轮已完成，每份追加 $100.00')).toBeInTheDocument()
  expect(screen.getByText('2 轮')).toBeInTheDocument()
  expect(screen.getByText('再均分已开启')).toBeInTheDocument()
  expect(screen.getByText('再均分已关闭')).toBeInTheDocument()
})
