#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { upload } from '@vercel/blob/client'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  contentTypeForFilename,
  contentHashForFile,
  extensionForFile,
  findRecentPrintableFiles,
  resolvePathInsideAllowedRoots,
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

const ACCEPTED_FILE_EXTENSIONS = ['STL', 'STEP', 'STP', '3MF', 'OBJ', 'ZIP'] as const
const DEFAULT_API_BASE_URL = 'https://printyourduck.com'
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
const DEFAULT_ALLOWED_ROOTS = [process.cwd()]
const SERVER_INSTRUCTIONS = `
PrintYourDuck local MCP helps coding agents submit one selected local 3D file
for manual quote review. It does not calculate instant prices, collect payment
at upload, or provide private operational or business details.

Recommended workflow:
1. Use get_printyourduck_quote_requirements to understand accepted file types,
   material options, confirmations, and safety boundaries.
2. Use find_recent_printable_files to locate candidate STL, STEP, STP, 3MF, OBJ,
   or ZIP files.
3. Choose one specific file path and confirm the user wants to submit it.
4. Call submit_local_file_for_quote only after confirming design rights,
   restricted-item compliance, manual-quote understanding, and user approval.
5. Reuse submissionId when retrying the same user-approved submission; if it is
   omitted, this server derives a stable value from the selected file and quote
   details.
6. Use get_quote_status with the returned quoteRequestId and customer email when
   the user asks for public-safe status.

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

export function quoteRequirements() {
  return {
    acceptedFileExtensions: ACCEPTED_FILE_EXTENSIONS,
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    materialPreferences: MATERIAL_PREFERENCES,
    requiredConfirmations: [
      'rightsConfirmed',
      'restrictedItemConfirmed',
      'manualQuoteConfirmed',
      'userSubmissionConfirmed',
    ],
    workflow:
      'Find one local printable file, confirm user approval and required safety statements, submit it for manual quote review, then use the returned quoteRequestId for status lookup.',
    boundaries: [
      'No instant pricing.',
      'No payment at upload.',
      'No checkout automation.',
      'No private supplier, routing, carrier, cost, margin, file-key, or customer-data exposure.',
    ],
  }
}

export async function getQuoteStatus(input: {
  quoteRequestId: string
  email: string
}) {
  const response = await fetch(
    endpoint(
      DEFAULT_API_BASE_URL,
      `/api/quote-requests/${encodeURIComponent(input.quoteRequestId)}/status?email=${encodeURIComponent(input.email)}`,
    ),
  )
  const result = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null

  if (!response.ok) {
    return {
      ok: false,
      quoteRequestId: input.quoteRequestId,
      message:
        typeof result?.message === 'string'
          ? result.message
          : 'Quote status could not be found.',
      error: typeof result?.error === 'string' ? result.error : 'status_lookup_failed',
    }
  }

  return {
    ok: true,
    ...result,
  }
}

export async function submitLocalFileForQuote(input: z.infer<z.ZodObject<typeof contactInputSchema>> & {
  filePath: string
  submissionId?: string
}) {
  const realFilePath = await resolvePathInsideAllowedRoots({
    candidatePath: input.filePath,
    allowedRoots: configuredAllowedRoots(),
  })

  if (!realFilePath) {
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

  let fileSizeBytes: number
  try {
    const stat = await fs.stat(realFilePath)
    if (!stat.isFile()) throw new Error('Not a file.')
    fileSizeBytes = stat.size
  } catch {
    return {
      ok: false,
      message: 'File could not be found or read.',
      error: 'file_not_found',
    }
  }

  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      message: 'File is too large. Maximum size is 100 MB.',
      error: 'file_too_large',
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
  const contentHash = contentHashForFile(file)
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
      userSubmissionConfirmed: input.userSubmissionConfirmed,
      files: [
        {
          originalFilename: filename,
          storedFilename: uploaded.pathname,
          fileType: extension.replace('.', ''),
          fileSizeBytes,
          storageUrlOrKey: uploaded.pathname,
          contentType,
          contentHash,
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
  'get_printyourduck_quote_requirements',
  {
    title: 'Get PrintYourDuck Quote Requirements',
    description:
      'Read public requirements for a PrintYourDuck manual custom 3D printing quote request. Use this before submitting local files to check accepted file types, material options, confirmations, restrictions, and the private-upload flow. Does not calculate instant pricing.',
    inputSchema: {},
    outputSchema: {
      acceptedFileExtensions: z.array(z.string()),
      maxFileSizeBytes: z.number(),
      materialPreferences: z.array(z.string()),
      requiredConfirmations: z.array(z.string()),
      workflow: z.string(),
      boundaries: z.array(z.string()),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => jsonResult(quoteRequirements()),
)

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
  async ({ rootDirectory = process.cwd(), maxDepth, maxResults }) => {
    const allowedRootDirectory = await resolvePathInsideAllowedRoots({
      candidatePath: rootDirectory,
      allowedRoots: configuredAllowedRoots(),
    })

    if (!allowedRootDirectory) {
      return jsonResult({ files: [] })
    }

    return jsonResult({
      files: await findRecentPrintableFiles({
        rootDirectory: allowedRootDirectory,
        maxDepth,
        maxResults,
      }),
    })
  },
)

server.registerTool(
  'get_quote_status',
  {
    title: 'Get PrintYourDuck Quote Status',
    description:
      'Look up public-safe PrintYourDuck quote status using the quote request ID and matching customer email. Does not expose private file keys, payment URLs, supplier details, or sensitive operational data.',
    inputSchema: {
      quoteRequestId: z.string().trim().min(1).max(80),
      email: z.string().trim().email().max(254),
    },
    outputSchema: {
      ok: z.boolean(),
      quoteRequestId: z.string().optional(),
      status: z.string().optional(),
      marketRegion: z.string().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
      expectedQuoteTime: z.string().optional(),
      paymentStatus: z.string().optional(),
      trackingAvailable: z.boolean().optional(),
      message: z.string().optional(),
      error: z.string().optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (input) => {
    try {
      const result = await getQuoteStatus(input)
      return jsonResult(result, !result.ok)
    } catch {
      return jsonResult(
        {
          ok: false,
          quoteRequestId: input.quoteRequestId,
          message: 'Quote status could not be checked. Please try again later.',
          error: 'status_lookup_failed',
        },
        true,
      )
    }
  },
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.exitCode = 1
  })
}
