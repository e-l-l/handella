import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'

import {
  LinearIssuePageSchema,
  LinearIssueQuerySchema,
  LinearIssueSummarySchema,
  LinearTeamSummarySchema,
  LinearWorkflowStateSummarySchema,
  actionableLinearWorkflowStateTypes,
  isActionableLinearWorkflowStateType,
  linearWorkflowStateTypes,
} from '../src/index.js'
import { aLinearIssueSummary as validIssue } from './fixtures.js'

describe('Linear issue contract', () => {
  it('accepts an issue carrying everything intake needs', () => {
    expect(Value.Check(LinearIssueSummarySchema, validIssue)).toBe(true)
  })

  it('rejects a priority outside the scale Linear uses', () => {
    expect(
      Value.Check(LinearIssueSummarySchema, { ...validIssue, priority: 5 }),
    ).toBe(false)
  })

  it('rejects a blank branch name, because that is a malformed response', () => {
    expect(
      Value.Check(LinearIssueSummarySchema, { ...validIssue, branchName: '' }),
    ).toBe(false)
  })

  it('rejects the two-l spelling of cancelled, which Linear does not use', () => {
    expect(
      Value.Check(LinearIssueSummarySchema, {
        ...validIssue,
        stateType: 'cancelled',
      }),
    ).toBe(false)
  })

  it('rejects an issue carrying properties the contract does not name', () => {
    expect(
      Value.Check(LinearIssueSummarySchema, { ...validIssue, teamId: 'abc' }),
    ).toBe(false)
  })
})

describe('the actionable issue definition', () => {
  it('is every state type except the three that end an issue', () => {
    expect([...actionableLinearWorkflowStateTypes]).toEqual(
      linearWorkflowStateTypes.filter(
        (type) =>
          type !== 'completed' && type !== 'canceled' && type !== 'duplicate',
      ),
    )
  })

  it('counts triage, because an untriaged issue is still work', () => {
    expect(isActionableLinearWorkflowStateType('triage')).toBe(true)
  })

  it('excludes finished work', () => {
    expect(isActionableLinearWorkflowStateType('completed')).toBe(false)
    expect(isActionableLinearWorkflowStateType('canceled')).toBe(false)
  })

  it('excludes a duplicate, whose work lives on another issue', () => {
    expect(isActionableLinearWorkflowStateType('duplicate')).toBe(false)
  })

  it('rejects a state type Linear has not got', () => {
    expect(isActionableLinearWorkflowStateType('dozing')).toBe(false)
  })
})

describe('the issue page contract', () => {
  it('accepts a last page', () => {
    expect(
      Value.Check(LinearIssuePageSchema, {
        issues: [validIssue],
        nextCursor: null,
      }),
    ).toBe(true)
  })

  it('accepts a page that has more behind it', () => {
    expect(
      Value.Check(LinearIssuePageSchema, { issues: [], nextCursor: 'abc' }),
    ).toBe(true)
  })
})

describe('the issue query contract', () => {
  it('accepts an empty query', () => {
    expect(Value.Check(LinearIssueQuerySchema, {})).toBe(true)
  })

  it('accepts the team and state the Handler picked', () => {
    expect(
      Value.Check(LinearIssueQuerySchema, { teamId: 't1', stateId: 's2' }),
    ).toBe(true)
  })

  it('refuses a filter it does not know, so a typo fails loudly', () => {
    expect(Value.Check(LinearIssueQuerySchema, { stateType: 'backlog' })).toBe(
      false,
    )
  })

  it('bounds the page size', () => {
    expect(Value.Check(LinearIssueQuerySchema, { limit: 0 })).toBe(false)
    expect(Value.Check(LinearIssueQuerySchema, { limit: 51 })).toBe(false)
    expect(Value.Check(LinearIssueQuerySchema, { limit: 25 })).toBe(true)
  })
})

describe('the workflow state contract', () => {
  it('accepts an actionable state', () => {
    expect(
      Value.Check(LinearWorkflowStateSummarySchema, {
        id: 'c1d2e3f4-5a6b-47c8-9d0e-1f2a3b4c5d6e',
        name: 'In Dev (QA)',
        type: 'started',
      }),
    ).toBe(true)
  })

  it('describes no state the Handler cannot intake from', () => {
    expect(
      Value.Check(LinearWorkflowStateSummarySchema, {
        id: 'c1d2e3f4-5a6b-47c8-9d0e-1f2a3b4c5d6e',
        name: 'Done',
        type: 'completed',
      }),
    ).toBe(false)
  })
})

describe('the team contract', () => {
  it('accepts what the ad hoc form needs', () => {
    expect(
      Value.Check(LinearTeamSummarySchema, {
        id: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
        key: 'ENG',
        name: 'Engineering',
      }),
    ).toBe(true)
  })
})
