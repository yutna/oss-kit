// Reads literal blocks ("key: |") out of a workflow file without a YAML
// dependency, so tests can run the exact code a workflow runs.
import { readFileSync } from 'node:fs'

// Returns the body of the first "<key>: |" block found after the line that
// matches `after` (a RegExp), dedented.
export function block(file, key, after = /^/) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const from = lines.findIndex((line) => after.test(line))
  if (from === -1) throw new Error(`${file}: no line matches ${after}`)
  const header = new RegExp(`^\\s*${key}: \\|\\s*$`)
  const start = lines.findIndex((line, i) => i >= from && header.test(line))
  if (start === -1) throw new Error(`${file}: no "${key}: |" block after ${after}`)
  const indent = lines[start].search(/\S/)
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= indent) break
    body.push(line)
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop()
  const strip = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)))
  return body.map((l) => l.slice(strip)).join('\n') + '\n'
}
