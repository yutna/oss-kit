// Tests bootstrap/oss-kit under /bin/bash (3.2 on macOS) — the shell the CLI
// promises to support. Pure functions are sourced with OSS_KIT_LIB=1; the
// commands run against a fake `gh` that answers from fixture files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bootstrap/oss-kit', import.meta.url))
const BASH = existsSync('/bin/bash') ? '/bin/bash' : 'bash'
const US = '\x1f'

function tmp() {
  return mkdtempSync(join(tmpdir(), 'oss-kit-test-'))
}

// Runs `snippet` after sourcing the CLI as a library.
function lib(snippet, { env = {}, cwd } = {}) {
  const r = spawnSync(BASH, ['-c', `OSS_KIT_LIB=1 . "${CLI}" && ${snippet}`], {
    encoding: 'utf8', cwd, env: { ...process.env, ...env },
  })
  return { status: r.status, out: r.stdout, err: r.stderr }
}

function json(dir, name, value) {
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(value))
  return file
}

const rows = (out) => out.split('\n').filter(Boolean).map((l) => l.split(US).join('|'))

const label = (name, color = 'ffffff', description = '') => ({ name, color, description })
const CORE = JSON.parse(readFileSync(fileURLToPath(new URL('../bootstrap/labels.json', import.meta.url)), 'utf8'))

// --- label_plan -------------------------------------------------------------

test('label_plan: a repository with exactly the core labels needs nothing', () => {
  const d = tmp()
  const r = lib(`label_plan "${json(d, 'l.json', CORE)}" yutna/x 1 1`)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(rows(r.out), [])
})

test('label_plan: GitHub default labels on a new repository', () => {
  const d = tmp()
  const defaults = [
    label('bug', 'd73a4a', "Something isn't working"),
    label('documentation', '0075ca', 'Improvements or additions to documentation'),
    label('duplicate', 'cfd3d7', 'This issue or pull request already exists'),
    label('enhancement', 'a2eeef', 'New feature or request'),
    label('good first issue', '7057ff', 'Good for newcomers'),
    label('help wanted', '008672', 'Extra attention is needed'),
    label('invalid', 'e4e669', "This doesn't seem right"),
    label('question', 'd876e3', 'Further information is requested'),
    label('wontfix', 'ffffff', 'This will not be worked on'),
  ]
  const r = lib(`label_plan "${json(d, 'l.json', defaults)}" yutna/new 0 1`)
  assert.equal(r.status, 0, r.err)
  const plan = rows(r.out)
  for (const name of ['duplicate', 'invalid', 'wontfix']) assert.ok(plan.includes(`prune|${name}`), name)
  assert.ok(plan.includes('upsert|enhancement|a2eeef|New feature or improvement'))
  assert.ok(plan.includes('upsert|chore|cfd3d7|Maintenance, refactoring, CI, build, tests'))
  assert.ok(!plan.some((p) => p.startsWith('upsert|bug|')), 'bug is already right')
  // documentation, enhancement, help wanted, question differ; 7 core labels are missing.
  assert.equal(plan.filter((p) => p.startsWith('upsert|')).length, 11, plan.join('\n'))
})

test('label_plan: migration renames, merges, deletes and keeps extensions', () => {
  const d = tmp()
  const current = [
    label('bug', 'd73a4a', "Something isn't working"),
    label('feature', '00ff00', 'old'),
    label('proposal', '0000ff', 'old'),
    label('breaking-change', 'b60205', 'Breaking change'),
    label('priority: medium'),
    label('wontfix'),
    label('skill', '123456', 'A skill'),
    label('random-extra'),
  ]
  const r = lib(`label_plan "${json(d, 'l.json', current)}" yutna/functional-design-skills 1 1`)
  assert.equal(r.status, 0, r.err)
  const plan = rows(r.out)
  const idx = (p) => plan.indexOf(p)
  assert.ok(idx('rename|feature|enhancement') >= 0, plan.join('\n'))
  assert.ok(idx('merge|proposal|enhancement') > idx('rename|feature|enhancement'), 'proposal merges into the renamed label')
  assert.ok(idx('rename|breaking-change|breaking') >= 0)
  assert.ok(idx('delete|priority: medium') >= 0)
  assert.ok(idx('delete|wontfix') >= 0)
  assert.ok(!plan.includes('delete|triage'), 'labels that do not exist are not deleted')
  assert.ok(idx('upsert|enhancement|a2eeef|New feature or improvement') > idx('rename|feature|enhancement'), 'renamed label gets core colour')
  assert.ok(!plan.some((p) => p.includes('|skill')), 'extension is kept')
  assert.ok(idx('prune|random-extra') >= 0)
  assert.ok(!plan.includes('prune|feature'), 'renamed label is not pruned')
})

