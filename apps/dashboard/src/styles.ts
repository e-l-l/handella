/**
 * The class strings more than one component spells, and the handoff's controls
 * in one place: a button, a card, a row and a status tag each appear on every
 * screen, and three copies of a Tailwind string is three chances to drift away
 * from the design tokens in `index.css`.
 *
 * The UX revamp's rule set lives here, because it is a rule about shape rather
 * than about any one screen: **shape and fill encode function**. Everything
 * pressable is a 10px rounded rectangle, weighted by how much the Handler
 * should want to press it; a fact is a 5px mono rectangle with no hover; and
 * only a genuine group of controls — the nav, a filter group, a segmented
 * choice — is allowed to stay a pill. The confusion this replaces was status
 * chips, secondary buttons and primary buttons all being pills in similar
 * greens.
 */

/* ── The four button weights ──────────────────────────────────────────── */

/**
 * The action the Handler came to the screen to perform. **Exactly one visible
 * per screen**, plus the global "New job" in the nav; if a screen renders two
 * mint buttons, one of them is wrong.
 */
export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] bg-mint px-[18px] py-2.5 text-[13.5px] font-semibold text-on-mint hover:bg-mint-hover active:bg-mint-active disabled:cursor-not-allowed disabled:opacity-60'

/**
 * The primary at full width, for Intake's sticky footer where it closes a
 * long scroll. Its own spelling rather than overrides on the one above: two
 * arbitrary `rounded-[…]` or `text-[…]` utilities on one element leave the
 * outcome to stylesheet order.
 */
export const primaryBlockButtonClass =
  'inline-flex w-full items-center justify-center rounded-[11px] bg-mint px-[18px] py-3.5 text-[14px] font-semibold text-on-mint hover:bg-mint-hover active:bg-mint-active disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Filled, so it still reads as a pressable surface rather than as an outline
 * competing with the primary. Two per screen at most.
 */
export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] border border-line-strong bg-control px-[18px] py-2.5 text-[13.5px] text-ink hover:border-mint-soft/[0.26] disabled:cursor-not-allowed disabled:opacity-60'

/** Rare or reversible: no fill and no border until the pointer is on it. */
export const quietButtonClass =
  'inline-flex items-center justify-center rounded-[10px] px-3.5 py-2.5 text-[13.5px] text-ink-3 hover:bg-mint-soft/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-60'

/** The same weight, dimmer, for a row the handoff has already de-emphasised. */
export const quietMutedButtonClass =
  'inline-flex items-center justify-center rounded-[10px] px-3.5 py-2.5 text-[13px] text-ink-3 hover:bg-mint-soft/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-60'

/** Never mint, and never adjacent to the primary. */
export const destructiveButtonClass =
  'inline-flex items-center justify-center rounded-[10px] px-3.5 py-2.5 text-[13px] text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60'

/** The bordered variant, for a destructive action that stands on its own. */
export const destructiveOutlineButtonClass =
  'inline-flex items-center justify-center rounded-[10px] border border-red/30 px-3.5 py-2.5 text-[13px] text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Anything that is not the primary, the one secondary or a destructive gets
 * moved behind this: the `···` that opens `OverflowMenu`. The muted spelling
 * drops the border, for a finished row where the menu is not being offered so
 * much as kept available.
 */
export const overflowButtonClass =
  'grid size-8 flex-none place-items-center rounded-[10px] border border-line-strong text-[15px] leading-none text-ink-3 hover:text-ink'

export const overflowMutedButtonClass =
  'grid size-8 flex-none place-items-center rounded-[10px] text-[15px] leading-none text-ink-6 hover:text-ink-3'

/**
 * A control small enough to sit inside a line of metadata — "Copy path" beside
 * a worktree. Bordered rather than tinted, because a tinted rectangle this
 * size is exactly what a status tag is, and this one is pressable.
 */
export const inlineChipButtonClass =
  'inline-flex flex-none items-center gap-1.5 rounded-[7px] border border-line-input px-[9px] py-[3px] text-[11.5px] text-ink-3 hover:border-mint-soft/[0.26] hover:text-ink'

/* ── Pills, which are now only ever groups of controls ────────────────── */

/**
 * The two shapes allowed to stay pills, because they are genuine controls and
 * read as a group rather than as a single button: the nav and a filter or
 * segmented group. The track is what makes them read that way, so the track is
 * part of the class rather than left to the caller.
 */
export const pillGroupClass =
  'inline-flex gap-0.5 rounded-full bg-raised p-[3px]'

export const pillClass =
  'rounded-full px-3.5 py-1.5 text-[12.5px] whitespace-nowrap'

export const pillActiveClass = 'bg-secondary text-ink'

export const pillIdleClass = 'text-ink-3 hover:text-ink'

/** The nav's own segment, which sits a size up from a filter pill. */
export const navPillClass =
  'flex items-center gap-1.5 rounded-full px-[15px] py-[7px] text-[13.5px]'

/**
 * A segmented choice inside a form — Feature | Routine. A squarer track than a
 * filter group, because it is one field among several rather than a filter over
 * the whole screen.
 */
export const segmentTrackClass = 'flex gap-1 rounded-[12px] bg-raised p-1'

export const segmentClass =
  'block cursor-pointer rounded-[9px] py-2.5 text-center text-[13px]'

/* ── Status tags: facts, not controls ─────────────────────────────────── */

/**
 * A small mono rectangle. **This is the central fix**: a pill means "you can
 * click this" and a rectangle means "this is a fact", so a status tag is
 * 5px-cornered, unbordered and has no hover state at all. The tone comes from
 * `Tag`, which owns the mapping from meaning to fill.
 */
export const tagClass =
  'inline-flex flex-none items-center gap-1.5 rounded-[5px] px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.09em]'

