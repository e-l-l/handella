/**
 * A rail row: what the machine was asked on the left, what it decided on the
 * right. Every rail card on every screen is a list of these, so the pair is
 * one component rather than one per page.
 */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[12.5px]">
      <dt className="text-ink-4">{label}</dt>
      <dd className="truncate font-mono text-ink-2">{value}</dd>
    </div>
  )
}
