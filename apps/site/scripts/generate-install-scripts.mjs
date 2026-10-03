import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProduct } from '../../../packages/product/scripts/generate.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installDir = join(root, 'scripts', 'install')
const publicDir = join(root, 'public')

const product = await readProduct()
const sh = (value) => value.replaceAll("'", "'\"'\"'")
const ps = (value) => value.replaceAll("'", "''")
const regexName = product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function render(sourceName, destName) {
  const source = readFileSync(join(installDir, sourceName), 'utf8')
  const quote = sourceName.endsWith('.ps1') ? ps : sh
  const rendered = source
    .replaceAll('__PRODUCT_NAME__', product.name)
    .replaceAll('__WEBSITE_ORIGIN__', product.websiteOrigin)
    .replaceAll('__PRODUCT_NAME_QUOTED__', quote(product.name))
    .replaceAll('__PRODUCT_NAME_REGEX_QUOTED__', quote(regexName))
    .replaceAll('__DOWNLOAD_ORIGIN_QUOTED__', quote(product.downloadOrigin))
  writeFileSync(join(publicDir, destName), rendered, 'utf8')
}

mkdirSync(publicDir, { recursive: true })
render('install.sh', 'install')
render('install.ps1', 'install.ps1')

console.log(`Generated public/install and public/install.ps1 (${product.quality})`)
