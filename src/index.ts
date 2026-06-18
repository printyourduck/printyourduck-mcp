#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { upload } from '@vercel/blob/client'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  contentTypeForFilename,
  extensionForFile,
  findRecentPrintableFiles,
  isSubpath,
  safeBlobName,
  submissionIdForLocalQuote,
} from './local-files.js'
import { MCP_PACKAGE_VERSION } from './version.js'

const MATERIAL_PREFERENCES = [
  'PLA',
  'PETG',
  'TPU_FLEXIBLE',
  'RESIN',
  'NOT_SURE',
] as const

const DEFAULT_API_BASE_URL = 'https://printyourduck.com'
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
const DEFAULT_ALLOWED_ROOTS = [process.cwd()]
const SERVER_INSTRUCTIONS = `
PrintYourDuck local MCP helps coding agents submit one selected local 3D file
for manual quote review. It does not calculate instant prices, collect payment
at upload, or provide private operational or business details.

Recommended workflow:
1. Use find_recent_printable_files to locate candidate STL, STEP, STP, 3MF, OBJ,
   or ZIP files.
2. Choose one specific file path and confirm the user wants to submit it.
3. Call submit_local_file_for_quote only after confirming design rights,
   restricted-item compliance, manual-quote understanding, and user approval.
4. Reuse submissionId when retrying the same user-approved submission; if it is
   omitted, this server derives a stable value from the selected file and quote
   details.

Do not promise instant pricing, checkout, payment collection, local production,
Canadian-made production, delivery dates, or production start before manual
review and post-quote approval.
`.trim()

const contactInputSchema = {
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(60).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().min(1).max(120),
  materialPreference: z.enum(MATERIAL_PREFERENCES),
  quantity: z.coerce.number().int().positive(),
  desiredDeadline: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5000).optional(),
  rightsConfirmed: z.literal(true),
  restrictedItemConfirmed: z.literal(true),
  manualQuoteConfirmed: z.literal(true),
  userSubmissionConfirmed: z.literal(true),
}

function endpoint(baseUrl: string, pathname: string) {
  return new URL(pathname, baseUrl).toString()
}

function jsonResult<T extends object>(structuredContent: T, isError = false) {
  return {
    structuredContent,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(structuredContent),
      },
    ],
    isError,
  }
}

function configuredAllowedRoots() {
  const configured = process.env.PRINTYOURDUCK_MCP_ALLOWED_ROOTS
  if (!configured) return DEFAULT_ALLOWED_ROOTS

  const roots = configured
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean)

  return roots.length > 0 ? roots : DEFAULT_ALLOWED_ROOTS
}

async function realpathOrResolved(value: string) {
  try {
    return await fs.realpath(path.resolve(value))
  } catch {
    return path.resolve(value)
  }
}

