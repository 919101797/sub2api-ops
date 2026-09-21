import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, Dialog } from './Dialog'
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
describe('Dialog', () => {
  it('场景-008-13：清空全部必须输入匹配文本，取消不提交', () => {
    vi.useFakeTimers()
    const confirm = vi.fn(),
      close = vi.fn()
    render(
      <ConfirmDialog
        title="删除审计"
        message="永久删除全部内容"
        confirmLabel="确认删除"
        confirmation="清空全部"
        onClose={close}
        onConfirm={confirm}
      />,
    )
    const button = screen.getByRole('button', { name: '确认删除' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('确认文本'), { target: { value: '清空' } })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('确认文本'), { target: { value: '清空全部' } })
    expect(button).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(confirm).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(close).toHaveBeenCalledOnce()
  })
  it('场景-008-14：焦点循环、Escape 退出并恢复触发点', () => {
    vi.useFakeTimers()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>打开详情</button>
          {open && (
            <Dialog title="详情" onClose={() => setOpen(false)}>
              <button>末尾操作</button>
            </Dialog>
          )}
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开详情' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: '末尾操作' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: '关闭详情' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
