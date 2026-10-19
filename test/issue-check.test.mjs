// Runs the github-script body of .github/workflows/issue-check.yml against a
// fake GitHub API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { block } from './lib/workflow.mjs'

const SCRIPT = block(fileURLToPath(new URL('../.github/workflows/issue-check.yml', import.meta.url)), 'script')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function run(issue) {
  const added = []
  const github = {
    rest: {
      issues: {
        get: async () => ({ data: structuredClone(issue) }),
        addAssignees: async ({ issue_number, assignees }) => {
          added.push({ issue_number, assignees })
          return { data: {} }
        },
      },
    },
  }
  const core = { info: () => {}, warning: () => {} }
  const context = { repo: { owner: 'yutna', repo: 'sandbox' }, payload: { issue: structuredClone(issue) } }
  await new AsyncFunction('github', 'context', 'core', SCRIPT)(github, context, core)
  return added
}

test('assigns the repository owner to a new issue without assignees', async () => {
  assert.deepEqual(await run({ number: 5, assignees: [], user: { login: 'stranger' } }),
    [{ issue_number: 5, assignees: ['yutna'] }])
})

test('leaves an issue that already has an assignee alone', async () => {
  assert.deepEqual(await run({ number: 5, assignees: [{ login: 'bob' }], user: { login: 'bob' } }), [])
})
