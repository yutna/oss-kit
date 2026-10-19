// Runs the github-script body of .github/workflows/pr-check.yml against a
// fake GitHub API. The script is read from the workflow file itself, so a
// pull request that changes pr-check is tested with the changed logic before
// it reaches every repository through @main.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/pr-check.yml', import.meta.url))

function loadScript() {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n')
  const start = lines.findIndex((line) => /^\s*script: \|\s*$/.test(line))
  assert.notEqual(start, -1, 'pr-check.yml has no "script: |" block')
  const indent = lines[start].search(/\S/)
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= indent) break
    body.push(line)
  }
  const strip = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)))
  return body.map((l) => l.slice(strip)).join('\n')
}

const SCRIPT = loadScript()
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

const OWNER = 'yutna'
const REPO = 'sandbox'

function milestone(number, title) {
  return { number, title, state: 'open' }
}

// state: { pr, milestones, linked: [[...nodes], ...] } — `linked` is the
// sequence of GraphQL answers; the last one repeats.
async function run({ pr, milestones = [], linked = [[]], unassignable = [] }) {
  const state = structuredClone({ pr, milestones })
  state.pr.labels ??= []
  state.pr.assignees ??= []
  state.pr.milestone ??= null
  state.pr.body ??= ''
  state.pr.draft ??= false
  state.pr.user ??= { login: OWNER, type: 'User' }
  const calls = []
  let graphqlCalls = 0
  const failures = []
  const summary = []

  const rest = {
    pulls: {
      get: async () => ({ data: structuredClone(state.pr) }),
    },
    issues: {
      addAssignees: async ({ assignees }) => {
        calls.push(['addAssignees', assignees])
        // GitHub silently drops people it cannot assign (e.g. non-collaborators).
        for (const login of assignees) if (!unassignable.includes(login)) state.pr.assignees.push({ login })
        return { data: { assignees: structuredClone(state.pr.assignees) } }
      },
      update: async ({ milestone: number }) => {
        calls.push(['setMilestone', number])
        state.pr.milestone = state.milestones.find((m) => m.number === number) ?? null
        return { data: {} }
      },
      addLabels: async ({ labels }) => {
        calls.push(['addLabels', labels])
        for (const name of labels) {
          if (!state.pr.labels.some((l) => l.name === name)) state.pr.labels.push({ name })
        }
        return { data: [] }
      },
      removeLabel: async ({ name }) => {
        calls.push(['removeLabel', name])
        state.pr.labels = state.pr.labels.filter((l) => l.name !== name)
        return { data: [] }
      },
      listMilestones: async () => ({ data: structuredClone(state.milestones) }),
    },
  }
  const github = {
    rest,
    paginate: async (fn, params) => (await fn(params)).data,
    graphql: async () => {
      const nodes = linked[Math.min(graphqlCalls, linked.length - 1)]
      graphqlCalls += 1
      return { repository: { pullRequest: { closingIssuesReferences: { nodes } } } }
    },
  }
  const core = {
    info: () => {},
    notice: () => {},
    warning: () => {},
    setFailed: (message) => failures.push(message),
    summary: {
      addRaw(text) { summary.push(text); return this },
      write: async () => {},
    },
  }
  const context = {
    repo: { owner: OWNER, repo: REPO },
    payload: { pull_request: structuredClone(state.pr) },
  }
  const fastTimeout = (fn) => fn()

  await new AsyncFunction('github', 'context', 'core', 'setTimeout', SCRIPT)(
    github, context, core, fastTimeout,
  )
  return {
    pr: state.pr,
    calls,
    graphqlCalls,
    failures,
    failed: failures.length > 0,
    message: failures.join('\n'),
    summary: summary.join('\n'),
    labels: state.pr.labels.map((l) => l.name).sort(),
  }
}

const V010 = milestone(1, 'v0.1.0')
const V020 = milestone(2, 'v0.2.0')
const BACKLOG = milestone(3, 'Backlog')
const issue = (number, ms, nameWithOwner = `${OWNER}/${REPO}`) => ({
  number,
  milestone: ms ? { number: ms.number, title: ms.title, state: ms.state.toUpperCase() } : null,
  repository: { nameWithOwner },
})
const good = (overrides = {}) => ({
  number: 7,
  title: 'feat: add login',
  assignees: [{ login: OWNER }],
  milestone: V010,
  ...overrides,
})

// --- assignee -------------------------------------------------------------

test('assigns the author when the pull request has no assignees', async () => {
  const r = await run({
    pr: good({ assignees: [], user: { login: 'alice', type: 'User' } }),
    milestones: [V010],
  })
  assert.deepEqual(r.pr.assignees.map((a) => a.login), ['alice'])
  assert.equal(r.failed, false, r.message)
})

test('assigns the repository owner when the author is a bot', async () => {
  const r = await run({
    pr: good({ assignees: [], user: { login: 'dependabot[bot]', type: 'Bot' } }),
    milestones: [V010],
  })
  assert.deepEqual(r.pr.assignees.map((a) => a.login), [OWNER])
})