/** The same fact, one size down, for a tag that sits inside a card heading. */
export const tagSmallClass =
  'inline-flex flex-none items-center gap-1.5 rounded-[5px] px-[7px] py-[3px] font-mono text-[10px] uppercase tracking-[0.08em]'

/** The count beside a page title: a fact, but the one the Handler came for. */
export const countTagClass =
  'inline-flex flex-none items-center rounded-[6px] bg-mint px-[9px] py-0.5 font-mono text-[11.5px] font-semibold text-on-mint'

/* ── Cards, rows and panels ───────────────────────────────────────────── */

/** A rail card, and every card on the System screen. */
export const cardClass = 'rounded-[18px] border border-line bg-raised p-[18px]'

/** A row inset into a card: the surface value drops rather than the border. */
export const insetClass = 'rounded-xl bg-surface p-3.5'

/**
 * The dashed panel the handoff draws for an empty list, which fills the space
 * its rows would have taken. It carries its own radius so no caller adds a
 * second one and leaves the outcome to stylesheet order.
 */
export const emptyPanelClass =
  'rounded-2xl border border-dashed border-line-strong px-5 py-9 text-center text-[13px] text-ink-4'

/**
 * The most repeated element in the app: a bordered row that a job, a Linear
 * issue and anything listed beside them all wear. The border and background
 * stay with the caller, which is what says whether the row is selected, needs
 * the Handler, or is finished and out of the way.
 */
export const listRowClass =
  'flex flex-wrap items-center gap-4 rounded-[14px] px-[18px] py-4'

/** Intake's rows sit a radius and a step of padding tighter than a job's. */
export const issueRowClass =
  'flex flex-wrap items-center gap-3.5 rounded-xl px-4 py-3.5'

export const rowIdentifierClass =
  'w-[72px] flex-none font-mono text-[12px] text-ink-5'

export const rowTitleClass =
  'text-[14.5px] font-[550] tracking-[-0.1px] text-pretty'

export const rowAgeClass =
  'w-[34px] flex-none text-right font-mono text-[11.5px] text-ink-5'

/**
 * The mono rule a group of rows sits under. Jobs are grouped by what they need
 * from the Handler rather than listed flat, and the rule is what says so.
 */
export const groupLabelClass =
  'font-mono text-[11px] uppercase tracking-[0.12em]'

/* ── Fields ───────────────────────────────────────────────────────────── */

/**
 * Every field wears the same shell; only the type inside it differs, so the
 * spellings share the border, radius and padding rather than restating them.
 * They are separate exports rather than one composed at the call site because
 * two arbitrary `text-[…]` utilities on one element leave the outcome to
 * stylesheet order.
 */
/** The bordered box every input sits in, the search field included. */
export const fieldBoxClass =
  'rounded-[10px] border border-line-input bg-raised px-3.5'

const fieldShellClass = `w-full ${fieldBoxClass} py-[11px]`

export const fieldClass = `${fieldShellClass} text-[13.5px] text-ink placeholder:text-ink-5`

/** A field holding a name Git will take literally, so it is shown literally. */
export const monoFieldClass = `${fieldShellClass} font-mono text-[13px] text-ink`

/** The closed lists the app filters with, shaped like the inputs beside them. */
export const selectClass =
  'rounded-[10px] border border-line-input bg-raised px-3.5 py-[11px] text-[13px] text-ink-2 disabled:opacity-50'

export const labelClass = 'text-[13px] font-medium text-ink-2'

/** A label stacked over the control it names, which is every label in a form. */
export const fieldLabelClass = `flex flex-col gap-2 ${labelClass}`

/** A warning that does not block, and the corrective text of one that does. */
export const amberBannerClass =
  'rounded-[10px] border border-amber/20 bg-amber/[0.09] px-3.5 py-2.5 text-[12px] text-amber-ink'

/* ── Type scale ───────────────────────────────────────────────────────── */

/** The h1 of every screen but the job page. */
export const pageTitleClass = 'text-[20px] font-semibold tracking-[-0.3px]'

/** The job page's own h1, which is a sentence rather than a word. */
export const screenTitleClass =
  'text-[23px] font-semibold tracking-[-0.4px] text-pretty'

/** A heading inside a screen — System's Repositories and Runbook. */
export const sectionTitleClass = 'text-[18px] font-semibold tracking-[-0.2px]'

export const cardTitleClass = 'text-[14.5px] font-semibold'

export const helperClass = 'text-[12.5px] leading-[1.55] text-ink-4'

export const metaClass = 'font-mono text-[11.5px] text-ink-5'

/* ── Screen geometry ──────────────────────────────────────────────────── */

/**
 * Card padding, screen padding and the column grids, which every screen
 * repeats: main content first, rail second, collapsing to one column below the
 * 1200px the handoff draws for.
 */
export const screenClass = 'px-6 pb-[34px] pt-[26px]'

/** Home: a 360px rail. */
export const railGridClass =
  'grid grid-cols-1 gap-6 min-[1200px]:grid-cols-[1fr_360px]'

/** The job page: a 348px rail. */
export const narrowRailGridClass =
  'grid grid-cols-1 gap-6 min-[1200px]:grid-cols-[1fr_348px]'

/**
 * Intake's rail is wider and carries its own border and padding, so it sets no
 * gap. System's sidebar is the mirror image — a narrow column first. The
 * widths stay whole strings rather than one interpolated helper: Tailwind
 * generates a class only for the literals it can find in the source, and a
 * width pasted in at runtime is not one it can find.
 */
export const wideRailGridClass =
  'grid grid-cols-1 min-[1200px]:grid-cols-[1fr_420px]'

export const sidebarGridClass =
  'grid grid-cols-1 gap-7 min-[1000px]:grid-cols-[200px_1fr]'
