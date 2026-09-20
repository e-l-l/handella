/**
 * What replaces a secret. A marker rather than a blank, so a Handler reading a
 * log can tell the difference between a value Handella hid and one that was
 * never there.
 */
const marker = '[redacted]'

export type Redactor = (text: string) => string

/**
 * Exact substring replacement over the values Handella was configured with.
 *
 * Deliberately not pattern matching. Handella knows precisely which strings are
 * secret, and a regular expression for token shapes would blank commit hashes
 * and base64 fixtures in exchange for catching secrets nobody told Handella
 * about — trading a log that is readable for one that is merely suspicious.
 *
 * Longest first, so a secret that contains another is not left half-visible by
 * the shorter one being replaced inside it.
 */
export const createRedactor = (secretValues: readonly string[]): Redactor => {
  const secrets = [
    ...new Set(secretValues.filter((value) => value !== '')),
  ].sort((left, right) => right.length - left.length)

  if (secrets.length === 0) return (text) => text

  // One scan per line rather than one per secret: this runs on every line of
  // every Codex stream, and there are as many secrets as the Handler's shell
  // happens to hold. Alternation is first-match, so the longest-first order
  // above still wins where one secret contains another.
  const pattern = new RegExp(
    secrets
      .map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'g',
  )

  return (text) => text.replace(pattern, marker)
}
