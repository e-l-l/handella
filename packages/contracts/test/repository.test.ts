import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'

import {
  CreateRepositorySchema,
  RepositorySchema,
  UpdateRepositorySchema,
} from '../src/index.js'

const validRepository = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  name: 'acme monorepo',
  path: '/Users/ell/workspace/work/monorepo',
  defaultBaseBranch: 'dev',
  createdAt: '2026-09-18T10:00:00.000Z',
  updatedAt: '2026-09-18T10:00:00.000Z',
}

describe('repository contract', () => {
  it('accepts a repository pointing at an absolute checkout', () => {
    expect(Value.Check(RepositorySchema, validRepository)).toBe(true)
  })

  it('refuses a relative path, which would move with the working directory', () => {
    expect(
      Value.Check(RepositorySchema, {
        ...validRepository,
        path: '../monorepo',
      }),
    ).toBe(false)
  })

  it('refuses an empty name', () => {
    expect(
      Value.Check(RepositorySchema, { ...validRepository, name: '' }),
    ).toBe(false)
  })

  it('refuses unknown properties', () => {
    expect(
      Value.Check(RepositorySchema, { ...validRepository, remote: 'origin' }),
    ).toBe(false)
  })
})

describe('create repository', () => {
  it('accepts a name and an absolute path', () => {
    expect(
      Value.Check(CreateRepositorySchema, {
        name: 'acme monorepo',
        path: '/Users/ell/workspace/work/monorepo',
        defaultBaseBranch: 'dev',
      }),
    ).toBe(true)
  })

  it('defaults the base branch to dev', () => {
    expect(CreateRepositorySchema.properties.defaultBaseBranch.default).toBe(
      'dev',
    )
  })

  it('refuses a relative path', () => {
    expect(
      Value.Check(CreateRepositorySchema, {
        name: 'acme monorepo',
        path: 'workspace/work/monorepo',
        defaultBaseBranch: 'dev',
      }),
    ).toBe(false)
  })
})

describe('update repository', () => {
  it('accepts a single field on its own', () => {
    expect(Value.Check(UpdateRepositorySchema, { name: 'renamed' })).toBe(true)
  })

  it('accepts an empty edit', () => {
    expect(Value.Check(UpdateRepositorySchema, {})).toBe(true)
  })

  it('still refuses a relative path', () => {
    expect(Value.Check(UpdateRepositorySchema, { path: './elsewhere' })).toBe(
      false,
    )
  })
})
