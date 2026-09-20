import { join } from 'node:path'

/**
 * Where an Attempt's raw Codex stream is kept: one file per turn, under one
 * directory per job.
 *
 * A directory per job rather than one flat root because Phase 12's retention
 * deletes a job's detailed data, and a directory is what that can remove in one
 * move. Composed here rather than inside the store for the reason
 * `worktreePathFor` sits in `dispatch.ts`: a layout is worth stating once, and
 * a test that wants to read a log should be able to say where it is.
 */
export const attemptLogPathFor = (
  logRoot: string,
  jobId: string,
  attemptId: string,
): string => join(logRoot, jobId, `${attemptId}.jsonl`)
