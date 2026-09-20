import { Type, type Static } from 'typebox'

import { IsoDateTimeSchema, UuidSchema } from './primitives.js'

/**
 * The Runbook is the fixed procedure every job's implementation follows —
 * commit, test, lint, open the pull request — and it is the same for every
 * job. The Plan is what differs between them.
 *
 * `content` is prose, and deliberately so. It is instructions handed to an
 * agent, not a program Handella executes: structure would buy nothing here
 * and would stop the Handler from writing "if the suite is flaky, say so
 * rather than retrying", which is the kind of sentence a runbook is for.
 *
 * Versions are append-only. Editing one in place would rewrite what jobs
 * already approved against it believe they are executing, and the whole point
 * of snapshotting is that they cannot be. The active version is simply the
 * highest; rolling back means saving the old text again as a new version.
 */
export const RunbookVersionSchema = Type.Object(
  {
    id: UuidSchema,
    version: Type.Integer({ minimum: 1 }),
    content: Type.String(),
    createdAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'RunbookVersion' },
)

export type RunbookVersion = Static<typeof RunbookVersionSchema>

/** The version number is Handella's to assign, so saving is just the text. */
export const CreateRunbookVersionSchema = Type.Object(
  {
    content: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false, $id: 'CreateRunbookVersion' },
)

export type CreateRunbookVersion = Static<typeof CreateRunbookVersionSchema>

/**
 * The copy taken when a plan is approved. It holds the text rather than only
 * pointing at the version, because a job has to be able to say what it ran
 * even if the Handler later deletes or rewrites everything in settings; the
 * `runbookVersionId` is kept alongside so two jobs can still be recognised as
 * having executed the same procedure.
 *
 * There is no create schema: a snapshot is never posted. It is written by
 * approval, in the same transaction, and by nothing else.
 */
export const RunbookSnapshotSchema = Type.Object(
  {
    id: UuidSchema,
    jobId: UuidSchema,
    runbookVersionId: UuidSchema,
    content: Type.String(),
    createdAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'RunbookSnapshot' },
)

export type RunbookSnapshot = Static<typeof RunbookSnapshotSchema>
