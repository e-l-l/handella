import { Type, type Static } from 'typebox'

import { BranchNameSchema, defaultBaseBranch } from './job.js'
import { IsoDateTimeSchema, Nullable, UuidSchema } from './primitives.js'

/**
 * The Handler's own label for a checkout. Spelled once because `Repository`,
 * `CreateRepository` and `UpdateRepository` all carry it, and three spellings
 * of the bound are three chances for POST to accept a name PATCH rejects.
 */
export const RepositoryNameSchema = Type.String({
  minLength: 1,
  maxLength: 200,
})

/**
 * An absolute path to a checkout the Handler already has. Handella adopts it
 * rather than cloning it, so the Handler's ssh and gh credentials stay theirs
 * and Handella never handles a secret to reach a remote. Relative paths are
 * refused because a worktree outlives the process that cut it, and a path
 * resolved against a working directory is a path that moves.
 */
export const RepositoryPathSchema = Type.String({
  minLength: 1,
  maxLength: 4096,
  pattern: '^/',
})

/**
 * The checkout a Job's worktree is cut from. masterplan.md:97 has V1 managing
 * one primary repository; this is a table rather than a setting so the second
 * one is a row instead of a migration.
 *
 * Distinct from `AppConfig.repositoryRoot`, which is Handella's own checkout
 * and has nothing to do with the work it orchestrates.
 */
export const RepositorySchema = Type.Object(
  {
    id: UuidSchema,
    name: RepositoryNameSchema,
    path: RepositoryPathSchema,
    /** Offered at Intake when the Handler says nothing else. */
    defaultBaseBranch: BranchNameSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: 'Repository' },
)

export type Repository = Static<typeof RepositorySchema>

export const CreateRepositorySchema = Type.Object(
  {
    name: RepositoryNameSchema,
    path: RepositoryPathSchema,
    defaultBaseBranch: Type.String({
      ...BranchNameSchema,
      default: defaultBaseBranch,
    }),
  },
  { additionalProperties: false, $id: 'CreateRepository' },
)

export type CreateRepository = Static<typeof CreateRepositorySchema>

/** Every field optional: the Handler edits one of them at a time. */
export const UpdateRepositorySchema = Type.Object(
  {
    name: Type.Optional(RepositoryNameSchema),
    path: Type.Optional(RepositoryPathSchema),
    defaultBaseBranch: Type.Optional(BranchNameSchema),
  },
  { additionalProperties: false, $id: 'UpdateRepository' },
)

export type UpdateRepository = Static<typeof UpdateRepositorySchema>

/**
 * What the native folder dialog came back with. A browser cannot read the
 * absolute path of a folder the viewer picked — `webkitdirectory` gives a
 * relative one and `showDirectoryPicker` gives a handle with only a name — so
 * the dialog is opened by the service, on the machine it is already running
 * on, and the path travels back over the API.
 *
 * `path` is null when the Handler cancelled. Cancelling is an answer rather
 * than a failure, so it is not an error response.
 */
export const ChosenFolderSchema = Type.Object(
  {
    path: Nullable(RepositoryPathSchema),
  },
  { additionalProperties: false, $id: 'ChosenFolder' },
)

export type ChosenFolder = Static<typeof ChosenFolderSchema>
