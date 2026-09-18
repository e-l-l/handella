import type { ReactNode } from 'react'

/**
 * What the handoff's palette means, named by meaning rather than by hue: mint
 * has finished or is healthy, amber is waiting on the Handler, red has failed.
 * `solid` is the flat secondary fill routine work wears, `quiet` is a chip that
 * is only a label, and `outline` is machine text that should not read as state.
 */
export type Tone = 'amber' | 'mint' | 'outline' | 'quiet' | 'red' | 'solid'

const toneClasses: Record<Tone, string> = {
  amber: 'bg-amber/14 text-amber-ink',
  mint: 'bg-mint/16 text-mint-soft',
  outline: 'border border-line-strong text-ink-3',
  quiet: 'bg-raised text-ink-4',
  red: 'bg-red/14 text-red-ink',
  solid: 'bg-secondary text-mint-soft',
}

const dotClasses: Record<Tone, string> = {
  amber: 'bg-amber',
  mint: 'bg-mint',
  outline: 'bg-ink-5',
  quiet: 'bg-ink-5',
  red: 'bg-red',
  solid: 'bg-mint',
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

export function Chip({
  children,
  className = '',
  dot = false,
  mono = false,
  tone = 'quiet',
}: {
  children: ReactNode
  className?: string
  dot?: boolean
  mono?: boolean
  tone?: Tone
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 ${
        mono ? 'font-mono text-[11px]' : 'text-[11.5px]'
      } ${toneClasses[tone]} ${className}`}
    >
      {dot ? <Dot className="size-1.5" tone={tone} /> : null}
      {children}
    </span>
  )
}