test('leaves existing assignees alone', async () => {
  const r = await run({ pr: good({ assignees: [{ login: 'bob' }] }), milestones: [V010] })
  assert.deepEqual(r.calls.filter(([c]) => c === 'addAssignees'), [])
})

// --- milestone ------------------------------------------------------------

test('inherits the version milestone of the linked issue', async () => {
  const r = await run({
    pr: good({ milestone: null, body: 'Closes #3' }),
    milestones: [V010, V020],
    linked: [[issue(3, V020)]],
  })
  assert.equal(r.pr.milestone?.title, 'v0.2.0')
  assert.equal(r.failed, false, r.message)
})

test('retries the linked-issue lookup while GitHub has not linked the issue yet', async () => {
  const r = await run({
    pr: good({ milestone: null, body: 'Fixes #3' }),
    milestones: [V010],
    linked: [[], [], [issue(3, V010)]],
  })
  assert.equal(r.graphqlCalls, 3)
  assert.equal(r.pr.milestone?.title, 'v0.1.0')
})

test('gives up after three retries', async () => {
  const r = await run({
    pr: good({ milestone: null, body: 'Resolves #3' }),
    milestones: [V010],
    linked: [[]],
  })
  assert.equal(r.graphqlCalls, 4)
  assert.equal(r.failed, true)
})

test('does not retry when the body has no closing keyword', async () => {
  const r = await run({ pr: good({ milestone: null, body: 'see #3' }), milestones: [V010] })
  assert.equal(r.graphqlCalls, 1)
})

test('ignores linked issues from other repositories', async () => {
  const r = await run({
    pr: good({ milestone: null, body: 'Closes other/repo#3' }),
    milestones: [V010],
    linked: [[issue(3, V010, 'other/repo')]],
  })
  assert.equal(r.pr.milestone, null)
  assert.equal(r.failed, true)
})

test('replaces a non-version pull request milestone with the linked issue version milestone', async () => {
  const r = await run({
    pr: good({ milestone: BACKLOG, body: 'Closes #3' }),
    milestones: [V010, BACKLOG],
    linked: [[issue(3, V010)]],
  })
  assert.equal(r.pr.milestone?.title, 'v0.1.0')
  assert.equal(r.failed, false, r.message)
})

test('keeps a version milestone set on the pull request', async () => {
  const r = await run({
    pr: good({ milestone: V020, body: 'Closes #3' }),
    milestones: [V010, V020],
    linked: [[issue(3, V010)]],
  })
  assert.equal(r.pr.milestone?.title, 'v0.2.0')
  assert.equal(r.graphqlCalls, 0)
})