test('label_plan: without --migrate-labels nothing is renamed and without --prune-labels nothing is pruned', () => {
  const d = tmp()
  const r = lib(`label_plan "${json(d, 'l.json', [label('feature'), label('random-extra')])}" yutna/x 0 0`)
  const plan = rows(r.out)
  assert.ok(!plan.some((p) => /^(rename|merge|delete|prune)\|/.test(p)), plan.join('\n'))
  assert.equal(plan.filter((p) => p.startsWith('upsert|')).length, 13)
})

test('label_plan: names match case-insensitively', () => {
  const d = tmp()
  const current = CORE.map((l) => (l.name === 'bug' ? { ...l, name: 'Bug' } : l)).concat([label('Feature')])
  const plan = rows(lib(`label_plan "${json(d, 'l.json', current)}" yutna/x 1 1`).out)
  assert.ok(!plan.some((p) => p.startsWith('upsert|bug|')), plan.join('\n'))
  assert.ok(plan.includes('merge|Feature|enhancement'), plan.join('\n'))
})

test('label_plan: a label whose colour or description differs is updated', () => {
  const d = tmp()
  const current = CORE.map((l) => (l.name === 'blocked' ? { ...l, color: 'FBCA04', description: 'x' } : l))
  assert.deepEqual(rows(lib(`label_plan "${json(d, 'l.json', current)}" yutna/x 0 1`).out),
    ['upsert|blocked|fbca04|Waiting on something else'])
})

// --- settings_drift ---------------------------------------------------------

const GOOD_SETTINGS = {
  has_issues: true, has_wiki: false, has_projects: false, has_discussions: false,
  allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false,
  delete_branch_on_merge: true, allow_auto_merge: true, allow_update_branch: true,
  squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'BLANK',
}

test('settings_drift: none when every setting matches', () => {
  const d = tmp()
  const r = lib(`settings_drift "${json(d, 'r.json', { ...GOOD_SETTINGS, name: 'x', is_template: true })}"`)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(rows(r.out), [])
})

test('settings_drift: lists each differing setting with current and desired value', () => {
  const d = tmp()
  const r = lib(`settings_drift "${json(d, 'r.json', { ...GOOD_SETTINGS, has_wiki: true, allow_rebase_merge: true, squash_merge_commit_message: 'COMMIT_MESSAGES' })}"`)
  assert.deepEqual(rows(r.out).sort(), [
    'allow_rebase_merge|true|false',
    'has_wiki|true|false',
    'squash_merge_commit_message|COMMIT_MESSAGES|BLANK',
  ])
})

// --- json_subset ------------------------------------------------------------

test('json_subset: a ruleset as GitHub returns it matches the spec file', () => {
  const d = tmp()
  const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../bootstrap/ruleset-main.json', import.meta.url)), 'utf8'))
  const actual = {
    ...structuredClone(spec), id: 42, source_type: 'Repository', source: 'yutna/x',
    created_at: 'x', _links: {},
    rules: [...spec.rules].reverse().map((r) => (r.type === 'pull_request'
      ? { ...r, parameters: { ...r.parameters, automatic_copilot_code_review_enabled: false } }
      : r)),
  }
  assert.equal(lib(`json_subset "${json(d, 's.json', spec)}" "${json(d, 'a.json', actual)}"`).status, 0)
})

test('json_subset: a changed required check does not match', () => {
  const d = tmp()
  const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../bootstrap/ruleset-main.json', import.meta.url)), 'utf8'))
  const actual = structuredClone(spec)
  actual.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.pop()
  assert.notEqual(lib(`json_subset "${json(d, 's.json', spec)}" "${json(d, 'a.json', actual)}"`).status, 0)
})

