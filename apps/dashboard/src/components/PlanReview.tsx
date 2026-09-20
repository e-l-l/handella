import type { Job, PlanVersion } from '@handella/contracts'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { approvePlan, requestPlanChanges, useJobRefresh } from '../api/jobs.ts'
import { planApprovalStateLabels } from '../labels.ts'
import {
  fieldClass,
  fieldLabelClass,
  insetClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../styles.ts'

const listClass = 'flex flex-col gap-1.5 text-[13px] text-ink-2'
const headingClass =
  'text-[12px] font-medium uppercase tracking-[0.6px] text-ink-5'

function Bullets({ items, title }: { items: string[]; title: string }) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h4 className={headingClass}>{title}</h4>
      <ul className={listClass}>
        {/* Keyed by position: these are the planner's sentences, and nothing
            stops it from listing the same risk twice. */}
        {items.map((item, index) => (
          <li className="flex gap-2" key={`${title}-${index}`}>
            <span aria-hidden className="text-ink-6">
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PlanBody({ version }: { version: PlanVersion }) {
  const { content } = version

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] leading-[1.55] text-ink">{content.summary}</p>

      <div className="flex flex-col gap-2">
        <h4 className={headingClass}>
          {content.steps.length} step{content.steps.length === 1 ? '' : 's'}
        </h4>
        <ol className="flex flex-col gap-2.5">
          {content.steps.map((step, index) => (
            <li className={insetClass} key={step.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[11.5px] text-ink-5">
                  {index + 1}
                </span>
                <span className="text-[13.5px] font-[450]">{step.title}</span>
                {/* Amber waits: an optional step is one the Handler may be
                    asked about later, not one that will simply happen. */}
                {step.required ? null : (
                  <span className="font-mono text-[11px] text-amber-ink">
                    optional
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.5] text-ink-2">
                {step.detail}
              </p>
              {step.files.length === 0 ? null : (
                <p className="mt-2 font-mono text-[11.5px] text-ink-5">
                  {step.files.join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      <Bullets items={content.verification} title="Verification" />
      <Bullets items={content.risks} title="Risks" />
      <Bullets items={content.outOfScope} title="Out of scope" />
    </div>
  )
}

/**
 * The plan, and the two answers it can get. Only the newest revision is
 * answerable — the service refuses an older one — so the older ones render as
 * history with the feedback that closed them.
 */
export function PlanReview({
  job,
  versions,
}: {
  job: Job
  versions: PlanVersion[]
}) {
  const [feedback, setFeedback] = useState('')
  const refresh = useJobRefresh()

  const latest = versions.at(-1)
  const earlier = versions.slice(0, -1)

  // The revision is the mutation's argument rather than something read from
  // the closure, so the call site is the one place that has to have narrowed
  // it — and it has, by the time any of this can be pressed.
  const approve = useMutation({
    mutationFn: (planVersionId: string) => approvePlan(job.id, planVersionId),
    onSettled: refresh,
  })
  const requestChanges = useMutation({
    mutationFn: (planVersionId: string) =>
      requestPlanChanges(job.id, planVersionId, feedback),
    onSuccess: () => setFeedback(''),
    onSettled: refresh,
  })

  if (latest === undefined) {
    return (
      <p className="text-[13px] text-ink-3">
        No plan has been captured for this job yet.
      </p>
    )
  }

  const pending = approve.isPending || requestChanges.isPending
  const answerable = job.state === 'planReview' && job.suspension === null
  const failure = approve.error ?? requestChanges.error

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[12px] text-mint-soft">
          v{latest.revision}
        </span>
        <span className="text-[13px] text-ink-3">
          {planApprovalStateLabels[latest.approvalState]}
        </span>
      </div>

      <PlanBody version={latest} />

      {answerable ? (
        <form
          aria-label="Answer the plan"
          className="flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            requestChanges.mutate(latest.id)
          }}
        >
          <label className={fieldLabelClass}>
            Ask for changes
            <textarea
              className={`${fieldClass} min-h-[84px] resize-y leading-[1.5]`}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="What should the next revision do differently?"
              value={feedback}
            />
          </label>

          <div className="flex flex-wrap items-center gap-[9px]">
            <button
              className={primaryButtonClass}
              disabled={pending}
              onClick={() => approve.mutate(latest.id)}
              type="button"
            >
              Approve plan
            </button>
            <button
              className={secondaryButtonClass}
              disabled={pending || feedback.trim() === ''}
              type="submit"
            >
              Request changes
            </button>
          </div>

          <p className="text-[12.5px] text-ink-5">
            Approving freezes the runbook in force against this job. Requesting
            changes returns it to the queue and revises in the same Codex
            session.
          </p>
        </form>
      ) : null}

      {failure === null ? null : (
        <p className="text-[13px] text-red-ink" role="alert">
          {failure.message}
        </p>
      )}

      {earlier.length === 0 ? null : (
        <details className="border-t border-line pt-4">
          <summary className="cursor-pointer text-[13px] text-ink-3">
            {earlier.length} earlier revision{earlier.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {earlier.map((version) => (
              <li className={insetClass} key={version.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-ink-4">
                    v{version.revision}
                  </span>
                  <span className="text-[12.5px] text-ink-4">
                    {planApprovalStateLabels[version.approvalState]}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.5] text-ink-2">
                  {version.content.summary}
                </p>
                {version.feedback === null ? null : (
                  <p className="mt-2 text-[12.5px] leading-[1.5] text-amber-ink">
                    Asked for: {version.feedback}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
