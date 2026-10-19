// Runs the shell steps of .github/workflows/release.yml with a fake `gh` on
// PATH, the way GitHub runs them (bash --noprofile --norc -eo pipefail).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { block } from './lib/workflow.mjs'

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url))
const step = (id) => block(WORKFLOW, 'run', new RegExp(`^\\s*(- )?id: ${id}\\s*$`))

const FAKE_GH = `#!/bin/bash
printf 'gh %s\\n' "$*" >> "$FAKE_LOG"
case "$*" in
  "api repos/"*"/milestones/"*" --jq "*) echo "\${FAKE_STATE:-closed} \${FAKE_OPEN:-0} \${FAKE_TITLE:-\$TAG}" ;;
  "api -X PATCH repos/"*"/milestones/"*" -f state=open --silent") ;;
  "release view "*) [ -z "\${FAKE_RELEASE_VIEW_ERROR:-}" ] || { echo "HTTP 502: Bad Gateway" >&2; exit 1; }
    [ -n "\${FAKE_RELEASE_EXISTS:-}" ] || { echo "release not found" >&2; exit 1; }
    echo "\${FAKE_RELEASE_DRAFT:-false}" ;;
  "api repos/"*"/git/ref/tags/"*" --silent") [ -n "\${FAKE_TAG_EXISTS:-}" ] || { echo "HTTP 404" >&2; exit 1; } ;;
  "api repos/"*"/commits/"*" --jq .sha") echo "\${FAKE_SHA:-0123abc}" ;;
  "release create "*) ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 99 ;;
esac
`

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'))
  writeFileSync(join(dir, 'gh'), FAKE_GH)
  chmodSync(join(dir, 'gh'), 0o755)
  writeFileSync(join(dir, 'log'), '')
  writeFileSync(join(dir, 'output'), '')
  return dir
}

function runStep(dir, id, env) {
  const script = join(dir, `${id}.sh`)
  writeFileSync(script, step(id))
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_LOG: join(dir, 'log'),
      GITHUB_OUTPUT: join(dir, 'output'),
      REPO: 'yutna/sandbox',
      NUMBER: '4',
      BRANCH: 'main',
      ...env,
    },
  })
  const outputs = Object.fromEntries(readFileSync(join(dir, 'output'), 'utf8')
    .split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)))
  const calls = readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean)
  return { status: result.status, out: result.stdout + result.stderr, outputs, calls }
}

const reopened = (calls) => calls.some((c) => c.startsWith('gh api -X PATCH repos/yutna/sandbox/milestones/4 -f state=open'))

test('skips a milestone whose title is not vX.Y.Z', () => {
  for (const TAG of ['Backlog', 'test-non-semver', 'v1.2', 'v1.0.0-rc.1', '1.2.0']) {
    const r = runStep(sandbox(), 'decide', { TAG })
    assert.equal(r.status, 0, r.out)
    assert.equal(r.outputs.go, 'false', TAG)
    assert.match(r.out, /not a release milestone/)
    assert.equal(reopened(r.calls), false)
  }
})

test('reopens the milestone and fails while it has open items', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_OPEN: '2' })
  assert.notEqual(r.status, 0)
  assert.equal(reopened(r.calls), true)
  assert.match(r.out, /::error::Milestone still has 2 open items; reopened/)
})

test('skips when the release already exists', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_RELEASE_EXISTS: '1' })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.outputs.go, 'false')
  assert.match(r.out, /already released/)
})

test('skips when the tag already exists without a release', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_TAG_EXISTS: '1' })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.outputs.go, 'false')
})

test('goes ahead for a complete, unreleased version milestone and pins the commit', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_SHA: 'feedbeef' })
  assert.equal(r.status, 0, r.out)
  assert.deepEqual(
    { go: r.outputs.go, version: r.outputs.version, sha: r.outputs.sha },
    { go: 'true', version: 'v1.2.0', sha: 'feedbeef' },
  )
  assert.equal(reopened(r.calls), false)
})

test('reports the version even when it skips, so callers can read it', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_RELEASE_EXISTS: '1' })
  assert.equal(r.outputs.version, 'v1.2.0')
})

