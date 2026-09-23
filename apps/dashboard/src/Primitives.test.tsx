import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './components/ConfirmDialog.tsx'
import { OverflowMenu } from './components/OverflowMenu.tsx'
import { Tabs } from './components/Tabs.tsx'

/**
 * The hand-rolled interactive pieces, driven by keyboard the way the app
 * cannot be driven through its screens: each of these was verified by hand in
 * a browser once, and a regression in any of them is invisible to a pointer.
 */

describe('the overflow menu', () => {
  const renderMenu = (onMove = vi.fn()) =>
    render(
      <>
        <OverflowMenu
          items={[
            { disabled: true, label: 'Move up', onSelect: vi.fn() },
            { label: 'Move down', onSelect: onMove },
            { kind: 'separator' },
            { label: 'Cancel job', onSelect: vi.fn() },
          ]}
          label="More actions"
        />
        <button type="button">Next row</button>
      </>,
    )

  it('opens on the first item it can focus, skipping a disabled one', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))

    expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveFocus()
  })

  it('walks only the enabled items with the arrow keys and Home/End', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Cancel job' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Cancel job' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveFocus()
  })

  it('closes on Escape and hands focus back to its trigger', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'More actions' })
    await userEvent.click(trigger)

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('closes when a pointer goes down somewhere else', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))

    await userEvent.click(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes when Tab takes focus out of it', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))

    await userEvent.tab()

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next row' })).toHaveFocus()
  })

  it('runs the chosen item and returns focus to the trigger', async () => {
    const onMove = vi.fn()
    renderMenu(onMove)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    await userEvent.click(trigger)

    await userEvent.keyboard('{Enter}')

    expect(onMove).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})

describe('the tabs', () => {
  const options = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'plan', label: 'Plan' },
    { id: 'logs', label: 'Logs' },
  ] as const

  function Harness() {
    const [value, setValue] =
      useState<(typeof options)[number]['id']>('timeline')
    return (
      <Tabs
        label="Job views"
        onChoose={setValue}
        options={options}
        panelId="panel"
        value={value}
      >
        {value} panel
      </Tabs>
    )
  }

  it('moves focus along with the selection on the arrow keys', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }))

    await userEvent.keyboard('{ArrowRight}')
    const plan = screen.getByRole('tab', { name: 'Plan' })
    expect(plan).toHaveAttribute('aria-selected', 'true')
    expect(plan).toHaveFocus()

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveFocus()
  })

  it('jumps to either end on Home and End', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }))

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveFocus()
  })

  it('labels the panel by the tab that is showing it', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }))

    expect(screen.getByRole('tabpanel', { name: 'Plan' })).toHaveTextContent(
      'plan panel',
    )
  })
})

describe('the confirm dialog', () => {
  function Harness({
    onConfirm = vi.fn(),
    pending = false,
  }: {
    onConfirm?: () => void
    pending?: boolean
  }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)} type="button">
          Cancel this job
        </button>
        {open ? (
          <ConfirmDialog
            confirmLabel="Cancel job"
            consequence="Removes the worktree."
            onCancel={() => setOpen(false)}
            onConfirm={onConfirm}
            pending={pending}
            title="Cancel it?"
          />
        ) : null}
      </>
    )
  }

  it('opens on the button that leaves things alone', async () => {
    render(<Harness />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel this job' }),
    )

    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
  })

  it('keeps Tab inside the dialog', async () => {
    render(<Harness />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel this job' }),
    )

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Cancel job' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Cancel job' })).toHaveFocus()
  })

  it('pulls a focus that fell out of it back in on the next Tab', async () => {
    render(<Harness />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel this job' }),
    )

    await userEvent.click(screen.getByText('Removes the worktree.'))
    await userEvent.tab()

    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
  })

  it('closes on Escape and gives focus back to what opened it', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Cancel this job' })
    await userEvent.click(opener)

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('stays up on Escape while its request is in flight', async () => {
    render(<Harness pending />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel this job' }),
    )

    await userEvent.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
