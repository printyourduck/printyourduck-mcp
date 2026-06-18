import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contentTypeForFilename,
  findRecentPrintableFiles,
  isSubpath,
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

  it('sanitizes blob names', () => {
    expect(safeBlobName('my duck!!!.stl')).toBe('my-duck-.stl')
    expect(safeBlobName('!!!')).toBe('uploaded-file')
  })

  it('checks whether a path stays inside an allowed root', () => {
    const root = path.resolve('printyourduck-root')

    expect(isSubpath(root, path.join(root, 'part.stl'))).toBe(true)
    expect(isSubpath(root, path.resolve('other-root/part.stl'))).toBe(false)
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
