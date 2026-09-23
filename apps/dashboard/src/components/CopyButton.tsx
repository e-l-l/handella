import { useEffect, useRef, useState } from 'react'

import { inlineChipButtonClass } from '../styles.ts'

/**
 * The affordance beside a truncated path.
 *
 * The job page shows a worktree path elided rather than in full — a hundred and
 * forty mono characters across the meta row was the old behaviour and it pushed
 * everything else off the line. Eliding it only works if there is a way to get
 * the whole thing back, and this is it.
 *
 * Bordered at 7px rather than tinted at 5px on purpose: 5px tinted rectangles
 * are facts in this design, and this one is pressable.
 */
export function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = () => {
    // Nothing to report on failure beyond the label not changing: the path is
    // on screen either way, and a clipboard a browser refuses is not an error
    // the Handler can act on.
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      },
      () => undefined,
    )
  }

  return (
    <button className={inlineChipButtonClass} onClick={copy} type="button">
      {copied ? 'Copied' : label}
    </button>
  )
}
