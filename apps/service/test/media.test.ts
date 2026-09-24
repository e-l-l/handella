import { describe, expect, it } from 'vitest'

import { describeVideoHold, findVideoReferences } from '../src/domain/media.js'
import { aLinearIssue } from './linear-fake.js'

const videosIn = (issue: Parameters<typeof findVideoReferences>[0]) =>
  findVideoReferences(issue).map((video) => video.url)

describe('finding the video an issue leans on', () => {
  it('reads the hosts that serve nothing else', () => {
    for (const url of [
      'https://www.loom.com/share/9f2c4d6e8a0b',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://vimeo.com/76979871',
    ]) {
      expect(
        videosIn(aLinearIssue({ description: `See ${url} for the repro.` })),
      ).toEqual([url])
    }
  })

  it('reads a recording by its extension, whatever the query string says', () => {
    // Linear's own uploads arrive signed, so the path is the only part of the
    // address that says what the file is.
    expect(
      videosIn(
        aLinearIssue({
          attachments: [
            {
              title: 'Screen recording',
              url: 'https://uploads.linear.app/a/b/repro.MOV?signature=abc123',
            },
          ],
        }),
      ),
    ).toEqual(['https://uploads.linear.app/a/b/repro.MOV?signature=abc123'])
  })

  it('reads one from an attachment and one from the description alike', () => {
    const issue = aLinearIssue({
      attachments: [
        { title: 'Loom', url: 'https://www.loom.com/share/aaa' },
        { title: 'Design', url: 'https://figma.com/file/bbb' },
      ],
      description: 'And the second half: https://www.loom.com/share/ccc',
    })

    expect(findVideoReferences(issue)).toMatchObject([
      { from: 'attachment', title: 'Loom' },
      { from: 'description', title: null },
    ])
  })

  it('names a video once, however many times the issue does', () => {
    const url = 'https://www.loom.com/share/aaa'
    expect(
      videosIn(
        aLinearIssue({
          attachments: [{ title: null, url }],
          description: `Repro: ${url}`,
        }),
      ),
    ).toEqual([url])
  })

  it('reads a link ending a sentence without the full stop', () => {
    expect(
      videosIn(
        aLinearIssue({
          description: 'Watch https://www.loom.com/share/aaa.',
        }),
      ),
    ).toEqual(['https://www.loom.com/share/aaa'])
  })

  it('finds nothing in an issue that carries no video', () => {
    expect(
      videosIn(
        aLinearIssue({
          attachments: [
            { title: 'Screenshot', url: 'https://uploads.linear.app/a/b.png' },
            {
              title: 'The PR',
              url: 'https://github.com/acme/monorepo/pull/41',
            },
          ],
          description: 'See https://linear.app/acme/issue/ENG-9 and the png.',
        }),
      ),
    ).toEqual([])
  })

  it('finds nothing in an issue nobody has described', () => {
    expect(
      videosIn(aLinearIssue({ attachments: null, description: null })),
    ).toEqual([])
  })

  it('says what was found and what the Handler is to do about it', () => {
    const body = describeVideoHold([
      {
        from: 'attachment',
        title: 'Repro',
        url: 'https://www.loom.com/share/aaa',
      },
    ])

    expect(body).toContain('Repro — https://www.loom.com/share/aaa')
    expect(body).toContain('Open session')
  })
})
