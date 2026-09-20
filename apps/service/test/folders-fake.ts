import type { FolderPicker } from '../src/adapters/folders.js'

export interface FakeFolderPicker extends FolderPicker {
  /** What the next dialog answers with. Null is the Handler cancelling. */
  chooses(path: string | null): void
  /** How many dialogs were opened, so a test can prove one was not. */
  readonly opened: () => number
}

/**
 * Answers without opening anything. The real dialog is not automatable —
 * proving it works means a person clicking Finder — so what is asserted here
 * is everything around it: that the route asks, that a cancel is not an error,
 * and that what comes back reaches the field.
 */
export const createFakeFolderPicker = (
  options: { path?: string | null } = {},
): FakeFolderPicker => {
  // `in` rather than `??`, because null is a meaningful answer here and not an
  // absent one: `{ path: null }` is the test asking for a cancelled dialog.
  let answer: string | null =
    'path' in options ? options.path : '/Users/handler/workspace/acme'
  let opened = 0

  return {
    chooses(path) {
      answer = path
    },
    opened: () => opened,
    choose() {
      opened += 1
      return Promise.resolve(answer)
    },
  }
}