test('json_subset: bypass mode "always" does not match "pull_request"', () => {
  const d = tmp()
  const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../bootstrap/ruleset-main.json', import.meta.url)), 'utf8'))
  const actual = structuredClone(spec)
  actual.bypass_actors[0].bypass_mode = 'always'
  assert.notEqual(lib(`json_subset "${json(d, 's.json', spec)}" "${json(d, 'a.json', actual)}"`).status, 0)
})

// --- placeholders and stacks -----------------------------------------------

test('fill_placeholders replaces every placeholder, keeps ${{ }} expressions and handles special characters', () => {
  const d = tmp()
  mkdirSync(join(d, '.github/workflows'), { recursive: true })
  writeFileSync(join(d, 'LICENSE'), 'Copyright (c) {{YEAR}} {{FULLNAME}}\n')
  writeFileSync(join(d, 'README.md'), '# {{REPO}}\n\n{{DESCRIPTION}}\n\nhttps://github.com/{{OWNER}}/{{REPO}}\n')
  writeFileSync(join(d, '.github/workflows/ci.yml'), 'group: ci-${{ github.ref }}\n')
  spawnSync('git', ['init', '-q'], { cwd: d })
  spawnSync('git', ['add', '-A'], { cwd: d })
  const r = lib(`fill_placeholders "${d}" my-repo 'A & B / $HOME \\1 "quoted"'`)
  assert.equal(r.status, 0, r.err)
  const year = new Date().getFullYear()
  assert.equal(readFileSync(join(d, 'LICENSE'), 'utf8'), `Copyright (c) ${year} Yutthana Siphuengchai\n`)
  assert.equal(readFileSync(join(d, 'README.md'), 'utf8'),
    '# my-repo\n\nA & B / $HOME \\1 "quoted"\n\nhttps://github.com/yutna/my-repo\n')
  assert.equal(readFileSync(join(d, '.github/workflows/ci.yml'), 'utf8'), 'group: ci-${{ github.ref }}\n')
})

test('fill_placeholders fails when an unknown placeholder is left', () => {
  const d = tmp()
  writeFileSync(join(d, 'README.md'), '{{REPO}} {{UNKNOWN}}\n')
  spawnSync('git', ['init', '-q'], { cwd: d })
  spawnSync('git', ['add', '-A'], { cwd: d })
  const r = lib(`fill_placeholders "${d}" r d`)
  assert.notEqual(r.status, 0)
  assert.match(r.err, /UNKNOWN/)
})

test('stacks map to gitignore templates and Dependabot ecosystems', () => {
  const cases = {
    node: ['Node', 'npm'], 'java-maven': ['Java Maven', 'maven'], 'java-gradle': ['Java Gradle', 'gradle'],
    ruby: ['Ruby', 'bundler'], swift: ['Swift', 'swift'], python: ['Python', 'pip'],
    go: ['Go', 'gomod'], elixir: ['Elixir', 'mix'], none: ['', ''],
  }
  for (const [stack, [gitignore, eco]] of Object.entries(cases)) {
    assert.equal(lib(`stack_gitignore ${stack}`).out.trim(), gitignore, stack)
    assert.equal(lib(`stack_ecosystem ${stack}`).out.trim(), eco, stack)
  }
  assert.notEqual(lib('stack_ecosystem cobol').status, 0)
})

test('dependabot_block follows the core conventions', () => {
  const out = lib('dependabot_block npm').out
  for (const line of ['  - package-ecosystem: npm', '    labels: [dependencies]', '    assignees: [yutna]',
    '      prefix: chore', '      include: scope']) {
    assert.ok(out.split('\n').includes(line), `${line}\n---\n${out}`)
  }
})

// --- commands ---------------------------------------------------------------