test('preflight gets VERSION without "v" and TAG with it', () => {
  const dir = sandbox()
  const r = runStep(dir, 'preflight', {
    TAG: 'v1.2.0', PREFLIGHT: 'printf "%s %s" "$VERSION" "$TAG" > "$FAKE_SEEN"', FAKE_SEEN: join(dir, 'seen'),
  })
  assert.equal(r.status, 0, r.out)
  assert.equal(readFileSync(join(dir, 'seen'), 'utf8'), '1.2.0 v1.2.0')
  assert.equal(reopened(r.calls), false)
})

test('a failing preflight reopens the milestone and fails', () => {
  const r = runStep(sandbox(), 'preflight', { TAG: 'v1.2.0', PREFLIGHT: 'false' })
  assert.notEqual(r.status, 0)
  assert.equal(reopened(r.calls), true)
  assert.match(r.out, /::error::/)
})

test('creates the release at the pinned commit with generated notes', () => {
  const r = runStep(sandbox(), 'release', { TAG: 'v1.2.0', SHA: 'feedbeef' })
  assert.equal(r.status, 0, r.out)
  assert.ok(r.calls.includes('gh release create v1.2.0 -R yutna/sandbox --target feedbeef --title v1.2.0 --generate-notes'), r.calls.join('\n'))
  assert.equal(r.outputs.released, 'true')
})

test('skips a milestone that is open again, e.g. a re-run after it was reopened', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_STATE: 'open' })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.outputs.go, 'false')
  assert.match(r.out, /is open/)
  assert.equal(reopened(r.calls), false)
})

test('preflight runs without the GitHub token', () => {
  const dir = sandbox()
  const r = runStep(dir, 'preflight', {
    TAG: 'v1.2.0', GH_TOKEN: 'secret', FAKE_SEEN: join(dir, 'seen'),
    PREFLIGHT: 'printf "%s" "${GH_TOKEN:-unset}" > "$FAKE_SEEN"',
  })
  assert.equal(r.status, 0, r.out)
  assert.equal(readFileSync(join(dir, 'seen'), 'utf8'), 'unset')
})

test('a failing preflight still reopens the milestone with the token', () => {
  const r = runStep(sandbox(), 'preflight', { TAG: 'v1.2.0', GH_TOKEN: 'secret', PREFLIGHT: 'false' })
  assert.notEqual(r.status, 0)
  assert.equal(reopened(r.calls), true)
})

test('release runs are never queued behind each other', () => {
  // A concurrency group lets GitHub cancel a pending run, which would drop a
  // release silently. Two runs for the same tag fail loudly on create instead.
  assert.doesNotMatch(readFileSync(WORKFLOW, 'utf8'), /^\s*concurrency:/m)
})

test('a draft release with the same tag reopens the milestone and fails', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_RELEASE_EXISTS: '1', FAKE_RELEASE_DRAFT: 'true' })
  assert.notEqual(r.status, 0)
  assert.equal(reopened(r.calls), true)
  assert.match(r.out, /::error::A draft release v1\.2\.0 exists/)
})

test('a re-run never publishes an existing release on its own, and says how to', () => {
  // The release may be an old tag or the work of a later run; only
  // "Re-run failed jobs" (which keeps the release job's outputs) publishes again.
  const rerun = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_RELEASE_EXISTS: '1', ATTEMPT: '2' })
  assert.equal(rerun.status, 0, rerun.out)
  assert.equal(rerun.outputs.go, 'false')
  assert.equal(rerun.outputs.republish, undefined)
  assert.match(rerun.out, /Re-run failed jobs/)
})

test('the released output is only the release step', () => {
  assert.match(readFileSync(WORKFLOW, 'utf8'), /released: \$\{\{ steps\.release\.outputs\.released \|\| 'false' \}\}/)
})

test('skips when the milestone was renamed since the event', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_TITLE: 'v1.2.1' })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.outputs.go, 'false')
  assert.match(r.out, /renamed/)
})

test('fails loudly when the release lookup errors for another reason', () => {
  const r = runStep(sandbox(), 'decide', { TAG: 'v1.2.0', FAKE_RELEASE_VIEW_ERROR: '1' })
  assert.notEqual(r.status, 0)
  assert.match(r.out, /::error::Could not check for an existing release/)
  assert.ok(!r.calls.some((c) => c.startsWith('gh release create')))
})
