# oss-kit

[![ci](https://github.com/yutna/oss-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/yutna/oss-kit/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The shared workflow for [yutna](https://github.com/yutna)'s public
repositories: reusable GitHub Actions workflows, a bootstrap CLI, and the
label and ruleset definitions they apply. Every public repository gets the
same core regardless of language; stack-specific parts (CI jobs, ignore
files, Dependabot ecosystems, publishing) are added on top per repository.

The rules themselves are in [docs/conventions.md](docs/conventions.md). To bring an existing
repository onto the workflow, follow [docs/adopting.md](docs/adopting.md).

## What lives where

| Piece | Where | Reaches repositories |
|---|---|---|
| Reusable workflows: `pr-check`, `issue-check`, `release` | `.github/workflows/` here | Live: callers use `@main` |
| Files every repository carries (LICENSE, community files, issue forms, caller workflows, Dependabot, release-note categories) | [`yutna/oss-template`](https://github.com/yutna/oss-template) | Copied once, when a repository is created |
| Settings, security, labels, milestones, rulesets | `bootstrap/oss-kit` + `bootstrap/*.json` | When the CLI runs |

There is deliberately **no `yutna/.github` repository**: GitHub applies the
community files of an owner's `.github` repository to *every* repository of
that owner, private ones included. Never create it.

## CLI

Requires `gh` (logged in as the owner), `git`, `jq` and `perl`. Runs under
macOS `/bin/bash` 3.2.

```sh
# New public repository from oss-template, with stack extras, settings,
# labels, milestones Backlog + v0.1.0 and rulesets:
bootstrap/oss-kit new my-lib --description "One line" --stack node --topics cli,node

# Bring an existing public repository in line (preview first):
bootstrap/oss-kit apply yutna/my-lib --dry-run
bootstrap/oss-kit apply yutna/my-lib

# Read-only drift report; exits 1 when anything differs:
bootstrap/oss-kit doctor yutna/my-lib
```

`apply` options: `--migrate-labels` (rename/merge/delete per
`bootstrap/label-migrations.json`), `--prune-labels` (delete labels that are
neither core nor a listed extension), `--skip-rulesets`, `--topics a,b`,
`--milestone vX.Y.Z` (ensure it exists).

Stacks: `node`, `java-maven`, `java-gradle`, `ruby`, `swift`, `python`, `go`,
`elixir`, `none`.

The CLI refuses private repositories, repositories not owned by `yutna` and
the name `.github` (any letter case). It never changes whether a repository
is a template. `--prune-labels` never deletes a label that
`--migrate-labels` would rename; it reports it instead. The `main` ruleset is
created only once the default branch has a `ci-ok` gate and a pr-check
caller, so adopting an existing repository is: `apply --skip-rulesets`, merge
the pull request that adds the oss-template files and callers, then `apply`.

## Reusable workflows

Callers (already in oss-template):

```yaml
# .github/workflows/pr-check.yml
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened, ready_for_review, converted_to_draft,
            assigned, unassigned, milestoned, demilestoned, labeled, unlabeled]
permissions: {}
jobs:
  pr-check:
    uses: yutna/oss-kit/.github/workflows/pr-check.yml@main
    permissions: { contents: read, pull-requests: write, issues: write }
```

- **pr-check** assigns the author (the owner for bots), inherits the linked
  issue's version milestone (bots get the lowest open one), sets the kind
  label from the title, then fails unless the title is Conventional Commits,
  there is an assignee and the milestone is `vX.Y.Z`. Required check:
  `pr-check / check`.
- **issue-check** assigns the owner to new issues without an assignee.
- **release** runs when a milestone closes: `vX.Y.Z` at 100 % becomes a GitHub
  Release with generated notes; open items reopen the milestone; other
  milestones and existing tags are skipped. Optional `preflight` input;
  outputs `released` and `version` for a `publish` job in the caller.

oss-kit calls its own workflows by local path (`./.github/workflows/…`) so a
change is exercised here before it reaches other repositories.

## Development

```sh
node --test test/*.test.mjs
shellcheck -s bash bootstrap/oss-kit
actionlint
```

The tests read the scripts straight out of the workflow files and run them
against fakes, so they test exactly what `@main` will run.

## License

[MIT](LICENSE)
