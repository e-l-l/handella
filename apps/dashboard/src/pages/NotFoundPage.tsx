import { Link } from 'react-router'

import { primaryButtonClass } from '../styles.ts'

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
        404
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        That room is not in the house yet.
      </h1>
      <Link className={`mt-7 inline-flex ${primaryButtonClass}`} to="/">
        Back to the inbox
      </Link>
    </section>
  )
}
