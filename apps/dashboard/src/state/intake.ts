import type { IntakeChoices } from '@handella/contracts'
import { createContext, useContext } from 'react'

/**
 * What the Handler chooses per issue. The repository is not here: it is chosen
 * once for the whole panel, because masterplan.md:97 has V1 managing one
 * primary repository and a batch split across checkouts is not a thing Intake
 * is for.
 */
export type IssueChoices = Omit<IntakeChoices, 'repositoryId'>

/**
 * How the Handler is looking at the offered issues. Deliberately not a term in
 * CONTEXT.md: narrowing a list is the screen's own mechanics rather than
 * anything the domain knows about. The Selection it is used to build is the
 * part that earned a name.
 */
export interface IntakeFilters {
  readonly repositoryId: string
  readonly searchInput: string
  readonly stateId: string
  readonly teamId: string
}

export const emptyFilters: IntakeFilters = {
  repositoryId: '',
  searchInput: '',
  stateId: '',
  teamId: '',
}

/**
 * Everything the Intake screen holds for itself: how it is looking at the
 * offered issues, and the Selection built from them.
 *
 * One context rather than one per half. Two would isolate the Selection panel
 * from a keystroke in the search field only if each half were read by a
 * component that reads nothing else, and Intake reads both in one — so the
 * split would cost two providers, two hooks and two value shapes to buy a
 * render that happens anyway. The day a component reads only one of them is
 * the day to split this, and it is a change no consumer of the other half
 * would see.
 */
export interface IntakeStateValue {
  readonly filters: IntakeFilters
  readonly setRepositoryId: (repositoryId: string) => void
  readonly setSearchInput: (searchInput: string) => void
  readonly setStateId: (stateId: string) => void
  readonly setTeamId: (teamId: string) => void
  /** The Selection, and the three things that can happen to it. */
  readonly selections: Readonly<Record<string, IssueChoices>>
  readonly amend: (issueId: string, patch: Partial<IssueChoices>) => void
  readonly drop: (issueIds: readonly string[]) => void
  readonly toggle: (issueId: string) => void
}

export const IntakeStateContext = createContext<IntakeStateValue | null>(null)

export const useIntakeState = (): IntakeStateValue => {
  const value = useContext(IntakeStateContext)
  if (value === null) {
    throw new Error('useIntakeState needs an IntakeStateProvider above it.')
  }
  return value
}
