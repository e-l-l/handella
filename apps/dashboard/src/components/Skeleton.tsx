/**
 * The shape a card will take, held while its data is in flight: the handoff
 * asks for card-shaped skeletons at the same radii and no spinners inside
 * cards, so nothing moves when the answer lands.
 *
 * The caller passes the height and radius of the card being waited for, and
 * labels the group it puts these in — the label is what a screen reader is
 * told, and these blocks themselves say nothing.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pulse-soft border border-line bg-raised ${className}`}
    />
  )
}

/**
 * A list of them under one label. Every screen that waits on a list wants the
 * same `role="status"` wrapper, and spelling it per screen is one screen away
 * from a loading state a screen reader never hears about.
 */
export function SkeletonList({
  className,
  count,
  label,
  wrapperClassName,
}: {
  className: string
  count: number
  label: string
  wrapperClassName: string
}) {
  return (
    <div aria-label={label} className={wrapperClassName} role="status">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton className={className} key={index} />
      ))}
    </div>
  )
}
