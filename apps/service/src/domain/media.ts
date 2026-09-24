import type { LinearIssueSummary } from '@handella/contracts'

/**
 * The video an issue leans on, which Handella cannot hand to Codex.
 *
 * Codex takes images and not video, so an issue whose evidence is a Loom or a
 * screen recording is one Handella would have to plan around rather than from.
 * Finding them is what lets it decline instead: the Job is held for the
 * Handler to plan in their own terminal, where they can give Codex a local
 * path (docs/adr/0017).
 *
 * Pure, and deliberately conservative about what counts. A false positive
 * costs a Job that waits for the Handler when it need not have; a false
 * negative costs a plan written about half an issue. Neither is free, and the
 * first is the one the Handler can see and answer.
 */
export interface VideoReference {
  /** Where it was found, so the item can say whether it is a link or an attachment. */
  from: 'attachment' | 'description'
  title: string | null
  url: string
}

/** Hosts whose links are a video and nothing else. */
const videoHosts = new Set([
  'loom.com',
  'www.loom.com',
  'youtu.be',
  'youtube.com',
  'www.youtube.com',
  'vimeo.com',
  'www.vimeo.com',
])

/**
 * Extensions Linear's own uploads carry. Checked on the path alone, so a
 * signed URL's query string does not hide one.
 */
const videoExtensions = ['.mp4', '.mov', '.webm', '.m4v', '.avi']

/**
 * Every URL in a body of text, as a scan rather than as markdown.
 *
 * A description is markdown, but a video reaches one as a bare link, an
 * `[embed](url)`, an `<video src>` or Linear's own upload syntax, and parsing
 * markdown to find three of those and miss the fourth is worse than reading
 * the text for the thing every one of them contains.
 */
const urlPattern = /https?:\/\/[^\s<>()[\]"'`]+/g

const isVideo = (url: string): boolean => {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (videoHosts.has(parsed.hostname.toLowerCase())) return true

  const path = parsed.pathname.toLowerCase()
  return videoExtensions.some((extension) => path.endsWith(extension))
}

export const findVideoReferences = (
  issue: LinearIssueSummary,
): VideoReference[] => {
  const found: VideoReference[] = []
  const seen = new Set<string>()

  const add = (reference: VideoReference): void => {
    if (seen.has(reference.url)) return
    seen.add(reference.url)
    found.push(reference)
  }

  for (const attachment of issue.attachments ?? []) {
    if (isVideo(attachment.url)) {
      add({ from: 'attachment', title: attachment.title, url: attachment.url })
    }
  }

  for (const url of issue.description?.match(urlPattern) ?? []) {
    // Markdown ends a link with punctuation as often as not, and a trailing
    // stop is part of the sentence rather than of the address.
    const trimmed = url.replace(/[.,;:!?]+$/, '')
    if (isVideo(trimmed))
      add({ from: 'description', title: null, url: trimmed })
  }

  return found
}

/** What the Handler is told, naming what Handella could not look at. */
export const describeVideoHold = (
  references: readonly VideoReference[],
): string =>
  [
    'This issue carries a video Handella cannot hand to Codex:',
    '',
    ...references.map((reference) =>
      reference.title === null
        ? `- ${reference.url}`
        : `- ${reference.title} — ${reference.url}`,
    ),
    '',
    'Download it, press Open session, and give Codex the local path. The',
    'session opens in the worktree with the planning brief already typed, and',
    'Handella follows it from there.',
  ].join('\n')