function fakeGh(dir, script) {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'gh'), `#!/bin/bash\nprintf 'gh %s\\n' "$*" >> "${join(dir, 'gh.log')}"\n${script}\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(join(dir, 'gh.log'), '')
  return bin
}

function cli(args, { bin } = {}) {
  const r = spawnSync(BASH, [CLI, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: bin ? `${bin}:${process.env.PATH}` : process.env.PATH },
  })
  return { status: r.status, out: r.stdout, err: r.stderr }
}

test('no command prints usage and exits 2', () => {
  const r = cli([])
  assert.equal(r.status, 2)
  assert.match(r.err, /usage: oss-kit/i)
})

test('unknown stack is rejected before anything is created', () => {
  const d = tmp()
  const bin = fakeGh(d, 'exit 0')
  const r = cli(['new', 'x', '--description', 'd', '--stack', 'cobol', '--dir', d], { bin })
  assert.equal(r.status, 2)
  assert.match(r.err, /stack/)
  assert.ok(!readFileSync(join(d, 'gh.log'), 'utf8').includes('repo create'))
})

test('apply refuses a private repository and changes nothing', () => {
  const d = tmp()
  const bin = fakeGh(d, `case "$*" in
  "api repos/yutna/my-notes") echo '{"full_name":"yutna/my-notes","visibility":"private","private":true,"permissions":{"admin":true}}' ;;
  *) echo "unexpected: $*" >&2; exit 99 ;;
esac`)
  const r = cli(['apply', 'yutna/my-notes'], { bin })
  assert.notEqual(r.status, 0)
  assert.match(r.err, /private/)
  const log = readFileSync(join(d, 'gh.log'), 'utf8').trim().split('\n')
  assert.deepEqual(log, ['gh api repos/yutna/my-notes'])
})

test('doctor refuses a private repository', () => {
  const d = tmp()
  const bin = fakeGh(d, `echo '{"full_name":"yutna/my-notes","visibility":"private","private":true,"permissions":{"admin":true}}'`)
  const r = cli(['doctor', 'yutna/my-notes'], { bin })
  assert.notEqual(r.status, 0)
  assert.match(r.err, /private/)
})

// A fake gh for a public repository that already matches the spec, plus the
// extension label "area: app". Matching is case-insensitive, like GitHub.
function compliantRepoGh(dir) {
  const labels = JSON.stringify([...CORE, label('area: app', 'ededed', 'App')])
  const repo = JSON.stringify({ ...GOOD_SETTINGS, full_name: 'yutna/ollama-bar', visibility: 'public',
    default_branch: 'main', topics: [], permissions: { admin: true },
    security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } })
  writeFileSync(join(dir, "repo.json"), repo)
  writeFileSync(join(dir, "labels.json"), labels)
  return fakeGh(dir, `args=$(printf '%s' "$*" | tr '[:upper:]' '[:lower:]')
case "$args" in
  "api repos/yutna/ollama-bar") cat "${join(dir, "repo.json")}" ;;
  *"/actions/permissions/workflow --jq"*) echo "read false" ;;
  *"/vulnerability-alerts --silent") ;;
  *"/automated-security-fixes --jq .enabled") echo true ;;
  *"/private-vulnerability-reporting --jq .enabled") echo true ;;
  *"/code-scanning/default-setup --jq .state") echo configured ;;
  "label list -r yutna/ollama-bar --limit 500 --json name,color,description") cat "${join(dir, "labels.json")}" ;;
  *"/milestones?state=all"*) printf 'v1.0.0\\037closed\\0371\\nBacklog\\037open\\0372\\nv1.1.0\\037open\\0373\\n' ;;
  *"/branches/main/protection --silent") exit 1 ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 99 ;;
esac`)
}

test('apply --prune-labels keeps extensions even when the repository name is typed in another case', () => {
  const d = tmp()
  const r = cli(['apply', 'yutna/Ollama-Bar', '--dry-run', '--prune-labels', '--skip-rulesets'], { bin: compliantRepoGh(d) })
  assert.equal(r.status, 0, r.err)
  assert.doesNotMatch(r.err, /area: app/)
  assert.match(r.err, /0 change\(s\) would be made/)
})

test('apply recognises an existing open Backlog among other milestones', () => {
  const d = tmp()
  const r = cli(['apply', 'yutna/ollama-bar', '--dry-run', '--skip-rulesets', '--milestone', 'v1.1.0'], { bin: compliantRepoGh(d) })
  assert.equal(r.status, 0, r.err)
  assert.match(r.err, /== milestones\n {2}ok/)
})

test('new refuses the name ".github"', () => {
  const d = tmp()
  const bin = fakeGh(d, 'exit 0')
  const r = cli(['new', '.github', '--description', 'd', '--dir', d], { bin })
  assert.notEqual(r.status, 0)
  assert.match(r.err, /\.github/)
  assert.ok(!readFileSync(join(d, 'gh.log'), 'utf8').includes('repo create'))
})
