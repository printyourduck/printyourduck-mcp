import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const uploadMock = vi.hoisted(() => vi.fn())

vi.mock('@vercel/blob/client', () => ({
  upload: uploadMock,
}))

import { getQuoteStatus, submitLocalFileForQuote } from './index'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function validQuoteInput(filePath: string, overrides: Record<string, unknown> = {}) {
  return {
    filePath,
    name: 'Alex',
    email: 'alex@example.com',
    country: 'Canada',
    materialPreference: 'PLA' as const,
    quantity: 1,
    rightsConfirmed: true as const,
    restrictedItemConfirmed: true as const,
    manualQuoteConfirmed: true as const,
    userSubmissionConfirmed: true as const,
    ...overrides,
  }
}

describe('PrintYourDuck local MCP submit helpers', () => {
  let previousAllowedRoots: string | undefined

  beforeEach(() => {
    previousAllowedRoots = process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS
    vi.stubGlobal('fetch', fetchMock)
    uploadMock.mockReset()
    fetchMock.mockReset()
  })

  afterEach(() => {
    if (previousAllowedRoots === undefined) {
      delete process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS
    } else {
      process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = previousAllowedRoots
    }
    vi.unstubAllGlobals()
  })

  it('submits a local file with content hash and explicit user confirmation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = root

    try {
      const filePath = path.join(root, 'part.stl')
      const fileContent = 'solid test\nendsolid test\n'
      const expectedHash = crypto
        .createHash('sha256')
        .update(fileContent)
        .digest('hex')

      await fs.writeFile(filePath, fileContent)
      uploadMock.mockResolvedValue({
        pathname: 'quote-requests/123-part.stl',
      })
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            quoteRequestId: 'qr_123',
            status: 'manual_review_required',
            message: 'Accepted.',
            expectedQuoteTime: 'within 24 hours',
          },
          { status: 201 },
        ),
      )

      const result = await submitLocalFileForQuote(validQuoteInput(filePath))
      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)

      expect(result).toMatchObject({
        ok: true,
        quoteRequestId: 'qr_123',
      })
      expect(uploadMock).toHaveBeenCalledWith(
        expect.stringMatching(/^quote-requests\/\d+-part\.stl$/),
        expect.any(Blob),
        expect.objectContaining({
          access: 'private',
          handleUploadUrl: 'https://printyourduck.com/api/upload',
        }),
      )
      expect(requestBody).toMatchObject({
        source: 'mcp-local',
        userSubmissionConfirmed: true,
      })
      expect(requestBody.files[0]).toMatchObject({
        originalFilename: 'part.stl',
        storageUrlOrKey: 'quote-requests/123-part.stl',
        contentHash: expectedHash,
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns API validation failures without hiding the server response', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = root

    try {
      const filePath = path.join(root, 'part.stl')
      await fs.writeFile(filePath, 'solid test\nendsolid test\n')
      uploadMock.mockResolvedValue({
        pathname: 'quote-requests/123-part.stl',
      })
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            error: 'validation_failed',
            message: 'Please check the quote request fields.',
          },
          { status: 400 },
        ),
      )

      await expect(
        submitLocalFileForQuote(validQuoteInput(filePath)),
      ).resolves.toMatchObject({
        ok: false,
        error: 'validation_failed',
        message: 'Please check the quote request fields.',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('rejects oversized files before upload', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = root

    try {
      const filePath = path.join(root, 'huge.stl')
      await fs.writeFile(filePath, '')
      await fs.truncate(filePath, 101 * 1024 * 1024)

      await expect(
        submitLocalFileForQuote(validQuoteInput(filePath)),
      ).resolves.toMatchObject({
        ok: false,
        error: 'file_too_large',
      })
      expect(uploadMock).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('maps quote status responses', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        quoteRequestId: 'qr_123',
        status: 'manual_review_required',
      }),
    )

    await expect(
      getQuoteStatus({
        quoteRequestId: 'qr_123',
        email: 'alex@example.com',
      }),
    ).resolves.toMatchObject({
      ok: true,
      quoteRequestId: 'qr_123',
      status: 'manual_review_required',
    })
  })
})
