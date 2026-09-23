import { defaultBaseBranch } from '@handella/contracts'
import { type ReactNode, useMemo, useState } from 'react'

import {
  emptyFilters,
  IntakeStateContext,
  type IntakeFilters,
  type IssueChoices,
} from './intake.ts'

/** What an issue starts with the moment it is selected, however it was. */
const defaultChoice: IssueChoices = {
  baseBranch: defaultBaseBranch,
  workClass: 'routine',
}

/**
 * Holds the Intake screen's own state above the router, so leaving Intake no
 * longer throws it away. Two things were being lost: the Selection, which is
 * work the Handler did and Handella never asked for twice, and the filters,
 * whose reset silently changed the query key and sent the local service back
 * to Linear for a list it already had.
 *
 * In memory only. A reload is not part of supervising Handella, and persisting
 * this would buy a serialised shape to version against `IntakeChoices` for a
 * case that does not arise.
 */
export function IntakeStateProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<IntakeFilters>(emptyFilters)
  const [selections, setSelections] = useState<Record<string, IssueChoices>>({})

  const value = useMemo(
    () => ({
      filters,
      setRepositoryId: (repositoryId: string) =>
        setFilters((current) => ({ ...current, repositoryId })),
      setSearchInput: (searchInput: string) =>
        setFilters((current) => ({ ...current, searchInput })),
      setStateId: (stateId: string) =>
        setFilters((current) => ({ ...current, stateId })),
      // The chosen state belongs to the team it was chosen from, so it cannot
      // outlive a change of team.
      setTeamId: (teamId: string) =>
        setFilters((current) => ({ ...current, stateId: '', teamId })),

      selections,

      amend: (issueId: string, patch: Partial<IssueChoices>) =>
        setSelections((current) => {
          const existing = current[issueId]
          if (existing === undefined) return current
          return { ...current, [issueId]: { ...existing, ...patch } }
        }),

      clear: () => setSelections({}),

      select: (issueIds: readonly string[]) =>
        setSelections((current) => {
          const added = Object.fromEntries(
            issueIds
              .filter((issueId) => !(issueId in current))
              .map((issueId) => [issueId, defaultChoice]),
          )
          // Returned unchanged when the range held nothing new, so extending
          // over an already-selected block is not a re-render.
          return Object.keys(added).length === 0
            ? current
            : { ...current, ...added }
        }),

      // Takes the issues rather than the survivors, because the caller knows
      // which jobs it created and not which selections it left behind.
      drop: (issueIds: readonly string[]) =>
        setSelections((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([issueId]) => !issueIds.includes(issueId),
            ),
          ),
        ),

      toggle: (issueId: string) =>
        setSelections((current) => {
          if (issueId in current) {
            return Object.fromEntries(
              Object.entries(current).filter(([id]) => id !== issueId),
            )
          }
          return {
            ...current,
            [issueId]: defaultChoice,
          }
        }),
    }),
    [filters, selections],
  )

  return <IntakeStateContext value={value}>{children}</IntakeStateContext>
}
