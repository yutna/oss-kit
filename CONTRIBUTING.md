# Contributing

Thanks for your interest. This project has a single maintainer, so the
process is small and the same for every change.

## How a change gets in

1. **Issue first.** Open or find an issue that describes the change. The
   maintainer triages it into a milestone.
2. **Branch** from `main` as `<type>/<issue>-<slug>`, for example
   `feat/12-login`.
3. **Open a draft pull request early.** CI runs on drafts too. Mark it
   *Ready for review* when the work is done.
4. **Title the pull request in [Conventional Commits](https://www.conventionalcommits.org/)
   form:** `<type>(<scope>)!: <summary>`, where type is one of `feat`, `fix`,
   `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `perf`, `style`,
   `revert`. The scope is optional and lower-case; `!` marks a breaking change.
   The title becomes the commit on `main`.
5. **Link the issue** with `Closes #N` in the description. The pull request
   takes the issue's milestone, and it can only be merged while it is in a
   version milestone (`vX.Y.Z`).
6. **CI must pass**: the `ci-ok` and `pr-check / check` checks.
7. **Squash merge only.** The branch is deleted after the merge.

A release is made when its version milestone is complete: closing the
milestone creates the GitHub Release with generated notes. The release notes
on GitHub are the changelog.

## Local development

Requirements: bash, gh, git, jq, perl; node (tests), shellcheck and actionlint (lint).

```sh
node --test test/*.test.mjs        # workflow logic and CLI tests (CLI runs under /bin/bash)
shellcheck -s bash bootstrap/oss-kit
actionlint
```

Changes to the reusable workflows reach every repository through `@main`
as soon as they merge, so keep `test/` in step with them.
