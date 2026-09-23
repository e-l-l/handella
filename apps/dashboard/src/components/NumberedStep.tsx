import type { ReactNode } from 'react'

/**
 * One of Intake's numbered steps.
 *
 * The number is the whole point: the dispatch panel used to be a stack of
 * unlabelled fields ending in two similar buttons, and a Handler reaching the
 * bottom could not tell whether they had finished filling it in. Three numbers
 * say how many decisions there are before the one button at the end.
 */
export function NumberedStep({
  children,
  label,
  step,
}: {
  children: ReactNode
  label: string
  step: number
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-[18px] flex-none place-items-center rounded-full bg-control-alt font-mono text-[10px] leading-none text-mint-soft"
        >
          {step}
        </span>
        <span className="text-[13px] font-[550] text-ink-2">{label}</span>
      </div>
      {children}
    </div>
  )
}
