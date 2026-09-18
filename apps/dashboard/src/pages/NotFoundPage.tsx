import { Link } from 'react-router'

import { primaryButtonClass } from '../styles.ts'

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-7 py-24 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-mint-soft">
        404
      </p>
      <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.4px]">
        That room is not in the house yet.
      </h1>
      <Link className={`mt-7 inline-flex ${primaryButtonClass}`} to="/">
        Back to the inbox
      </Link>
    </section>
  )
}
