import { Type, type Static } from 'typebox'

import { isOneOf, literalUnion } from './primitives.js'

export const apiErrorCodes = [
  'job_not_found',
  'attention_item_not_found',
  'illegal_transition',
  'state_conflict',
  'transition_guard_failed',
  'suspension_not_allowed',
  'linear_not_configured',
  'linear_unauthorized',
  'linear_rate_limited',
  'linear_unavailable',
  'linear_issue_not_found',
  'linear_issue_not_actionable',
  'linear_issue_not_assigned',
  'linear_issue_already_linked',
  'repository_not_found',
  'repository_in_use',
  'repository_path_invalid',
  'folder_picker_unavailable',
  'terminal_unavailable',
  'canonical_branch_claimed',
  'canonical_branch_unowned',
  'git_unavailable',
  'worktree_creation_failed',
  'worktree_not_cut',
  'codex_unavailable',
  'codex_planning_failed',
  'codex_session_missing',
  'implementation_report_invalid',
  'attempt_not_found',
  'github_unavailable',
  'github_not_authenticated',
  'plan_version_not_found',
  'plan_content_invalid',
  'runbook_version_not_found',
  'cross_origin_refused',
  'validation_failed',
  'internal_error',
] as const

export type ApiErrorCode = (typeof apiErrorCodes)[number]

export const ApiErrorCodeSchema = literalUnion(apiErrorCodes)

export const ApiErrorSchema = Type.Object(
  {
    code: ApiErrorCodeSchema,
    message: Type.String(),
  },
  { additionalProperties: false, $id: 'ApiError' },
)

export type ApiError = Static<typeof ApiErrorSchema>

export const isApiErrorCode = isOneOf(apiErrorCodes)
