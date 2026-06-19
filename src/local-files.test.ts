import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contentHashForFile,
  contentTypeForFilename,
  findRecentPrintableFiles,
  isSubpath,
  resolvePathInsideAllowedRoots,
  safeBlobName,
  submissionIdForLocalQuote,
} from './local-files'

describe('local printable file helpers', () => {
  it('finds recent printable files and skips unsupported files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    await fs.writeFile(path.join(root, 'part.stl'), 'solid test')
    await fs.writeFile(path.join(root, 'notes.txt'), 'not printable')

    const files = await findRecentPrintableFiles({
      rootDirectory: root,
      maxResults: 5,
    })

    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      filename: 'part.stl',
      extension: '.stl',
    })
  })

  it('maps public-safe content types', () => {
    expect(contentTypeForFilename('duck.3mf')).toBe(
      'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    )
    expect(contentTypeForFilename('part.step')).toBe('model/step')
    expect(contentTypeForFilename('part.stl')).toBe('model/stl')
  })

  it('hashes file content as lowercase SHA-256 hex', () => {
    expect(contentHashForFile(Buffer.from('solid duck'))).toBe(
      '806a2a0828f7b4134e086e1fd19cdda03c59ef4390d3e092fb6671f6b03bd7b1',
    )
  })

  it('sanitizes blob names', () => {
    expect(safeBlobName('my duck!!!.stl')).toBe('my-duck-.stl')
    expect(safeBlobName('!!!')).toBe('uploaded-file')
  })

  it('checks whether a path stays inside an allowed root', () => {
    const root = path.resolve('printyourduck-root')

    expect(isSubpath(root, path.join(root, 'part.stl'))).toBe(true)
    expect(isSubpath(root, path.resolve('other-root/part.stl'))).toBe(false)
  })

  it('resolves candidate paths only when they stay inside allowed roots', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-other-'))
    const allowedFile = path.join(root, 'part.stl')
    const outsideFile = path.join(otherRoot, 'part.stl')
    await fs.writeFile(allowedFile, 'solid allowed')
    await fs.writeFile(outsideFile, 'solid outside')

    await expect(
      resolvePathInsideAllowedRoots({
        candidatePath: allowedFile,
        allowedRoots: [root],
      }),
    ).resolves.toBe(await fs.realpath(allowedFile))

    await expect(
      resolvePathInsideAllowedRoots({
        candidatePath: outsideFile,
        allowedRoots: [root],
      }),
    ).resolves.toBeNull()
  })

  it('creates stable local quote submission IDs', () => {
    const first = submissionIdForLocalQuote({
      file: Buffer.from('solid duck'),
      filename: 'part.stl',
      email: 'Alex@Example.com',
      country: 'Canada',
      materialPreference: 'PLA',
      quantity: 1,
    })
    const second = submissionIdForLocalQuote({
      file: Buffer.from('solid duck'),
      filename: 'part.stl',
      email: 'alex@example.com',
      country: 'canada',
      materialPreference: 'PLA',
      quantity: '1',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^mcp-local-[a-f0-9]{48}$/)
  })
})
