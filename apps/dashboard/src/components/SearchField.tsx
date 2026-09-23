import { fieldBoxClass } from '../styles.ts'

/**
 * The one search input the app has, on the two screens that list things.
 *
 * The glyph is inline SVG rather than a font or an icon package because it is
 * the only icon in the design that is not a text glyph, and one 14px stroke is
 * cheaper than a dependency. It is `aria-hidden`, so the field's accessible
 * name is the label the caller gives and not "search search".
 */
export function SearchField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label
      className={`flex w-full items-center gap-2.5 py-2.5 ${fieldBoxClass}`}
    >
      <span className="sr-only">{label}</span>
      <svg
        aria-hidden="true"
        className="size-3.5 flex-none text-ink-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-5"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}
