/**
 * The class strings more than one component spells, and the handoff's controls
 * in one place: a pill, a card and a chip each appear on every screen, and
 * three copies of a Tailwind string is three chances to drift away from the
 * design tokens in `index.css`.
 */

export const cardClass = 'rounded-[22px] border border-line bg-raised p-5'

/** Attention cards and the intake panel's cards sit one radius smaller. */
export const softCardClass =
  'rounded-[20px] border border-line bg-raised px-5 py-[18px]'

/** A row inset into a card: the surface value drops rather than the border. */
export const insetClass = 'rounded-2xl bg-surface p-3.5'

/**
 * The two dashed panels the handoff draws, which differ in radius and in size
 * rather than only in the copy they hold: an empty list fills the space its
 * rows would have taken, and a placeholder stands exactly as tall as the slot
 * it is holding open. They carry their own radius so no caller adds a second
 * one and leaves the outcome to stylesheet order.
 */
const dashedPanelClass =
  'border border-dashed border-line-dashed text-[12.5px] text-ink-4'

export const emptyPanelClass = `rounded-[20px] px-5 py-9 text-center ${dashedPanelClass}`

export const slotPanelClass = `grid h-[54px] place-items-center rounded-2xl px-3 text-center ${dashedPanelClass}`

export const primaryButtonClass =
  'rounded-full bg-mint px-[18px] py-[9px] text-[13px] font-semibold text-deep hover:bg-mint-hover active:bg-mint-active disabled:cursor-not-allowed disabled:opacity-60'

export const secondaryButtonClass =
  'rounded-full border border-line-strong px-[18px] py-[9px] text-[13px] text-ink-2 hover:border-mint-soft/30 hover:bg-mint-soft/5 disabled:cursor-not-allowed disabled:opacity-60'

/** The quiet filled pill: present but never the action being suggested. */
export const greyButtonClass =
  'rounded-full bg-raised-alt px-4 py-2 text-[12.5px] text-ink hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Every field wears the same shell; only the type inside it differs, so the
 * two spellings share the border, radius and padding rather than restating
 * them. They are separate exports rather than one composed at the call site
 * because two arbitrary `text-[…]` utilities on one element leave the outcome
 * to stylesheet order.
 */
const fieldShellClass =
  'w-full rounded-2xl border border-line-strong bg-raised px-4 py-3'

export const fieldClass = `${fieldShellClass} text-[13.5px] text-ink placeholder:text-ink-4`

/** A field holding a name Git will take literally, so it is shown literally. */
export const monoFieldClass = `${fieldShellClass} font-mono text-[13px] text-ink`

/** The closed lists intake filters with: a field shaped like the pills beside it. */
export const pillFieldClass =
  'rounded-full border border-line-strong bg-raised px-4 py-[11px] text-[12.5px] text-ink-2 disabled:opacity-50'

export const labelClass = 'text-[13px] font-medium text-ink-2'

/** A label stacked over the control it names, which is every label in a form. */
export const fieldLabelClass = `flex flex-col gap-2 ${labelClass}`

/** A warning that does not block, and the corrective text of one that does. */
export const amberBannerClass =
  'rounded-2xl border border-amber/20 bg-amber/[0.09] px-4 py-3 text-[12px] text-amber-ink'

export const screenTitleClass = 'text-[23px] font-semibold tracking-[-0.4px]'

export const sectionTitleClass = 'text-[21px] font-semibold tracking-[-0.3px]'

export const cardTitleClass = 'text-[14.5px] font-semibold'

/**
 * Card padding, screen padding and the two-column grid, which every screen
 * repeats: main content first, rail second, collapsing to one column below the
 * 1200px the handoff draws for.
 */
export const screenClass = 'px-7 py-7'

export const railGridClass =
  'grid grid-cols-1 gap-[26px] min-[1200px]:grid-cols-[1fr_396px]'

export const narrowRailGridClass =
  'grid grid-cols-1 gap-[26px] min-[1200px]:grid-cols-[1fr_372px]'

/**
 * Intake's rail is wider and carries its own border and padding, so it sets no
 * gap. The three widths stay whole strings rather than one interpolated
 * helper: Tailwind generates a class only for the literals it can find in the
 * source, and a width pasted in at runtime is not one it can find.
 */
export const wideRailGridClass =
  'grid grid-cols-1 min-[1200px]:grid-cols-[1fr_436px]'

/**
 * The most repeated element in the app: a bordered row that a job, a Linear
 * issue and anything listed beside them all wear. The border and background
 * stay with the caller, which is what says whether the row is selected.
 */
export const listRowClass =
  'flex flex-wrap items-center gap-[15px] rounded-[18px] px-[18px] py-[15px]'

export const rowIdentifierClass =
  'w-16 flex-none font-mono text-[12px] text-ink-5'

export const rowTitleClass = 'text-[14px] font-[450] tracking-[-0.1px]'

export const rowAgeClass = 'w-12 text-right font-mono text-[11px] text-ink-6'
