import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import { destructiveOutlineButtonClass, quietButtonClass } from '../styles.ts'

/**
 * The confirmation a destructive action opens, which names the consequence
 * rather than asking "are you sure?".
 *
 * The handoff requires this for exactly two actions — cancelling a job and
 * removing a repository — and requires the sentence to say what happens to the
 * things the Handler will worry about: "Removes the worktree. The branch and
 * Linear issue are left alone." A dialog that only asked would make them go
 * and check.
 *
 * Rendered rather than delegated to `<dialog>`: the overlay, the focus trap and
 * the Escape handler are three lines each, and `showModal` puts the element in
 * the top layer where the app's own focus ring and palette no longer reach it.
 *
 * Portalled to `<body>` because a Jobs row opens it from inside a
 * `hidden lg:flex` span: rendered in place, narrowing the window would hide
 * the dialog while its Escape handler stayed live, and the dialog would sit
 * inside a list item in the accessibility tree.
 */
export function ConfirmDialog({
  confirmLabel,
  consequence,
  onCancel,
  onConfirm,
  pending = false,
  title,
}: {
  confirmLabel: string
  consequence: string
  onCancel: () => void
  onConfirm: () => void
  pending?: boolean
  title: string
}) {
  const titleId = useId()
  const bodyId = useId()
  const panel = useRef<HTMLDivElement>(null)

  // The cancelling button takes focus, not the confirming one: a Handler who
  // opened this by mistake should be one keypress from leaving it alone. On
  // close, focus goes back to whatever opened the dialog, and the page behind
  // stops scrolling while it is up.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('[data-dismiss]')?.focus()
    return () => {
      document.body.style.overflow = overflow
      if (opener?.isConnected === true) opener.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A request already in flight is not left behind by dismissing its
      // dialog: the Handler would get no word of how it ended.
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!pending) onCancel()
        return
      }
      if (event.key !== 'Tab') return

      // Kept inside the dialog, because everything behind it is inert to the
      // pointer and should be inert to the keyboard for the same reason.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled])',
      )
      if (focusable === undefined || focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      // Focus can fall out of the panel without a Tab — the confirm button
      // disabling itself while pending, or a click on the body text — and
      // the next Tab must not walk into the page behind.
      if (!(panel.current?.contains(document.activeElement) ?? false)) {
        event.preventDefault()
        first?.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, pending])

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div
        aria-describedby={bodyId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-2xl border border-red/[0.18] bg-raised p-5"
        ref={panel}
        role="dialog"
      >
        <h2 className="text-[15.5px] font-semibold" id={titleId}>
          {title}
        </h2>
        <p className="text-[13px] leading-[1.55] text-ink-4" id={bodyId}>
          {consequence}
        </p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            className={quietButtonClass}
            data-dismiss
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            Keep it
          </button>
          <button
            className={destructiveOutlineButtonClass}
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
