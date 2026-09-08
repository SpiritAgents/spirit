import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installDir = join(root, 'scripts', 'install')
const publicDir = join(root, 'public')

/** Keep in sync with `src/lib/spirit-download-urls.ts` SPIRIT_DOWNLOAD_HOST. */
const SPIRIT_DOWNLOAD_HOST = 'download.spirit.dev'
const PLACEHOLDER = '__SPIRIT_DOWNLOAD_HOST__'

function render(sourceName, destName) {
  const source = readFileSync(join(installDir, sourceName), 'utf8')
  if (!source.includes(PLACEHOLDER)) {
    throw new Error(`${sourceName} is missing placeholder ${PLACEHOLDER}`)
  }
  const rendered = source.replaceAll(PLACEHOLDER, SPIRIT_DOWNLOAD_HOST)
  writeFileSync(join(publicDir, destName), rendered, 'utf8')
}

mkdirSync(publicDir, { recursive: true })
render('install.sh', 'install')
render('install.ps1', 'install.ps1')

console.log(`Generated public/install and public/install.ps1 (host=${SPIRIT_DOWNLOAD_HOST})`)
