import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'

import {
  BaseBranchSuggestionsSchema,
  CreateAdhocJobSchema,
  CreateJobFromLinearIssueSchema,
  IntakeIssuePageSchema,
  canonicalBranchForRound,
} from '../src/index.js'
import { aLinearIssueSummary } from './fixtures.js'

const validLinearIntake = {
  issueId: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
  workClass: 'routine',
  baseBranch: 'dev',
}

describe('intake from a Linear issue', () => {
  it('accepts an issue, a classification and a base branch', () => {
    expect(Value.Check(CreateJobFromLinearIssueSchema, validLinearIntake)).toBe(
      true,
    )
  })

  it('refuses to let the browser name the canonical branch', () => {
    expect(
      Value.Check(CreateJobFromLinearIssueSchema, {
        ...validLinearIntake,
        canonicalBranch: 'ell/whatever-i-like',
      }),
    ).toBe(false)
  })

  it('refuses to let the browser name the title', () => {
    expect(
      Value.Check(CreateJobFromLinearIssueSchema, {
        ...validLinearIntake,
        title: 'Something else entirely',
      }),
    ).toBe(false)
  })

  it('requires a base branch, because nothing fills a schema default in', () => {
    expect(
      Value.Check(CreateJobFromLinearIssueSchema, {
        issueId: validLinearIntake.issueId,
        workClass: validLinearIntake.workClass,
      }),
    ).toBe(false)
  })

  it('rejects a work class Handella does not have', () => {
    expect(
      Value.Check(CreateJobFromLinearIssueSchema, {
        ...validLinearIntake,
        workClass: 'urgent',
      }),
    ).toBe(false)
  })
})

const validAdhoc = {
  teamId: 'b2b9e5a6-0f1e-4c6b-9a3f-2b1c4d5e6f70',
  title: 'Fix the flaky login test',
  workClass: 'feature',
  baseBranch: 'dev',
}

describe('ad hoc intake', () => {
  it('accepts the minimum the Handler has to type', () => {
    expect(Value.Check(CreateAdhocJobSchema, validAdhoc)).toBe(true)
  })

  it('accepts a described, prioritised issue', () => {
    expect(
      Value.Check(CreateAdhocJobSchema, {
        ...validAdhoc,
        description: 'The test fails about one run in five.',
        priority: 3,
      }),
    ).toBe(true)
  })

  it('rejects an empty title', () => {
    expect(
      Value.Check(CreateAdhocJobSchema, { ...validAdhoc, title: '' }),
    ).toBe(false)
  })

  it('rejects a priority outside the scale Linear uses', () => {
    expect(
      Value.Check(CreateAdhocJobSchema, { ...validAdhoc, priority: 5 }),
    ).toBe(false)
  })
})

describe('base branch suggestions', () => {
  it('reports the default separately from what has been used', () => {
    expect(
      Value.Check(BaseBranchSuggestionsSchema, {
        defaultBranch: 'dev',
        recent: ['main', 'release/24'],
      }),
    ).toBe(true)
  })

  it('rejects an empty branch name', () => {
    expect(
      Value.Check(BaseBranchSuggestionsSchema, {
        defaultBranch: 'dev',
        recent: [''],
      }),
    ).toBe(false)
  })
})

describe('the canonical branch a round takes', () => {
  it('leaves the first job on Linear’s own name', () => {
    expect(canonicalBranchForRound('ell/eng-412-fix-flaky-login-test', 1)).toBe(
      'ell/eng-412-fix-flaky-login-test',
    )
  })

  it('suffixes every repeat with its round', () => {
    expect(canonicalBranchForRound('ell/eng-412-fix-flaky-login-test', 3)).toBe(
      'ell/eng-412-fix-flaky-login-test-3',
    )
  })
})

describe('an issue as intake offers it', () => {
  const anOffer = {
    issue: aLinearIssueSummary,
    heldByJobId: null,
    plannedBranch: 'ell/eng-412-fix-flaky-login-test',
    round: 1,
  }

  it('carries what Linear said beside what Handella knows', () => {
    expect(
      Value.Check(IntakeIssuePageSchema, {
        issues: [anOffer],
        nextCursor: null,
      }),
    ).toBe(true)
  })

  it('names the job holding an issue by its own id', () => {
    expect(
      Value.Check(IntakeIssuePageSchema, {
        issues: [
          { ...anOffer, heldByJobId: '123e4567-e89b-42d3-a456-426614174000' },
        ],
        nextCursor: null,
      }),
    ).toBe(true)
  })

  it('refuses a holder that is not a job id', () => {
    expect(
      Value.Check(IntakeIssuePageSchema, {
        issues: [{ ...anOffer, heldByJobId: 'ENG-412' }],
        nextCursor: null,
      }),
    ).toBe(false)
  })

  it('always answers a planned branch, because every issue has one', () => {
    expect(
      Value.Check(IntakeIssuePageSchema, {
        issues: [{ issue: anOffer.issue, heldByJobId: null }],
        nextCursor: null,
      }),
    ).toBe(false)
  })
})
