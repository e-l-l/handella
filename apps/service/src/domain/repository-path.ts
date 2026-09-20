import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { repositoryPathInvalid } from './errors.js'

/**
 * What the schema cannot ask: whether the absolute path the Handler gave is
 * actually a checkout. The shape is `RepositoryPathSchema`'s to judge and the
 * disk is this function's, which is why it lives here and not in the store —
 * the store is synchronous SQLite and knows nothing about filesystems.
 *
 * Asked at the edge, on create and on any update that moves the path. The
 * alternative is finding out at dispatch, by which point a Job exists, a Linear
 * issue names its branch, and the only symptom is a worktree that will not cut.
 */
export const assertRepositoryPath = (path: string): void => {
  let directory: boolean
  try {
    directory = statSync(path).isDirectory()
  } catch {
    throw repositoryPathInvalid(`There is no directory at ${path}`)
  }

  if (!directory) {
    throw repositoryPathInvalid(`${path} is not a directory`)
  }

  // Present rather than a directory: `.git` is a file in a checkout that is
  // itself a worktree, and adopting one of those is the Handler's business.
  if (!existsSync(join(path, '.git'))) {
    throw repositoryPathInvalid(
      `${path} is not a git checkout — it has no .git`,
    )
  }
}
