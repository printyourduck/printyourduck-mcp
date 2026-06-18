#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
}

const packageJson = await readJson('package.json')
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  cwd: root,
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
    'find_recent_printable_files',
    'submit_local_file_for_quote',
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

  console.log('MCP stdio smoke checks passed.')
} catch (error) {
  const stderr = stderrChunks.join('').trim()
  const message = error instanceof Error ? error.message : String(error)
  console.error(stderr ? `${message}\n${stderr}` : message)
  process.exit(1)
} finally {
  await client.close().catch(() => undefined)
}