async function submitLocalFileForQuote(input: z.infer<z.ZodObject<typeof contactInputSchema>> & {
  filePath: string
  submissionId?: string
}) {
  let realFilePath: string

  try {
    realFilePath = await fs.realpath(path.resolve(input.filePath))
  } catch {
    return {
      ok: false,
      message: 'File could not be found or read.',
      error: 'file_not_found',
    }
  }

  const allowedRoots = await Promise.all(configuredAllowedRoots().map(realpathOrResolved))
  if (!allowedRoots.some((root) => isSubpath(root, realFilePath))) {
    return {
      ok: false,
      message:
        'File must be inside the MCP working directory or PRINTYOURDUCK_MCP_ALLOWED_ROOTS.',
      error: 'file_path_not_allowed',
    }
  }

  const filename = path.basename(realFilePath)
  const extension = extensionForFile(filename)

  if (!extension) {
    return {
      ok: false,
      message: 'Unsupported file type. Upload STL, STEP, STP, 3MF, OBJ, or ZIP.',
      error: 'unsupported_file_type',
    }
  }

  // realFilePath is canonicalized and checked against allowedRoots above.
  const file = await fs.readFile(realFilePath) // NOSONAR
  if (file.byteLength > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      message: 'File is too large. Maximum size is 100 MB.',
      error: 'file_too_large',
    }
  }

  const contentType = contentTypeForFilename(filename)
  const submissionId =
    input.submissionId ??
    submissionIdForLocalQuote({
      file,
      filename,
      email: input.email,
      country: input.country,
      materialPreference: input.materialPreference,
      quantity: input.quantity,
    })
  const blob = new Blob([file], { type: contentType })
  const uploaded = await upload(
    `quote-requests/${Date.now()}-${safeBlobName(filename)}`,
    blob,
    {
      access: 'private',
      handleUploadUrl: endpoint(DEFAULT_API_BASE_URL, '/api/upload'),
      multipart: true,
    },
  )

  const response = await fetch(endpoint(DEFAULT_API_BASE_URL, '/api/quote-requests'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      submissionId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      city: input.city,
      country: input.country,
      materialPreference: input.materialPreference,
      quantity: input.quantity,
      desiredDeadline: input.desiredDeadline,
      notes: input.notes,
      rightsConfirmed: input.rightsConfirmed,
      restrictedItemConfirmed: input.restrictedItemConfirmed,
      manualQuoteConfirmed: input.manualQuoteConfirmed,
      files: [
        {
          originalFilename: filename,
          storedFilename: uploaded.pathname,
          fileType: extension.replace('.', ''),
          fileSizeBytes: file.byteLength,
          storageUrlOrKey: uploaded.pathname,
          contentType,
        },
      ],
      source: 'mcp-local',
    }),
  })

  const result = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null

  if (!response.ok) {
    return {
      ok: false,
      message:
        typeof result?.message === 'string'
          ? result.message
          : 'Quote request could not be submitted.',
      error: typeof result?.error === 'string' ? result.error : 'submit_failed',
    }
  }

  return {
    ok: true,
    ...result,
  }
}

const server = new McpServer({
  name: 'printyourduck-local',
  version: MCP_PACKAGE_VERSION,
}, {
  instructions: SERVER_INSTRUCTIONS,
})

server.registerTool(
  'find_recent_printable_files',
  {
    title: 'Find Recent Printable Files',
    description:
      'Find recent local 3D print files in a project directory. Alias intents: find generated model, locate printable file, scan project for STL/STEP/3MF/OBJ/ZIP. Read-only and does not upload anything.',
    inputSchema: {
      rootDirectory: z.string().trim().optional(),
      maxDepth: z.coerce.number().int().min(0).max(12).optional(),
      maxResults: z.coerce.number().int().min(1).max(50).optional(),
    },
    outputSchema: {
      files: z.array(
        z.object({
          path: z.string(),
          filename: z.string(),
          extension: z.string(),
          fileSizeBytes: z.number(),
          modifiedAt: z.string(),
        }),
      ),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ rootDirectory = process.cwd(), maxDepth, maxResults }) =>
    jsonResult({
      files: await findRecentPrintableFiles({
        rootDirectory,
        maxDepth,
        maxResults,
      }),
    }),
)

server.registerTool(
  'submit_local_file_for_quote',
  {
    title: 'Submit Local File For PrintYourDuck Quote',
    description:
      'Upload one selected local 3D file privately and submit it for manual PrintYourDuck quote review. Alias intents: submit local model for quote, request manual print quote, upload generated 3D file. Requires explicit confirmations and user approval. No payment is collected and no instant price is returned.',
    inputSchema: {
      filePath: z.string().trim().min(1),
      submissionId: z
        .string()
        .trim()
        .min(8)
        .max(120)
        .regex(/^[a-zA-Z0-9._:-]+$/)
        .optional(),
      ...contactInputSchema,
    },
    outputSchema: {
      ok: z.boolean(),
      quoteRequestId: z.string().optional(),
      status: z.string().optional(),
      message: z.string().optional(),
      expectedQuoteTime: z.string().optional(),
      error: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (input) => {
    try {
      const result = await submitLocalFileForQuote(input)
      return jsonResult(result, !result.ok)
    } catch {
      return jsonResult(
        {
          ok: false,
          message:
            'The local file could not be uploaded or submitted. No payment was collected.',
          error: 'submit_failed',
        },
        true,
      )
    }
  },
)

async function main() {
  await server.connect(new StdioServerTransport())
}

main().catch(() => {
  process.exitCode = 1
})
