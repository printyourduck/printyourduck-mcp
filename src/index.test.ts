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
  let previousCacheDir: string | undefined
  let cacheRoot: string

  beforeEach(async () => {
    previousAllowedRoots = process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS
    previousCacheDir = process.env.PRINTYOURDUCK_MCP_CACHE_DIR
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-cache-'))
    process.env.PRINTYOURDUCK_MCP_CACHE_DIR = cacheRoot
    vi.stubGlobal('fetch', fetchMock)
    uploadMock.mockReset()
    fetchMock.mockReset()
  })

  afterEach(async () => {
    if (previousAllowedRoots === undefined) {
      delete process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS
    } else {
      process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = previousAllowedRoots
    }
    if (previousCacheDir === undefined) {
      delete process.env.PRINTYOURDUCK_MCP_CACHE_DIR
    } else {
      process.env.PRINTYOURDUCK_MCP_CACHE_DIR = previousCacheDir
    }
    await fs.rm(cacheRoot, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('uploads a missing local file, then submits with content hash and explicit user confirmation', async () => {
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
      const expectedStoragePath = expect.stringMatching(
        new RegExp(
          `^quote-requests/mcp-local-mcp-local-[a-f0-9]{48}-${expectedHash.slice(0, 16)}-part\\.stl$`,
        ),
      )
      uploadMock.mockImplementation(async (pathname) => ({ pathname }))
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: 'validation_failed',
              message: 'Uploaded file was not found.',
              issues: [
                {
                  field: 'files.0.storageUrlOrKey',
                  message: 'Uploaded file was not found.',
                },
              ],
            },
            { status: 400 },
          ),
        )
        .mockResolvedValueOnce(
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
      const firstRequestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
      const secondRequestBody = JSON.parse(fetchMock.mock.calls[1][1].body)

      expect(result).toMatchObject({
        ok: true,
        quoteRequestId: 'qr_123',
      })
      expect(uploadMock).toHaveBeenCalledWith(
        expectedStoragePath,
        expect.any(Blob),
        expect.objectContaining({
          access: 'private',
          handleUploadUrl: 'https://printyourduck.com/api/upload',
        }),
      )
      expect(firstRequestBody).toEqual(secondRequestBody)
      expect(firstRequestBody).toMatchObject({
        source: 'mcp-local',
        userSubmissionConfirmed: true,
      })
      expect(firstRequestBody.files[0]).toMatchObject({
        originalFilename: 'part.stl',
        storageUrlOrKey: expectedStoragePath,
        contentHash: expectedHash,
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('does not upload again when the deterministic retry is already idempotent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = root

    try {
      const filePath = path.join(root, 'part.stl')
      await fs.writeFile(filePath, 'solid test\nendsolid test\n')
      fetchMock.mockResolvedValueOnce(
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

      expect(result).toMatchObject({
        ok: true,
        quoteRequestId: 'qr_123',
      })
      expect(uploadMock).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
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
      fetchMock.mockResolvedValueOnce(
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
      expect(uploadMock).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('uses the returned upload pathname and caches it for random-suffix deployments', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = root

    try {
      const filePath = path.join(root, 'part.stl')
      await fs.writeFile(filePath, 'solid test\nendsolid test\n')
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: 'validation_failed',
              message: 'Uploaded file was not found.',
              issues: [
                {
                  field: 'files.0.storageUrlOrKey',
                  message: 'Uploaded file was not found.',
                },
              ],
            },
            { status: 400 },
          ),
        )
        .mockResolvedValueOnce(
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
        .mockResolvedValueOnce(
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
      uploadMock.mockResolvedValueOnce({
        pathname: 'quote-requests/randomized-part.stl',
      })

      await expect(submitLocalFileForQuote(validQuoteInput(filePath))).resolves.toMatchObject({
        ok: true,
        quoteRequestId: 'qr_123',
      })
      await expect(submitLocalFileForQuote(validQuoteInput(filePath))).resolves.toMatchObject({
        ok: true,
        quoteRequestId: 'qr_123',
      })

      expect(uploadMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body)
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
      const thirdBody = JSON.parse(fetchMock.mock.calls[2][1].body)

      expect(firstBody.files[0].storageUrlOrKey).toMatch(
        /^quote-requests\/mcp-local-/,
      )
      expect(secondBody.files[0].storageUrlOrKey).toBe(
        'quote-requests/randomized-part.stl',
      )
      expect(thirdBody.files[0].storageUrlOrKey).toBe(
        'quote-requests/randomized-part.stl',
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('fails safely when upload returns an invalid pathname', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-'))
    process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS = root

    try {
      const filePath = path.join(root, 'part.stl')
      await fs.writeFile(filePath, 'solid test\nendsolid test\n')
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'validation_failed',
            message: 'Uploaded file was not found.',
            issues: [
              {
                field: 'files.0.storageUrlOrKey',
                message: 'Uploaded file was not found.',
              },
            ],
          },
          { status: 400 },
        ),
      )
      uploadMock.mockResolvedValueOnce({
        pathname: 'outside/randomized-part.stl',
      })

      await expect(submitLocalFileForQuote(validQuoteInput(filePath))).resolves.toMatchObject({
        ok: false,
        error: 'upload_path_invalid',
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
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