test('fails with "move issue #N to a version milestone" when the linked issue is in Backlog', async () => {
  const r = await run({
    pr: good({ milestone: null, body: 'Closes #9' }),
    milestones: [V010, BACKLOG],
    linked: [[issue(9, BACKLOG)]],
  })
  assert.equal(r.pr.milestone, null, 'Backlog must not be copied to the pull request')
  assert.equal(r.failed, true)
  assert.match(r.message, /move issue #9 to a version milestone/)
})

test('gives a bot pull request the lowest open version milestone by SemVer', async () => {
  const r = await run({
    pr: good({ milestone: null, assignees: [], user: { login: 'dependabot[bot]', type: 'Bot' },
      title: 'chore(deps): bump actions/checkout from 6 to 7' }),
    milestones: [BACKLOG, milestone(10, 'v0.10.0'), milestone(9, 'v0.9.1'), milestone(8, 'v1.0.0'), milestone(11, 'next')],
  })
  assert.equal(r.pr.milestone?.title, 'v0.9.1')
  assert.equal(r.failed, false, r.message)
})

test('fails a bot pull request when no version milestone is open', async () => {
  const r = await run({
    pr: good({ milestone: null, user: { login: 'dependabot[bot]', type: 'Bot' },
      title: 'chore(deps): bump x' }),
    milestones: [BACKLOG],
  })
  assert.equal(r.failed, true)
  assert.match(r.message, /create the next version milestone/)
})

test('fails a human pull request without milestone or linked issue', async () => {
  const r = await run({ pr: good({ milestone: null }), milestones: [V010] })
  assert.equal(r.pr.milestone, null)
  assert.equal(r.failed, true)
  assert.match(r.message, /version milestone/)
})

test('fails a pull request whose milestone is not a version milestone', async () => {
  const r = await run({ pr: good({ milestone: BACKLOG }), milestones: [V010, BACKLOG] })
  assert.equal(r.failed, true)
  assert.match(r.message, /Backlog/)
})

// --- labels ---------------------------------------------------------------

const KIND = [
  ['feat', 'enhancement'], ['perf', 'enhancement'], ['fix', 'bug'], ['docs', 'documentation'],
  ['chore', 'chore'], ['refactor', 'chore'], ['test', 'chore'], ['ci', 'chore'],
  ['build', 'chore'], ['style', 'chore'], ['revert', 'chore'],
]
for (const [type, label] of KIND) {
  test(`labels a "${type}" pull request "${label}"`, async () => {
    const r = await run({ pr: good({ title: `${type}: something` }), milestones: [V010] })
    assert.deepEqual(r.labels, [label])
  })
}

test('replaces a stale kind label and keeps unrelated labels', async () => {
  const r = await run({
    pr: good({ title: 'fix(api): handle nulls', labels: [{ name: 'enhancement' }, { name: 'priority: high' }] }),
    milestones: [V010],
  })
  assert.deepEqual(r.labels, ['bug', 'priority: high'])
})

test('adds "breaking" for "!" and removes it when "!" is gone', async () => {
  const on = await run({ pr: good({ title: 'feat(api)!: drop v1' }), milestones: [V010] })
  assert.deepEqual(on.labels, ['breaking', 'enhancement'])
  const off = await run({
    pr: good({ title: 'feat(api): drop v1', labels: [{ name: 'breaking' }, { name: 'enhancement' }] }),
    milestones: [V010],
  })
  assert.deepEqual(off.labels, ['enhancement'])
})

test('does not touch labels that are already right', async () => {
  const r = await run({ pr: good({ labels: [{ name: 'enhancement' }] }), milestones: [V010] })
  assert.deepEqual(r.calls.filter(([c]) => c === 'addLabels' || c === 'removeLabel'), [])
})

// --- title and overall validation ------------------------------------------

for (const title of ['update stuff', 'feat:missing space', 'Feat: capital', 'feat(API): upper scope', 'feature: nope', 'feat: ']) {
  test(`rejects the title "${title}" and leaves labels alone`, async () => {
    const r = await run({ pr: good({ title, labels: [{ name: 'bug' }] }), milestones: [V010] })
    assert.equal(r.failed, true)
    assert.match(r.message, /Conventional Commits/)
    assert.deepEqual(r.labels, ['bug'])
  })
}

for (const title of ['feat: add login', 'fix(ui/button): x', 'chore(deps)!: bump', 'docs(readme.md): y', 'revert: "feat: x"']) {
  test(`accepts the title "${title}"`, async () => {
    const r = await run({ pr: good({ title }), milestones: [V010] })
    assert.equal(r.failed, false, r.message)
  })
}

test('passes a draft pull request that meets every rule', async () => {
  const r = await run({ pr: good({ draft: true }), milestones: [V010] })
  assert.equal(r.failed, false, r.message)
})

test('reports every problem in one failure and in the step summary', async () => {
  const r = await run({ pr: good({ title: 'update stuff', milestone: null }), milestones: [V010] })
  assert.equal(r.failures.length, 1)
  assert.match(r.message, /Conventional Commits/)
  assert.match(r.message, /milestone/)
  assert.match(r.summary, /Conventional Commits/)
})

// --- workflow shape ---------------------------------------------------------

test('pr-check never cancels a run in progress', () => {
  // Two events at once start two runs. A cancelled run can be the one in the
  // newer check suite, and GitHub then reports the required check as
  // cancelled although the other run passed. Every write here is idempotent
  // and every run validates freshly read state, so runs may overlap.
  const workflow = readFileSync(WORKFLOW, 'utf8')
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/)
})

// --- closed milestones and unassignable authors ----------------------------

const V010_CLOSED = { number: 1, title: 'v0.1.0', state: 'closed' }

test('does not inherit a closed version milestone from a linked issue', async () => {
  const r = await run({
    pr: good({ milestone: null, body: 'Fixes #3' }),
    milestones: [V010_CLOSED, V020],
    linked: [[issue(3, V010_CLOSED)]],
  })
  assert.equal(r.pr.milestone, null)
  assert.equal(r.failed, true)
  assert.match(r.message, /issue #3 is in closed milestone "v0\.1\.0"/)
})

test('fails a pull request in a closed version milestone', async () => {
  const r = await run({ pr: good({ milestone: V010_CLOSED }), milestones: [V010_CLOSED] })
  assert.equal(r.failed, true)
  assert.match(r.message, /closed/)
})

test('replaces a closed pull request milestone with the linked issue open one', async () => {
  const r = await run({
    pr: good({ milestone: V010_CLOSED, body: 'Fixes #3' }),
    milestones: [V010_CLOSED, V020],
    linked: [[issue(3, V020)]],
  })
  assert.equal(r.pr.milestone?.title, 'v0.2.0')
  assert.equal(r.failed, false, r.message)
})

test('assigns the repository owner when the author cannot be assigned', async () => {
  const r = await run({
    pr: good({ assignees: [], user: { login: 'stranger', type: 'User' } }),
    milestones: [V010],
    unassignable: ['stranger'],
  })
  assert.deepEqual(r.pr.assignees.map((a) => a.login), [OWNER])
  assert.equal(r.failed, false, r.message)
})
