import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createGitAdapter } from '../src/adapters/git-cli.js'
import { DomainError } from '../src/domain/errors.js'
import { aTemporaryDirectory, cleanupTestContexts } from './helpers.js'

afterEach(cleanupTestContexts)

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * A real remote and a real clone, because the whole point of this suite is that
 * a fake which always succeeds proves nothing about `git worktree add`. Linear
 * is faked to dodge the network; git has no network to dodge.
 */
const aClonedRepository = (): { clone: string; remote: string } => {
  const remote = aTemporaryDirectory('handella-remote-')
  git(remote, 'init', '--quiet', '--bare', '--initial-branch=dev')

  const seed = aTemporaryDirectory('handella-seed-')
  git(seed, 'init', '--quiet', '--initial-branch=dev')
  git(seed, 'config', 'user.email', 'handler@example.com')
  git(seed, 'config', 'user.name', 'Handler')
  writeFileSync(join(seed, 'README.md'), '# acme\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '--quiet', '-m', 'first commit')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '--quiet', 'origin', 'dev')

  const clone = aTemporaryDirectory('handella-clone-')
  git(clone, 'clone', '--quiet', remote, '.')
  git(clone, 'config', 'user.email', 'handler@example.com')
  git(clone, 'config', 'user.name', 'Handler')

  return { clone, remote }
}

const adapter = createGitAdapter()

describe('cutting a worktree', () => {
  it('creates the canonical branch in its own directory', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-412-fix-flaky-login-test',
      repositoryPath: clone,
      worktreePath,
    })

    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true)
    expect(await adapter.headBranch(worktreePath)).toBe(
      'ell/eng-412-fix-flaky-login-test',
    )
  })

  it('nests a branch name that carries slashes, rather than failing on it', async () => {
    const { clone } = aClonedRepository()
    const root = aTemporaryDirectory('handella-wt-')
    const worktreePath = join(root, 'ell', 'eng-412-fix-flaky-login-test')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-412-fix-flaky-login-test',
      repositoryPath: clone,
      worktreePath,
    })

    expect(existsSync(worktreePath)).toBe(true)
  })

  it('leaves the main checkout where it was', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-412',
      repositoryPath: clone,
      worktreePath,
    })

    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('dev')
    expect(git(clone, 'status', '--porcelain')).toBe('')
  })

  it('refuses a second worktree on the same branch, which is the containment property', async () => {
    const { clone } = aClonedRepository()
    const first = join(aTemporaryDirectory('handella-wt-'), 'one')
    const second = join(aTemporaryDirectory('handella-wt-'), 'two')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-412',
      repositoryPath: clone,
      worktreePath: first,
    })

    await expect(
      adapter.addWorktree({
        base: 'dev',
        branch: 'ell/eng-412',
        repositoryPath: clone,
        worktreePath: second,
      }),
    ).rejects.toMatchObject({ code: 'worktree_creation_failed' })
  })

  it('refuses to check the claimed branch out in the main checkout', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-412',
      repositoryPath: clone,
      worktreePath,
    })

    // Git's own guarantee, not Handella's: one branch, one worktree.
    expect(() => git(clone, 'checkout', 'ell/eng-412')).toThrow(
      /already checked out|already used by worktree/,
    )
  })

  it('reports a repository that is not one as a typed failure', async () => {
    const notARepository = aTemporaryDirectory('handella-bare-')

    await expect(
      adapter.fetchBase(notARepository, 'dev'),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      adapter.fetchBase(notARepository, 'dev'),
    ).rejects.toMatchObject({ code: 'git_unavailable' })
  })
})

describe('reading what is there', () => {
  it('knows a branch that exists locally and one that exists on the remote', async () => {
    const { clone } = aClonedRepository()
    git(clone, 'branch', 'local-only')

    expect(await adapter.branchExists(clone, 'local-only')).toBe(true)
    expect(await adapter.branchExists(clone, 'dev')).toBe(true)
    expect(await adapter.branchExists(clone, 'never-heard-of-it')).toBe(false)
  })

  it('lists the remote branches without origin/ or HEAD', async () => {
    const { clone, remote } = aClonedRepository()
    const seed = aTemporaryDirectory('handella-push-')
    git(seed, 'clone', '--quiet', remote, '.')
    git(seed, 'checkout', '--quiet', '-b', 'release/2026-09')
    git(seed, 'push', '--quiet', 'origin', 'release/2026-09')

    await adapter.fetchBase(clone, 'release/2026-09')

    const branches = await adapter.listRemoteBranches(clone)
    // Exactly the branches, and nothing that is not one. Asserted as a whole
    // rather than as a handful of `toContain`s, which is what let a stray
    // `origin` entry — git's short form of refs/remotes/origin/HEAD — through.
    expect([...branches].sort()).toEqual(['dev', 'release/2026-09'])
  })
})

