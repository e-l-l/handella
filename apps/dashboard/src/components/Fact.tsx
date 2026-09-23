/**
 * A rail row: what the machine was asked on the left, what it decided on the
 * right. Every rail card on every screen is a list of these, so the pair is
 * one component rather than one per page.
 *
 * `mono` rather than always mono: a branch name, a sandbox and a path are
 * strings the machine will take literally and are shown literally, but "Assigned
 * to you in Linear" is a sentence and mono makes a sentence look like data.
 */
export function Fact({
  label,
  mono = false,
  tone = 'text-ink-2',
  value,
}: {
  label: string
  mono?: boolean
  /** The value's colour, for a count or a connection that is itself news. */
  tone?: string
  value: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <dt className="flex-none text-ink-4">{label}</dt>
      <dd className={`min-w-0 text-right ${tone} ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
