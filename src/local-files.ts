import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const ACCEPTED_EXTENSIONS = [
  '.stl',
  '.step',
  '.stp',
  '.3mf',
  '.obj',
  '.zip',
] as const

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  'build',
  'dist',
  'node_modules',
  'out',
])

function isSafeBlobNameChar(char: string) {
  const code = char.charCodeAt(0)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === '.' ||
    char === '_' ||
    char === '-'
  )
}

export function isSubpath(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

export type PrintableFileCandidate = {
  path: string
  filename: string
  extension: string
  fileSizeBytes: number
  modifiedAt: string
}

export function extensionForFile(filename: string) {
  const lowerName = filename.toLowerCase()
  return ACCEPTED_EXTENSIONS.find((extension) => lowerName.endsWith(extension))
}

export function isPrintableFile(filename: string) {
  return Boolean(extensionForFile(filename))
}

export async function findRecentPrintableFiles({
  rootDirectory,
  maxDepth = 5,
  maxResults = 10,
}: {
  rootDirectory: string
  maxDepth?: number
  maxResults?: number
}) {
  const root = path.resolve(rootDirectory)
  const results: PrintableFileCandidate[] = []
  const safeMaxDepth = Math.min(Math.max(Math.trunc(maxDepth), 0), 12)
  const safeMaxResults = Math.min(Math.max(Math.trunc(maxResults), 1), 50)

  async function visit(directory: string, depthRemaining: number) {
    let entries: Array<{
      name: string
      isDirectory: () => boolean
      isFile: () => boolean
      isSymbolicLink: () => boolean
    }>

    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isSymbolicLink()) return

        const fullPath = path.join(directory, entry.name)

        if (entry.isDirectory()) {
          if (depthRemaining <= 0 || SKIPPED_DIRECTORIES.has(entry.name)) return
          await visit(fullPath, depthRemaining - 1)
          return
        }

        if (!entry.isFile()) return

        const extension = extensionForFile(entry.name)
        if (!extension) return

        try {
          const stat = await fs.stat(fullPath)
          results.push({
            path: fullPath,
            filename: entry.name,
            extension,
            fileSizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          })
        } catch {
          // Ignore files that disappear or become unreadable during the scan.
        }
      }),
    )
  }

  await visit(root, safeMaxDepth)

  return results
    .sort(
      (left, right) =>
        new Date(right.modifiedAt).getTime() -
        new Date(left.modifiedAt).getTime(),
    )
    .slice(0, safeMaxResults)
}

export function contentTypeForFilename(filename: string) {
  const extension = extensionForFile(filename)

  if (extension === '.3mf') {
    return 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
  }
  if (extension === '.obj') return 'model/obj'
  if (extension === '.step' || extension === '.stp') return 'model/step'
  if (extension === '.stl') return 'model/stl'
  if (extension === '.zip') return 'application/zip'

  return 'application/octet-stream'
}

export function safeBlobName(filename: string) {
  let safeName = ''
  let previousWasHyphen = false

  for (const char of filename.trim()) {
    const nextChar = isSafeBlobNameChar(char) ? char : '-'
    if (nextChar === '-' && previousWasHyphen) continue
    safeName += nextChar
    previousWasHyphen = nextChar === '-'
  }

  while (safeName.startsWith('-')) safeName = safeName.slice(1)
  while (safeName.endsWith('-')) safeName = safeName.slice(0, -1)

  return safeName.slice(0, 180) || 'uploaded-file'
}

export function submissionIdForLocalQuote({
  file,
  filename,
  email,
  country,
  materialPreference,
  quantity,
}: {
  file: Uint8Array
  filename: string
  email: string
  country: string
  materialPreference: string
  quantity: number | string
}) {
  const fileHash = crypto.createHash('sha256').update(file).digest('hex')
  const payload = JSON.stringify({
    fileHash,
    filename,
    email: email.trim().toLowerCase(),
    country: country.trim().toLowerCase(),
    materialPreference,
    quantity: String(quantity),
  })
  const digest = crypto.createHash('sha256').update(payload).digest('hex')

  return `mcp-local-${digest.slice(0, 48)}`
}
