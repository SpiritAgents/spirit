import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildShadcnUiCopiedNoticeAppendix,
  readPinnedShadcnUiMit,
} from '../../../scripts/generate-notice.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const selfName = typeof pkg.name === 'string' ? pkg.name : '@spiritagent/site'

/** @param {string} startDir */
function findWorkspaceRoot(startDir) {
  let current = startDir
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) return startDir
    current = parent
  }
}

/**
 * @typedef {{ name?: string, from?: string, version?: string, path?: string, dependencies?: Record<string, PnpmListNode> }} PnpmListNode
 */

/**
 * With node-linker=hoisted at the root, license-checker started from apps/site cannot see hoisted dependencies.
 * Use pnpm list to get the site production closure (with real paths), then read each package's package.json license.
 * @param {string} workspaceRoot
 * @returns {PnpmListNode[]}
 */
function collectSiteProductionPackages(workspaceRoot) {
  const raw = execFileSync(
    'pnpm',
    ['list', '--filter', '@spiritagent/site', '--prod', '--json', '--depth', 'Infinity'],
    { cwd: workspaceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const parsed = JSON.parse(raw)
  const trees = Array.isArray(parsed) ? parsed : [parsed]
  /** @type {Map<string, PnpmListNode>} */
  const byKey = new Map()

  /**
   * @param {PnpmListNode | undefined} node
   * @param {string | undefined} nameFromKey
   */
  function walk(node, nameFromKey) {
    if (!node) return
    const name = node.name || node.from || nameFromKey
    if (name && node.version) {
      byKey.set(`${name}@${node.version}`, { ...node, name })
    }
    if (node.dependencies) {
      for (const [depName, child] of Object.entries(node.dependencies)) {
        walk(child, depName)
      }
    }
  }

  for (const tree of trees) walk(tree, undefined)
  return [...byKey.values()].sort((a, b) => {
    const nameCmp = (a.name ?? '').localeCompare(b.name ?? '')
    if (nameCmp !== 0) return nameCmp
    return (a.version ?? '').localeCompare(b.version ?? '', undefined, { numeric: true })
  })
}

/** @param {string} name */
function isPlatformSpecificPackage(name) {
  if (/^@rolldown\/binding-/.test(name)) return true
  if (/^@tailwindcss\/oxide-/.test(name)) return true
  if (/^lightningcss-(darwin|win32|linux|freebsd|android)/.test(name)) return true
  if (/^@esbuild\//.test(name)) return true
  if (name === 'fsevents') return true
  return false
}

/**
 * @param {PnpmListNode} item
 * @param {string} workspaceRoot
 */
function resolvePackageDir(item, workspaceRoot) {
  if (item.path && existsSync(join(item.path, 'package.json'))) return item.path
  if (item.name) {
    const hoisted = join(workspaceRoot, 'node_modules', ...item.name.split('/'))
    if (existsSync(join(hoisted, 'package.json'))) return hoisted
    try {
      return dirname(createRequire(join(workspaceRoot, 'package.json')).resolve(`${item.name}/package.json`))
    } catch {
      // Package is not resolvable from the hoisted workspace root.
    }
  }
  return null
}

/** @param {unknown} repository */
function repoUrl(repository) {
  /** @param {string} url */
  function normalize(url) {
    return url
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/^github:/, 'https://github.com/')
      .replace(/\.git$/, '')
  }
  if (typeof repository === 'string') return normalize(repository)
  if (repository && typeof repository === 'object' && 'url' in repository) {
    const url = /** @type {{ url?: unknown }} */ (repository).url
    if (typeof url === 'string') return normalize(url)
  }
  return ''
}

/** @param {unknown} license */
function licenseLabel(license) {
  if (typeof license === 'string' && license.trim()) return license.trim()
  if (Array.isArray(license)) {
    return license
      .map((item) => (typeof item === 'string' ? item : item?.type))
      .filter(Boolean)
      .join(' OR ')
  }
  if (license && typeof license === 'object' && 'type' in license) {
    const type = /** @type {{ type?: unknown }} */ (license).type
    if (typeof type === 'string') return type
  }
  return 'UNKNOWN'
}

const workspaceRoot = findWorkspaceRoot(root)
const packages = collectSiteProductionPackages(workspaceRoot)

const lines = []
for (const item of packages) {
  const name = item.name
  if (!name || name === selfName) continue
  if (isPlatformSpecificPackage(name)) continue

  const packageDir = resolvePackageDir(item, workspaceRoot)
  if (!packageDir) continue

  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const license = licenseLabel(manifest.license ?? manifest.licenses)
  const url = repoUrl(manifest.repository) || (typeof manifest.homepage === 'string' ? manifest.homepage : '')

  const href = url || 'undefined'
  lines.push(`- [${name}@${item.version}](${href}) - ${license}`)
}

const notice = `# Third-Party Notices

Spirit site includes open source software. The following production dependencies
are used in this project.

${lines.join('\n')}
`

const content = `${notice}\n${buildShadcnUiCopiedNoticeAppendix(readPinnedShadcnUiMit())}`
const publicDir = join(root, 'public')

mkdirSync(publicDir, { recursive: true })
writeFileSync(join(root, 'NOTICE.md'), content)
writeFileSync(join(publicDir, 'notice.md'), content)
