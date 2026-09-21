import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SelectionIndicator, SelectionRail } from './SelectionRail'

function Picker({ name }: { name: string }) {
  const [value, setValue] = useState('今天')
  return (
    <SelectionRail role="group" aria-label={name}>
      {['今天', '最近七天', '本周期'].map((label) => (
        <button key={label} aria-pressed={value === label} onClick={() => setValue(label)}>
          <SelectionIndicator active={value === label} />
          {label}
        </button>
      ))}
    </SelectionRail>
  )
}
afterEach(cleanup)
it('场景-008-21：快速选择最后一项，两组控件保持独立选中状态', () => {
  render(
    <>
      <Picker name="用量" />
      <Picker name="审计" />
    </>,
  )
  const usage = screen.getByRole('group', { name: '用量' })
  for (const name of ['最近七天', '今天', '本周期']) fireEvent.click(within(usage).getByRole('button', { name }))
  expect(within(usage).getByRole('button', { name: '本周期' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(screen.getByRole('group', { name: '审计' })).getByRole('button', { name: '今天' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(usage.querySelector('button[aria-pressed="true"] .selection-indicator')).not.toBeNull()
})
