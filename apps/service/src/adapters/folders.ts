import { folderPickerUnavailable } from '../domain/errors.js'

/**
 * The native folder dialog, opened by the service rather than by the page.
 *
 * This exists because of a browser limit and not a preference: a page cannot
 * learn the absolute path of a folder the viewer chose. `webkitdirectory`
 * yields a path relative to the folder itself, and `showDirectoryPicker`
 * yields a handle carrying only a name. Handella needs the absolute path,
 * because a worktree outlives the process that cut it.
 *
 * What makes this legitimate rather than a trick is that V1 is macOS-only,
 * single-user and local-first (masterplan.md:97): the service is running on
 * the Handler's own machine, in their own login session, so "open a dialog"
 * means open it in front of the person who just asked for it. An installation
 * where that stops being true gets `unavailableFolderPicker`, and its refusal
 * appears beside the field the Handler can still type into, which is the
 * behaviour this replaced rather than removed.
 */
export interface FolderPicker {
  /** The absolute path chosen, or null if the Handler cancelled. */
  choose(): Promise<string | null>
}

/** What a platform without a dialog gets: the field, and nothing beside it. */
export const unavailableFolderPicker: FolderPicker = {
  choose: () =>
    Promise.reject(
      folderPickerUnavailable(
        'This installation cannot open a folder dialog; type the path instead',
      ),
    ),
}
