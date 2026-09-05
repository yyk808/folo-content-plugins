import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("folo-plugins.manifest.json", root), "utf8"))
if (manifest.schemaVersion !== 1 || manifest.hostApiVersion !== 1) throw new Error("Unsupported manifest version")
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Expected a stable semantic version")
const files = {}
for (const file of [...manifest.modules, ...(manifest.stylesheet ? [manifest.stylesheet] : [])]) {
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:mjs|css)$/.test(file.path)) throw new Error(`Invalid path: ${file.path}`)
  if (Object.hasOwn(files, file.path)) throw new Error(`Duplicate file: ${file.path}`)
  const source = await readFile(new URL(file.path, root), "utf8")
  file.sha256 = createHash("sha256").update(source).digest("hex")
  files[file.path] = source
}
const stages = { acquire: "acquire", "pre-extract": "preExtract", extract: "extract", "article-transform": "articleTransform" }
const snippets = new Set()
for (const snippet of manifest.snippets) {
  if (snippets.has(snippet.id)) throw new Error(`Duplicate snippet: ${snippet.id}`)
  snippets.add(snippet.id)
  if (!Object.hasOwn(files, snippet.module)) throw new Error(`Missing module: ${snippet.module}`)
  const module = await import(new URL(snippet.module, root))
  if (typeof module[stages[snippet.injectionPoint]] !== "function") throw new Error(`Missing export for ${snippet.id}`)
  if (!snippet.permissions?.network || !snippet.permissions?.output) throw new Error(`Missing permissions for ${snippet.id}`)
}
const processors = new Set()
for (const processor of manifest.processors) {
  if (processors.has(processor.id)) throw new Error(`Duplicate processor: ${processor.id}`)
  processors.add(processor.id)
  if (processor.match.feedIds.length || processor.match.sourceIds.length) throw new Error(`Personal IDs must stay out of the release: ${processor.id}`)
  for (const pattern of processor.match.urlPatterns) new RegExp(pattern)
  for (const snippet of processor.steps) if (!snippets.has(snippet)) throw new Error(`Missing pipeline stage: ${snippet}`)
}
const serialized = JSON.stringify({ manifest, files })
if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw new Error("Package exceeds 16 MiB")
await mkdir(new URL("dist/", root), { recursive: true })
const output = new URL("dist/folo-plugins.json", root)
await writeFile(output, serialized)
console.log(`${manifest.processors.length} plugins, ${manifest.snippets.length} stages → ${fileURLToPath(output)}`)
