import { useEffect, useId, useRef, useState } from 'react'

import { overflowButtonClass, overflowMutedButtonClass } from '../styles.ts'

/**
 * One entry in a `···` menu. A separator is an entry rather than a prop on the
 * item after it, so the caller can group moves without every item having to
 * know where it sits in the list.
 */
export type OverflowItem =
  | { kind: 'separator' }
  | {
      destructive?: boolean
      disabled?: boolean
      /** An external destination — the Linear issue, the pull request. */
      href: string
      label: string
    }
  | {
      destructive?: boolean
      disabled?: boolean
      label: string
      onSelect: () => void
    }

/**
 * A disabled button cannot take focus, so walking onto one would strand the
 * Handler: the first queued row's "Move up" is disabled, and the menu would
 * open with focus still on its trigger.
 */
const enabledItem = '[role="menuitem"]:not([disabled])'

const isSeparator = (item: OverflowItem): item is { kind: 'separator' } =>
  'kind' in item

const itemClass = (destructive: boolean): string =>
  `flex w-full items-center whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${
    destructive
      ? 'text-red hover:bg-red/10'
      : 'text-ink-2 hover:bg-mint-soft/[0.06] hover:text-ink'
  }`

/**
 * Where everything that is not the primary, the one secondary or a destructive
 * action goes.
 *
 * The handoff's rule set only works if there is somewhere for the rest to
 * live: a Jobs row used to carry two identical outline buttons because every
 * state change had to be on the surface. They are all still reachable — the
 * point is that reaching them takes a deliberate click, and the row's own next
 * action is the only thing competing for the first one.
 *
 * Built rather than pulled in: the app has no headless-UI dependency, and a
 * menu is a button, a list and three key handlers. Roving focus lives on the
 * items themselves rather than in `aria-activedescendant`, so Enter on an item
 * is the browser's own click and needs no interpretation here.
 */
export function OverflowMenu({
  items,
  label,
  muted = false,
}: {
  items: OverflowItem[]
  /** What this menu is for, since `···` names nothing on its own. */
  label: string
  /** Borderless, for a row the list has already de-emphasised. */
  muted?: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const actionable = items.filter((item) => !isSeparator(item))

  /**
   * Closed by anything that means "not this menu": a pointer somewhere else,
   * Escape, or the focus leaving the wrapper — which is what Tab does, and
   * what a screen reader's own navigation does.
   */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (wrapper.current?.contains(event.target) === true) return
      setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Opening a menu puts the Handler in it. Without this the first arrow press
  // would be swallowed moving focus off the trigger.
  useEffect(() => {
    if (!open) return
    wrapper.current?.querySelector<HTMLElement>(enabledItem)?.focus()
  }, [open])

  /** Up and down walk the items; Home and End jump, as a menu is expected to. */
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(enabledItem),
    )
    if (focusable.length === 0) return

    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const go = (index: number) => {
      event.preventDefault()
      focusable[(index + focusable.length) % focusable.length]?.focus()
    }

    if (event.key === 'ArrowDown') go(current + 1)
    if (event.key === 'ArrowUp') go(current - 1)
    if (event.key === 'Home') go(0)
    if (event.key === 'End') go(focusable.length - 1)
  }

  if (actionable.length === 0) return null

  // Only a focus that lands somewhere else closes the menu. A null target is
  // a click on something unfocusable — Safari does not focus a button it
  // clicks — and the pointerdown handler already decides those.
  const onBlur = (event: React.FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && !event.currentTarget.contains(next)) {
      setOpen(false)
    }
  }

  /** Choosing puts focus back where the menu came from, not on `<body>`. */
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <span className="relative flex-none" onBlur={onBlur} ref={wrapper}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={muted ? overflowMutedButtonClass : overflowButtonClass}
        onClick={() => setOpen((was) => !was)}
        ref={trigger}
        type="button"
      >
        <span aria-hidden="true">···</span>
      </button>

      {open ? (
        <div
          aria-label={label}
          className="absolute right-0 top-[calc(100%+6px)] z-30 flex min-w-[210px] flex-col gap-0.5 rounded-xl border border-line-strong bg-raised p-1.5 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)]"
          id={menuId}
          onKeyDown={onMenuKeyDown}
          role="menu"
        >
          {items.map((item, index) => {
            if (isSeparator(item)) {
              return (
                <span
                  aria-hidden="true"
                  className="my-1 h-px bg-line"
                  key={`separator-${index}`}
                />
              )
            }

            const destructive = item.destructive === true

            if ('href' in item) {
              return (
                <a
                  className={itemClass(destructive)}
                  href={item.href}
                  key={`${index}-${item.label}`}
                  onClick={close}
                  rel="noreferrer"
                  role="menuitem"
                  tabIndex={-1}
                  target="_blank"
                >
                  {item.label}
                </a>
              )
            }

            return (
              <button
                className={itemClass(destructive)}
                disabled={item.disabled === true}
                key={`${index}-${item.label}`}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
                role="menuitem"
                tabIndex={-1}
                type="button"
              >
                {item.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </span>
  )
}
