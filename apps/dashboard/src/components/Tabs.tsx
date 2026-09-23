import { useRef, type ReactNode } from 'react'

const tabId = (panelId: string, id: string): string => `${panelId}-tab-${id}`

/**
 * The job page's tabs, underlined rather than pilled.
 *
 * The distinction matters here more than anywhere: the job page already has a
 * primary action in its state banner, and a row of pills directly beneath it
 * would read as four more buttons competing with it. An underline says "these
 * are views of the thing you are looking at".
 */
export function Tabs<Id extends string>({
  children,
  label,
  onChoose,
  options,
  panelId,
  value,
}: {
  /** The active tab's panel, labelled by that tab. */
  children: ReactNode
  label: string
  onChoose: (id: Id) => void
  options: readonly { id: Id; label: string }[]
  /** The panel these tabs switch, so a reader is told what moved. */
  panelId: string
  value: Id
}) {
  const buttons = useRef(new Map<Id, HTMLButtonElement>())

  /**
   * Left and right walk the tabs and Home and End jump, which is what a
   * tablist is expected to do. Focus moves with the selection: the tab left
   * behind has `tabIndex=-1`, and a focus ring stranded on it would announce
   * nothing.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.id === value)
    const go = (next: number) => {
      event.preventDefault()
      const option = options[(next + options.length) % options.length]
      if (option === undefined) return
      onChoose(option.id)
      buttons.current.get(option.id)?.focus()
    }

    if (event.key === 'ArrowRight') go(index + 1)
    if (event.key === 'ArrowLeft') go(index - 1)
    if (event.key === 'Home') go(0)
    if (event.key === 'End') go(options.length - 1)
  }

  return (
    <>
      <div
        aria-label={label}
        className="flex gap-[22px] overflow-x-auto border-b border-line"
        onKeyDown={onKeyDown}
        role="tablist"
      >
        {options.map((option) => {
          const active = option.id === value
          return (
            <button
              aria-controls={panelId}
              aria-selected={active}
              id={tabId(panelId, option.id)}
              className={`whitespace-nowrap border-b-2 px-0.5 pb-[11px] text-[14px] ${
                active
                  ? 'border-mint font-[550] text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink-2'
              }`}
              key={option.id}
              onClick={() => onChoose(option.id)}
              ref={(element) => {
                if (element === null) buttons.current.delete(option.id)
                else buttons.current.set(option.id, element)
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <div
        aria-labelledby={tabId(panelId, value)}
        aria-live="off"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </>
  )
}
