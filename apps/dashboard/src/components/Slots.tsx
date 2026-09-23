import { maxConcurrency } from '../jobViews.ts'

/**
 * How much of the machine is busy, as one dot per Slot.
 *
 * Two sizes because the handoff draws the same fact twice and means something
 * slightly different each time: 6px round dots in the nav, where this is
 * ambient and must not look pressable, and 8px full-width segments in Home's
 * Capacity card, where it is the subject of the card.
 *
 * The empty segment is `--control-alt` rather than a dimmed mint: a free slot
 * is not a faint version of a busy one, it is a different fact.
 */
export function Slots({
  used,
  variant,
}: {
  used: number
  variant: 'nav' | 'card'
}) {
  const nav = variant === 'nav'

  return (
    <span className={nav ? 'flex items-center gap-1' : 'flex gap-1.5'}>
      {Array.from({ length: maxConcurrency }, (_, slot) => (
        <span
          className={`${
            nav ? 'size-1.5 rounded-full' : 'h-2 flex-1 rounded-full'
          } ${slot < used ? 'bg-mint' : 'bg-control-alt'}`}
          key={slot}
        />
      ))}
    </span>
  )
}