describe('the drift assertion', () => {
  it('catches a checkout that wandered off its canonical branch', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-412',
      repositoryPath: clone,
      worktreePath,
    })

    // What an agent left to its own devices actually does: not escape to the
    // main repo, but cut its own branch where it already is.
    git(worktreePath, 'checkout', '--quiet', '-b', 'fix-attempt')

    expect(await adapter.headBranch(worktreePath)).toBe('fix-attempt')
  })
})

describe('removing a worktree', () => {
  it('takes the directory away and leaves the checkout clean', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-412',
      repositoryPath: clone,
      worktreePath,
    })
    await adapter.removeWorktree(clone, worktreePath)

    expect(existsSync(worktreePath)).toBe(false)
    expect(git(clone, 'worktree', 'list')).not.toContain(worktreePath)
    // The branch survives its worktree: Phase 7 removes the directory after a
    // merge, and the branch is the pull request's.
    expect(await adapter.branchExists(clone, 'ell/eng-412')).toBe(true)
  })
})

describe('reading what worktrees a checkout has', () => {
  it('names the checkout itself first and every worktree after it', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-500',
      repositoryPath: clone,
      worktreePath,
    })

    const listings = await adapter.listWorktrees(clone)

    // The main working tree is the one entry that is never a Job's, and it is
    // always the first block `--porcelain` prints.
    expect(listings[0]?.isMain).toBe(true)
    expect(listings[0]?.branch).toBe('dev')
    const cut = listings.find((listing) => !listing.isMain)
    // Compared through `realpathSync`: macOS hands out `/var` paths that git
    // reports as `/private/var`.
    expect(cut?.path).toBe(realpathSync(worktreePath))
    expect(cut?.branch).toBe('ell/eng-500')
  })

  it('reads a detached worktree as being on no branch at all', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    git(clone, 'worktree', 'add', '--quiet', '--detach', worktreePath, 'dev')

    const detached = (await adapter.listWorktrees(clone)).find(
      (listing) => !listing.isMain,
    )

    expect(detached?.branch).toBeNull()
  })

  it('forgets a worktree whose directory somebody removed by hand', async () => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')

    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch: 'ell/eng-501',
      repositoryPath: clone,
      worktreePath,
    })
    rmSync(worktreePath, { force: true, recursive: true })

    await adapter.pruneWorktrees(clone)

    expect(await adapter.listWorktrees(clone)).toHaveLength(1)
    // Metadata only: the registration is forgotten and the branch is not.
    expect(await adapter.branchExists(clone, 'ell/eng-501')).toBe(true)
  })
})

describe('asking whether a worktree is clean', () => {
  const aWorktree = async (branch: string): Promise<string> => {
    const { clone } = aClonedRepository()
    const worktreePath = join(aTemporaryDirectory('handella-wt-'), 'job')
    await adapter.fetchBase(clone, 'dev')
    await adapter.addWorktree({
      base: 'dev',
      branch,
      repositoryPath: clone,
      worktreePath,
    })
    return worktreePath
  }

  it('calls a freshly cut worktree clean', async () => {
    expect(await adapter.isWorktreeClean(await aWorktree('ell/eng-502'))).toBe(
      true,
    )
  })

  it('calls a modified file uncommitted work', async () => {
    const worktreePath = await aWorktree('ell/eng-503')
    writeFileSync(join(worktreePath, 'README.md'), '# acme, edited\n')

    expect(await adapter.isWorktreeClean(worktreePath)).toBe(false)
  })

  it('counts an untracked file too, because it is still work', async () => {
    const worktreePath = await aWorktree('ell/eng-504')
    writeFileSync(join(worktreePath, 'scratch.md'), 'notes\n')

    expect(await adapter.isWorktreeClean(worktreePath)).toBe(false)
  })

  it('calls a committed change clean, because the commit is what the PR has', async () => {
    const worktreePath = await aWorktree('ell/eng-505')
    writeFileSync(join(worktreePath, 'README.md'), '# acme, edited\n')
    git(worktreePath, 'add', '.')
    git(worktreePath, 'commit', '--quiet', '-m', 'edit the readme')

    expect(await adapter.isWorktreeClean(worktreePath)).toBe(true)
  })
})
