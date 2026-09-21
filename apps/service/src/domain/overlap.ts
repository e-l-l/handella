import { posix } from 'node:path'

import type { PlanContent } from '@handella/contracts'

/**
 * Where two Jobs are both planning to write.
 *
 * A warning and nothing more. masterplan.md:56 has predicted overlap produce a
 * warning but never serialise jobs, so nothing reads this back: the scheduler
 * does not know it exists, and the only thing that happens to it is a Handler
 * reading it (docs/adr/0014).
 */
export interface Overlap {
  jobId: string
  /** What the Handler calls the other Job, ready to read in a list. */
  label: string
  /** The paths both Plans name, in a stable order. */
  paths: string[]
}

/**
 * The paths a Plan says it will touch, as the planner spelled them.
 *
 * Normalised only as far as `.` and `..` and a leading `./`, which are the
 * differences between two spellings of one path. Nothing is resolved against
 * the worktree: these are relative paths in two different directories, and
 * making them absolute would only make two Jobs' copies of `src/store.ts`
 * look like different files.
 *
 * Case is kept. macOS would usually treat two spellings as one file, but the
 * repository is read on Linux by CI and by everyone else, and a warning that
 * guessed wrong about case would be a warning about a file that is not shared.
 */
export const plannedPaths = (content: PlanContent): Set<string> => {
  const paths = new Set<string>()

  for (const step of content.steps) {
    for (const file of step.files) {
      const trimmed = file.trim()
      if (trimmed === '') continue

      const normalised = posix.normalize(trimmed).replace(/^\.\//, '')
      if (normalised === '' || normalised === '.') continue

      paths.add(normalised)
    }
  }

  return paths
}

/** Sorted, so a body written twice from the same facts reads the same twice. */
export const sharedPaths = (
  mine: ReadonlySet<string>,
  theirs: ReadonlySet<string>,
): string[] => [...mine].filter((path) => theirs.has(path)).sort()

/**
 * What the Handler reads. Names the other Job before the paths, because the
 * first question an overlap raises is whose work it is and the second is
 * where.
 */
export const describeOverlaps = (overlaps: readonly Overlap[]): string =>
  overlaps
    .map((overlap) =>
      [
        `${overlap.label} also plans to touch:`,
        ...overlap.paths.map((path) => `- ${path}`),
      ].join('\n'),
    )
    .join('\n\n')
