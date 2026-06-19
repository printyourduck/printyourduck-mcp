#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
}

const packageJson = await readJson('package.json')

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

async function withClient({ cwd = root, env } = {}, callback) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'dist/index.js')],
    cwd,
    env,
    stderr: 'pipe',
  })
  const client = new Client({
    name: 'printyourduck-mcp-smoke-test',
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

    await callback(client)
  } catch (error) {
    const stderr = stderrChunks.join('').trim()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(stderr ? `${message}\n${stderr}` : message)
  } finally {
    await client.close().catch(() => undefined)
  }
}

try {
  await withClient({}, async (client) => {
    const serverVersion = client.getServerVersion()
    if (serverVersion?.version !== packageJson.version) {
      throw new Error(
        `MCP initialize version ${serverVersion?.version ?? '(missing)'} does not match ${packageJson.version}.`,
      )
    }

    const instructions = client.getInstructions() ?? ''
    for (const required of [
      'manual quote review',
      'does not calculate instant prices',
      'collect payment',
      'private operational',
    ]) {
      if (!instructions.includes(required)) {
        throw new Error(`MCP instructions are missing required boundary: ${required}`)
      }
    }

    for (const forbidden of [
      'supplier location',
      'fulfilment route',
      'carrier strategy',
      'cost structure',
      'margin logic',
    ]) {
      if (instructions.includes(forbidden)) {
        throw new Error(`MCP instructions expose private operational detail: ${forbidden}`)
      }
    }

    const tools = await client.listTools()
    const names = new Set(tools.tools.map((tool) => tool.name))

    for (const required of [
      'get_printyourduck_quote_requirements',
      'find_recent_printable_files',
      'submit_local_file_for_quote',
      'get_quote_status',
    ]) {
      if (!names.has(required)) {
        throw new Error(`MCP tools/list is missing ${required}.`)
      }
    }

    const submitTool = tools.tools.find(
      (tool) => tool.name === 'submit_local_file_for_quote',
    )
    if (submitTool?.inputSchema.properties?.apiBaseUrl) {
      throw new Error('submit_local_file_for_quote must not expose an apiBaseUrl argument.')
    }

    const requirements = structuredContent(
      await client.callTool({
        name: 'get_printyourduck_quote_requirements',
        arguments: {},
      }),
    )
    if (!Array.isArray(requirements.acceptedFileExtensions)) {
      throw new Error('get_printyourduck_quote_requirements did not return file extensions.')
    }
    if (!requirements.acceptedFileExtensions.includes('STL')) {
      throw new Error('get_printyourduck_quote_requirements is missing STL support.')
    }
  })

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-smoke-'))
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'printyourduck-mcp-outside-'))

  try {
    const fixtureFile = path.join(fixtureRoot, 'fixture-part.stl')
    const outsideFile = path.join(outsideRoot, 'outside-part.stl')
    await writeFile(fixtureFile, 'solid fixture\nendsolid fixture\n')
    await writeFile(outsideFile, 'solid outside\nendsolid outside\n')

    await withClient(
      {
        cwd: fixtureRoot,
        env: {
          PRINTYOURDUCK_MCP_ALLOWED_ROOTS: fixtureRoot,
        },
      },
      async (client) => {
        const findResult = structuredContent(
          await client.callTool({
            name: 'find_recent_printable_files',
            arguments: {
              rootDirectory: fixtureRoot,
              maxDepth: 1,
              maxResults: 5,
            },
          }),
        )

        if (!Array.isArray(findResult.files)) {
          throw new Error('find_recent_printable_files did not return a files array.')
        }
        if (!findResult.files.some((file) => file.filename === 'fixture-part.stl')) {
          throw new Error('find_recent_printable_files did not find the fixture STL.')
        }

        const blockedFind = structuredContent(
          await client.callTool({
            name: 'find_recent_printable_files',
            arguments: {
              rootDirectory: outsideRoot,
              maxDepth: 1,
              maxResults: 5,
            },
          }),
        )

        if (!Array.isArray(blockedFind.files) || blockedFind.files.length !== 0) {
          throw new Error(
            'find_recent_printable_files returned files outside allowed roots.',
          )
        }

        const blockedSubmit = structuredContent(
          await client.callTool({
            name: 'submit_local_file_for_quote',
            arguments: {
              filePath: outsideFile,
              name: 'MCP Smoke Test',
              email: 'mcp-smoke@example.com',
              country: 'Canada',
              materialPreference: 'PLA',
              quantity: 1,
              rightsConfirmed: true,
              restrictedItemConfirmed: true,
              manualQuoteConfirmed: true,
              userSubmissionConfirmed: true,
            },
          }),
        )

        if (blockedSubmit.ok !== false || blockedSubmit.error !== 'file_path_not_allowed') {
          throw new Error(
            'submit_local_file_for_quote did not reject a file outside allowed roots.',
          )
        }
      },
    )
  } finally {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(outsideRoot, { recursive: true, force: true }),
    ])
  }

  console.log('MCP stdio smoke checks passed.')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
