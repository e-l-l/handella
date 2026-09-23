import type { ReactNode } from 'react'

import { tagClass, tagSmallClass } from '../styles.ts'

/**
 * What the handoff's palette means, named by meaning rather than by hue: mint
 * has finished or is healthy, amber is waiting on the Handler, red has failed,
 * and `neutral` is a fact that carries no state at all — a work class, a base
 * branch, a session that has not started.
 *
 * `mintDim` is the same mint one step down, for a row the Jobs list has
 * already de-emphasised: a job merged four hours ago is still a success, and
 * should not shout it at the same volume as one that needs reading now.
 */
export type Tone = 'amber' | 'mint' | 'mintDim' | 'neutral' | 'red'

const toneClasses: Record<Tone, string> = {
  amber: 'bg-amber/[0.14] text-amber-ink',
  mint: 'bg-mint/[0.14] text-mint-soft',
  mintDim: 'bg-mint/10 text-mint-dim',
  neutral: 'bg-control-alt text-ink-3',
  red: 'bg-red/[0.16] text-red-ink',
}

const dotClasses: Record<Tone, string> = {
  amber: 'bg-amber',
  mint: 'bg-mint',
  mintDim: 'bg-mint-dim',
  neutral: 'bg-ink-5',
  red: 'bg-red',
}

/** The 6–7px status dot, which always accompanies a word rather than replacing it. */
export function Dot({
  className = 'size-[7px]',
  tone,
}: {
  className?: string
  tone: Tone
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block flex-none rounded-full ${dotClasses[tone]} ${className}`}
    />
  )
}

/**
 * A fact about something, drawn as a small uppercase mono rectangle.
 *
 * Deliberately not a pill and deliberately without a hover state: the handoff's
 * whole diagnosis of "I get confused about where I have to click" is that
 * status chips and buttons were the same shape in the same greens. A tag is
 * therefore a `span` with no interaction of any kind, and there is no prop that
 * would let a caller make one pressable — something pressable is a button.
 */
export function Tag({
  children,
  className = '',
  dot = false,
  small = false,
  tone = 'neutral',
}: {
  children: ReactNode
  className?: string
  dot?: boolean
  /** For a tag inside a card heading rather than beside a row title. */
  small?: boolean
  tone?: Tone
}) {
  return (
    <span
      className={`${small ? tagSmallClass : tagClass} ${toneClasses[tone]} ${className}`}
    >
      {dot ? <Dot className="size-1.5" tone={tone} /> : null}
      {children}
    </span>
  )
}
