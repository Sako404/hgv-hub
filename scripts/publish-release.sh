#!/usr/bin/env bash
# Publishes the current state of local `main` to the public GitHub repo
# as a new release. Local `main` keeps its own full history untouched
# (private, never pushed) — this script builds a SEPARATE, parallel
# history on top of the existing public commits, one release commit at
# a time. See docs/PUBLIC_RELEASE_PROCESS.md and
# decision-2026-08-04-working-time-github-publish in the Brain for why.
#
# Usage: scripts/publish-release.sh <new-version>   e.g. 0.2.0
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <new-version>  (e.g. 0.2.0)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -n "$(git status --short)" ]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Must be run from local main (currently on $CURRENT_BRANCH)." >&2
  exit 1
fi

echo "==> Bumping VERSION to $VERSION"
printf '%s\n' "$VERSION" > VERSION
git add VERSION
git commit -m "Bump version to $VERSION"

echo "==> Scanning for known sensitive terms before publishing"
SENSITIVE_PATTERN='marcin|sakowski|example|clientco|depota|depotb|doncaster'
# publish-release.sh itself necessarily contains SENSITIVE_PATTERN as literal
# data (the detection pattern), not a leak — and import-example-shifts.mjs is
# already deliberately excluded from the public tree below, so its
# intentional real-data content isn't a leak either, just a false positive
# against this scan.
SCAN_RESULT="$(grep -rEli "$SENSITIVE_PATTERN" --include="*.js" --include="*.jsx" --include="*.mjs" --include="*.cjs" \
    --include="*.md" --include="*.json" --include="*.sh" \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . \
    | grep -vE '^\./scripts/(publish-release\.sh|import-example-shifts\.mjs)$' || true)"
if [ -n "$SCAN_RESULT" ]; then
  echo "$SCAN_RESULT"
  echo "!! Found the above file(s) containing a known-sensitive term. Aborting before touching the public repo." >&2
  echo "!! Fix these first, then re-run this script." >&2
  exit 1
fi
echo "   clean."

echo "==> Fetching origin/main"
git fetch origin main

TMP_BRANCH="release-tmp-$$"
git checkout -B "$TMP_BRANCH" origin/main

echo "==> Replacing tree with current main's content"
git rm -rf --ignore-unmatch . > /dev/null
git checkout main -- .

# Personal one-off tooling — not generic/reusable by other self-hosters,
# and inherently tied to Marcin's own real employer/data by design (unlike
# e.g. import-full-account.mjs, which is generic and stays public). Kept in
# local main only; never reaches the public repo.
PRIVATE_ONLY_PATHS=(
  "scripts/import-example-shifts.mjs"
)
for p in "${PRIVATE_ONLY_PATHS[@]}"; do
  rm -f "$p"
done

git add -A

if git diff --cached --quiet; then
  echo "No changes since the last published release — nothing to publish." >&2
  git checkout main
  git branch -D "$TMP_BRANCH"
  exit 1
fi

git commit -m "Release v$VERSION"
git tag "v$VERSION"

echo "==> Pushing to origin/main"
git push origin "$TMP_BRANCH:main"
git push origin "v$VERSION"

echo "==> Creating GitHub release"
gh release create "v$VERSION" --title "v$VERSION" --generate-notes

echo "==> Cleaning up"
git checkout main
git branch -D "$TMP_BRANCH"

echo "==> Done. Published v$VERSION to https://github.com/Sako404/hgv-hub"
