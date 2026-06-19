#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expectedPackageFiles = new Set([
  'LICENSE',
  'README.md',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.js.map',
  'dist/local-files.d.ts',
  'dist/local-files.js',
  'dist/local-files.js.map',
  'dist/version.d.ts',
  'dist/version.js',
  'dist/version.js.map',
  'package.json',
])

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    fail(`${command} ${args.join(' ')} failed\n${output}`)
  }

  return result.stdout
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
}

const [packageJson, serverJson] = await Promise.all([
  readJson('package.json'),
  readJson('server.json'),
])

if (packageJson.name !== '@printyourduck/mcp') {
  fail('package name must stay @printyourduck/mcp.')
}

if (serverJson.name !== packageJson.mcpName) {
  fail('server.json name must match package.json mcpName.')
}

if (serverJson.version !== packageJson.version) {
  fail('server.json version must match package.json version.')
}

const npmPackage = serverJson.packages?.find((entry) => entry.registryType === 'npm')
if (npmPackage?.identifier !== packageJson.name) {
  fail('server.json npm package identifier must match package name.')
}

if (npmPackage?.version !== packageJson.version) {
  fail('server.json npm package version must match package version.')
}

const ociPackage = serverJson.packages?.find((entry) => entry.registryType === 'oci')
if (ociPackage && ociPackage.identifier !== `ghcr.io/printyourduck/printyourduck-mcp:${packageJson.version}`) {
  fail('server.json OCI package identifier must match package version.')
}

const remote = serverJson.remotes?.find((entry) => entry.type === 'streamable-http')
if (remote?.url !== 'https://printyourduck.com/api/mcp') {
  fail('server.json must reference the hosted PrintYourDuck remote MCP endpoint.')
}

const packOutput = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'])
const [pack] = JSON.parse(packOutput)
const actualFiles = new Set(pack.files.map((file) => file.path))

for (const expected of expectedPackageFiles) {
  if (!actualFiles.has(expected)) {
    fail(`package tarball is missing ${expected}.`)
  }
}

for (const actual of actualFiles) {
  if (!expectedPackageFiles.has(actual)) {
    fail(`package tarball includes unexpected file ${actual}.`)
  }
}

console.log('Package metadata and tarball checks passed.')
