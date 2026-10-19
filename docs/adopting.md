# Adopting an existing repository

New repositories get the workflow from `oss-kit new`. An existing public
repository is adopted by hand, one at a time, in the order below. Commands
assume you are in `~/Projects/oss-kit` and replace `<repo>` with the
repository name.

## 0. Decide how far to go

Full adoption changes how the repository merges and releases:

- A pull request can merge only with a Conventional Commits title and an
  open `vX.Y.Z` milestone (pr-check is a required check).
- Closing a `vX.Y.Z` milestone at 100 % creates the tag and the GitHub
  Release; the release notes come from pull request labels.
- Labels are renamed, merged and deleted per
  `bootstrap/label-migrations.json`.

Before starting, look for anything that depends on the old way:

- A release process written down elsewhere (CLAUDE.md, CONTRIBUTING.md,
  scripts) or run by an agent.
- Tooling that reads label names or pull request titles.
- A workflow triggered by pushing a tag. A tag created by the release
  workflow uses `GITHUB_TOKEN` and does not trigger other workflows, so that
  work has to move into a `publish` job of the release caller.

If any of these exist, adapt them first, or adopt partially: step 4 without
`--migrate-labels` and `--prune-labels`, and without the callers in step 5,
gives settings and security only.

## 1. Snapshot, for rolling back

```sh
B=~/Projects/oss-kit-migration-backup/<repo>; mkdir -p "$B"
gh api repos/yutna/<repo> > "$B/settings.json"
gh label list -R yutna/<repo> --limit 500 --json name,color,description > "$B/labels.json"
gh api "repos/yutna/<repo>/milestones?state=all&per_page=100" > "$B/milestones.json"
gh api repos/yutna/<repo>/rulesets > "$B/rulesets.json"
gh api repos/yutna/<repo>/branches/main/protection > "$B/protection.json" 2>&1
```

## 2. Open pull requests

Merge or close the pull requests that the new rules would block (no version
milestone, or a title that is not Conventional Commits).

## 3. Milestones

- Name the next version milestone after the version you plan to ship next
  (`apply --milestone vX.Y.Z` in step 4 creates it, together with `Backlog`).
- Rename old milestones to `vX.Y.Z`:
  `gh api -X PATCH repos/yutna/<repo>/milestones/<number> -f title=vX.Y.Z`.
- Close the ones that are already released. Closing them after the release
  caller is installed is also safe: the release workflow skips tags that
  exist.

## 4. Settings, security and labels (no rulesets yet)

If the repository has labels of its own to keep, add them to `extensions` in
`bootstrap/label-migrations.json` first (through an oss-kit pull request).

```sh
bash bootstrap/oss-kit apply yutna/<repo> --dry-run \
  --migrate-labels --prune-labels --skip-rulesets --milestone vX.Y.Z
bash bootstrap/oss-kit apply yutna/<repo> \
  --migrate-labels --prune-labels --skip-rulesets --milestone vX.Y.Z
```

Renamed and merged labels keep their items. Deleted labels disappear from
closed issues and pull requests too. Without `--migrate-labels`,
`--prune-labels` leaves the labels a migration would rename and reports
them as pending.

## 5. The adoption pull request

Open an issue in the version milestone, then a draft pull request
`chore: adopt oss-kit workflow` on `chore/<N>-adopt-oss-kit`. Copy from
`yutna/oss-template`, filling `{{YEAR}}`, `{{OWNER}}`, `{{REPO}}`,
`{{DESCRIPTION}}` and `{{FULLNAME}}` by hand:

- `LICENSE`: holder `Yutthana Siphuengchai`, keep the year.
- `CODE_OF_CONDUCT.md`, `SUPPORT.md`; align `CONTRIBUTING.md` and
  `SECURITY.md`, keeping the repository's own development notes.
- `.github/ISSUE_TEMPLATE/`: the bug, feature and question forms and
  `config.yml`. Keep repository-specific forms, with `assignees: [yutna]` and
  labels from the core set.
- `.github/pull_request_template.md` and `.github/release.yml`.
- `.github/dependabot.yml`: on every ecosystem `labels: [dependencies]`,
  `assignees: [yutna]` and `commit-message` with `prefix: chore` and
  `include: scope`.
- `.github/workflows/`: the `pr-check.yml`, `issue-check.yml` and
  `release.yml` callers. Remove the old pull request hygiene workflow. End the
  pull-request CI with a job named exactly `ci-ok` that `needs` every other
  job (copy the gate from oss-template's `ci.yml`).
- `release.yml`: a `preflight` that checks the version files, for example
  `test "$(jq -r .version package.json)" = "$VERSION"`, and any publishing as
  a `publish` job with `needs: release`,
  `if: needs.release.outputs.released == 'true'`, checking out
  `needs.release.outputs.version`.
- `.editorconfig` and `.gitattributes` if missing.
- `CHANGELOG.md`: keep maintaining it, or add a note at the top that later
  release notes are on GitHub Releases.

This pull request is checked by the old workflows: `pull_request_target`
runs the version on the base branch.

## 6. After it merges

```sh
# only if the repository had classic branch protection
gh api -X DELETE repos/yutna/<repo>/branches/main/protection
bash bootstrap/oss-kit apply yutna/<repo>
```

`apply` now creates the rulesets. It refuses to create `main` while the
default branch has no `ci-ok` gate or pr-check caller, because the required
checks would never report.

## 7. Check

- Smoke test: a throwaway issue in the version milestone, then a draft pull
  request with a small change. Check the assignee, the inherited milestone,
  the kind label, `ci-ok` and `pr-check / check`. Close the pull request
  without merging, delete the branch, close the issue as not planned.
- `bash bootstrap/oss-kit doctor yutna/<repo>` reports no drift.

## Rolling back

- Rulesets: `gh api -X DELETE repos/yutna/<repo>/rulesets/<id>`.
- Settings: `gh api -X PATCH repos/yutna/<repo>` with the values from
  `settings.json`.
- Labels: recreate from `labels.json` with `gh label create --force`.
- Files: revert the adoption pull request.

## Notes on the existing repositories (2026-10-19)

- **functional-design-skills**: CLAUDE.md defines its own release (a bump
  pull request with a CHANGELOG entry, then an annotated tag at the merge
  commit and a GitHub release titled with the tag's subject), and
  CONTRIBUTING.md relies on the labels `feature`, `release` and `hotfix`. An
  agent is working toward 4.0.0. `package.json` carries the version.
- **gherkin-specification-skills**: classic branch protection requires
  `verify` and `labels`; Dependabot pull requests #12 and #13 are open;
  `package.json` carries the version.
- **ollama-bar**: `release.yml` runs on tag push (`ci`, `verify-version` of
  Info.plist and CHANGELOG, `release`). Move publishing into a `publish` job
  on a macOS runner that checks out the tag and uploads with
  `gh release upload`, and check Info.plist in `preflight` (with python3
  `plistlib`; the release job runs on Ubuntu). Milestone `v1.1` becomes
  `v1.1.0` and is closed; the latest release is v1.1.1.
