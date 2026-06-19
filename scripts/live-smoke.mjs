#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
}

function structuredContent(result) {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent
  }

  const text = result.content?.find((entry) => entry.type === 'text')?.text
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

if (process.env.PRINTYOURDUCK_MCP_LIVE_SMOKE !== '1') {
  console.log(
    'Skipping live MCP smoke. Set PRINTYOURDUCK_MCP_LIVE_SMOKE=1 to create a real production quote request.',
  )
  process.exit(0)
}

const smokeEmail = process.env.PRINTYOURDUCK_MCP_SMOKE_EMAIL
if (!smokeEmail) {
  fail('PRINTYOURDUCK_MCP_SMOKE_EMAIL is required for live MCP smoke.')
}

const packageJson = await readJson('package.json')
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-live-'))
const fixtureFile = path.join(fixtureRoot, 'live-smoke-part.stl')
await writeFile(fixtureFile, 'solid live-smoke\nendsolid live-smoke\n')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist/index.js')],
  cwd: fixtureRoot,
  env: {
    PRINTYOURDUCK_MCP_ALLOWED_ROOTS: fixtureRoot,
  },
  stderr: 'pipe',
})
const client = new Client({
  name: 'printyourduck-mcp-live-smoke',
  version: packageJson.version,
})
const stderrChunks = []

transport.stderr?.on('data', (chunk) => {
  stderrChunks.push(chunk.toString('utf8'))
})

try {
  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('Timed out waiting for MCP stdio initialize.')),
        10000,
      )
    }),
  ])

  const result = structuredContent(
    await client.callTool({
      name: 'submit_local_file_for_quote',
      arguments: {
        filePath: fixtureFile,
        name: process.env.PRINTYOURDUCK_MCP_SMOKE_NAME ?? 'MCP Live Smoke',
        email: smokeEmail,
        country: process.env.PRINTYOURDUCK_MCP_SMOKE_COUNTRY ?? 'Canada',
        materialPreference: process.env.PRINTYOURDUCK_MCP_SMOKE_MATERIAL ?? 'PLA',
        quantity: Number(process.env.PRINTYOURDUCK_MCP_SMOKE_QUANTITY ?? 1),
        notes: 'Automated live MCP smoke test fixture.',
        rightsConfirmed: true,
        restrictedItemConfirmed: true,
        manualQuoteConfirmed: true,
        userSubmissionConfirmed: true,
      },
    }),
  )

  if (result.ok !== true || typeof result.quoteRequestId !== 'string') {
    throw new Error(
      `Live smoke did not return a quoteRequestId: ${JSON.stringify(result)}`,
    )
  }

  const status = structuredContent(
    await client.callTool({
      name: 'get_quote_status',
      arguments: {
        quoteRequestId: result.quoteRequestId,
        email: smokeEmail,
      },
    }),
  )
  if (status.ok !== true || status.quoteRequestId !== result.quoteRequestId) {
    throw new Error(`Status lookup failed: ${JSON.stringify(status)}`)
  }

  console.log(`Live MCP smoke created quote request ${result.quoteRequestId}.`)
} catch (error) {
  const stderr = stderrChunks.join('').trim()
  const message = error instanceof Error ? error.message : String(error)
  console.error(stderr ? `${message}\n${stderr}` : message)
  process.exit(1)
} finally {
  await client.close().catch(() => undefined)
  await rm(fixtureRoot, { recursive: true, force: true })
}
