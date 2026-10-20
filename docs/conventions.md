# Conventions

These rules apply to every public repository that uses oss-kit. Private
repositories are not affected.

## Branches and pull requests

- GitHub Flow: `main` is the only long-lived branch. Work happens on short
  branches named `<type>/<issue>-<slug>`, e.g. `feat/12-login`.
- Every change reaches `main` through a pull request, even for the solo
  maintainer. No approvals are required.
- Open the pull request **as a draft when work starts**; mark it *Ready for
  review* when done. GitHub does not merge drafts. CI and pr-check run on
  drafts too.
- **Squash merge only.** The squash commit title is the pull request title,
  the body is blank, and the head branch is deleted. Auto-merge and "update
  branch" are enabled.
- Direct pushes to `main` are rejected. The admin can bypass the rules only
  when merging a pull request (emergency merge), never by pushing.

## Pull request titles

The title becomes the commit on `main`, so it must follow Conventional
Commits:

```
^(feat|fix|docs|chore|refactor|test|ci|build|perf|style|revert)(\([a-z0-9._/-]+\))?(!)?: \S.*$
```

pr-check keeps exactly one kind label in step with the title type and never
touches other labels:

| Title type | Label |
|---|---|
| `feat`, `perf` | `enhancement` |
| `fix` | `bug` |
| `docs` | `documentation` |
| `chore`, `refactor`, `test`, `ci`, `build`, `style`, `revert` | `chore` |
| `!` present | also `breaking` (removed when `!` goes) |

## Milestones

- **`Backlog`**: permanent parking lot. Never closed, never released, not
  valid for a pull request.
- **`vX.Y.Z`**: a release. Small (3–7 issues). No pre-release names.
- An issue without a milestone is untriaged. Triage = choose `Backlog` or a
  version milestone, plus type and priority labels.
- A pull request must be in a version milestone before it can merge. It
  inherits the milestone of the issue it closes; Dependabot pull requests get
  the lowest open version milestone, and when none is open pr-check creates
  the next patch milestone (after the highest version milestone or latest
  release) for them. Rename it to release them as another version.
- Moving unfinished issues to a later milestone is normal.

## Releases

- **Closing a `vX.Y.Z` milestone at 100 % is the release.** The release
  workflow tags the default branch and creates a GitHub Release with notes
  generated from pull request labels (categories in `.github/release.yml`).
  GitHub Releases is the changelog; new repositories have no CHANGELOG.md.
- Closing it with open items reopens it and fails. To release early, move the
  unfinished items to the next milestone first, then close.
- Closing it again after the release, or closing `Backlog` or any non-version
  milestone, does nothing.
- SemVer; tags `vX.Y.Z`; new repositories start at `v0.1.0`.
- A repository can pass a `preflight` command that checks its version files
  (package.json, Info.plist, …) match the milestone; a failure reopens the
  milestone. Publishing (npm, app builds, assets) is a `publish` job in the
  caller's `release.yml` with `needs: release` and
  `if: needs.release.outputs.released == 'true'`, because a tag created by
  the workflow token does not trigger other workflows.
- If `publish` fails, fix the cause and use **Re-run failed jobs** on that
  run: it keeps the release job's outputs. "Re-run all jobs" finds the
  release already made and skips publishing.
- After a release you need not plan the next version right away: bot pull
  requests get a next-patch milestone made for them, and your own work gets
  a version milestone when you triage it.
- Release tags `v*` cannot be deleted or moved. To fix a bad tag, disable the
  `release-tags` ruleset temporarily.

## Assignees

Every issue and pull request has an assignee, so "Assigned to me" on
github.com/issues and github.com/pulls works as a dashboard across
repositories. Issue forms and Dependabot assign the owner; issue-check
assigns the owner to other new issues; pr-check assigns the author (the owner
for bots).

## Daily flow

1. Open an issue; triage it (milestone + labels).
2. `gh issue develop <N> --name <type>/<N>-<slug> --checkout`
3. `git commit --allow-empty -m "<type>: <summary>"` and
   `git push -u origin HEAD` (GitHub refuses a pull request with no commits;
   the empty commit disappears in the squash).
4. `gh pr create --draft --assignee @me --title "<type>: <summary>" --body "Closes #<N>"`
5. Work and push. CI and pr-check run on every push.
6. Mark *Ready for review* → checks green → squash merge. The branch is
   deleted and the issue closed.
7. When the milestone reaches 100 %, close it: the release is created.

## Labels

| Name | Color | Description |
|---|---|---|
| `bug` | `d73a4a` | Something isn't working |
| `enhancement` | `a2eeef` | New feature or improvement |
| `documentation` | `0075ca` | Documentation only |
| `chore` | `cfd3d7` | Maintenance, refactoring, CI, build, tests |
| `security` | `ee0701` | Security-related |
| `priority: high` | `d93f0b` | Do this first |
| `priority: low` | `c2e0c6` | Nice to have (no priority label = normal) |
| `blocked` | `fbca04` | Waiting on something else |
| `breaking` | `b60205` | Breaking change |
| `good first issue` | `7057ff` | Good for newcomers |
| `help wanted` | `008672` | Extra attention is welcome |
| `question` | `d876e3` | Question or support request |
| `dependencies` | `0366d6` | Dependency updates (Dependabot) |

No `duplicate`, `invalid` or `wontfix`: use the close reasons. No status
labels other than `blocked`. Repository-specific labels are listed as
extensions in `bootstrap/label-migrations.json`.

## CI contract

Every repository's CI workflow ends with a job named **`ci-ok`** that
`needs` every other job and fails if any of them failed or was cancelled.
The `main` ruleset requires `ci-ok` and `pr-check / check`, so the required
check names are the same for every stack. Never skip `ci-ok` on drafts.

## Repository settings

Issues on; wiki, projects and discussions off (documentation lives in
`docs/`); Pages off unless a repository needs it (source: GitHub Actions).
Dependabot alerts and security updates, secret scanning with push
protection, private vulnerability reporting and CodeQL default setup are on.
The default `GITHUB_TOKEN` is read-only. License: MIT.
