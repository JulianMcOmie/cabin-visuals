// Sum the JS the /editor page actually loads (page chunk + its async imports), gzip.
import { readFileSync, readdirSync, statSync } from 'fs'
import { gzipSync } from 'zlib'
const dist = process.argv[2] ?? '.next-build-audit'
const chunksDir = `${dist}/static/chunks/`
const page = readFileSync(`${chunksDir}app/editor/${readdirSync(`${chunksDir}app/editor/`).find((f) => f.startsWith('page-'))}`, 'utf8')
const refs = new Set([...page.matchAll(/static\/chunks\/([\w.-]+\.js)/g)].map((m) => m[1]))
let raw = 0, gz = 0
for (const f of refs) { try { const b = readFileSync(chunksDir + f); raw += b.length; gz += gzipSync(b).length } catch {} }
console.log(`editor async chunks: ${refs.size} files, ${(raw / 1e6).toFixed(2)} MB raw, ${(gz / 1e6).toFixed(2)} MB gz`)
