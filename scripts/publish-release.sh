#!/usr/bin/env bash
# Publishes the current state of local `main` to the public GitHub repo as a
# new release. Local `main` keeps its own full history untouched (private,
# never pushed) — this script builds a SEPARATE, parallel history on top of
# the existing public commits, one release commit at a time.
#
# That split is a privacy boundary, not a convenience: this script is the only
# thing that decides what crosses from private development state into the
# canonical public upstream. Treat changes to it accordingly.
#
# See docs/PUBLIC_RELEASE_PROCESS.md.
#
# Usage: scripts/publish-release.sh <new-version>   e.g. 0.4.0
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <new-version>  (e.g. 0.4.0)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EXPECTED_REMOTE="https://github.com/Sako404/hgv-hub.git"

# ── Preconditions ─────────────────────────────────────────────────────────
if [ -n "$(git status --short)" ]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Must be run from local main (currently on $CURRENT_BRANCH)." >&2
  exit 1
fi

ACTUAL_REMOTE="$(git remote get-url origin 2>/dev/null || echo '')"
if [ "$ACTUAL_REMOTE" != "$EXPECTED_REMOTE" ]; then
  echo "origin is '$ACTUAL_REMOTE', expected '$EXPECTED_REMOTE'." >&2
  echo "Refusing to publish to an unexpected remote." >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists locally. Choose another version." >&2
  exit 1
fi

# ── Gate 1: the code actually works ───────────────────────────────────────
echo "==> Running tests"
npm test
echo "==> Running build"
npm run build

# ── Gate 2: privacy scan ──────────────────────────────────────────────────
# Structural patterns live here (safe to publish). Real-world terms live in a
# private-only file that never reaches the public tree.
echo "==> Privacy scan"
# Deliberately NOT a generic '/home/...' rule: documentation legitimately uses
# placeholder home paths (/home/youruser, /home/truenas_admin). The real
# username lives in the private terms file instead.
STRUCTURAL='GoogleDrive|192\.168\.[0-9]|10\.[0-9]+\.[0-9]+\.[0-9]+|@outlook\.com|@gmail\.com'
SCAN_FILES="$(git ls-files | grep -vE '^scripts/(publish-release\.sh|release-privacy-terms\.txt)$' || true)"

HITS="$(printf '%s\n' "$SCAN_FILES" | xargs -r grep -lEi "$STRUCTURAL" 2>/dev/null || true)"

TERMS_FILE="scripts/release-privacy-terms.txt"
if [ -f "$TERMS_FILE" ]; then
  while IFS= read -r term; do
    [ -z "$term" ] && continue
    case "$term" in \#*) continue ;; esac
    MORE="$(printf '%s\n' "$SCAN_FILES" | xargs -r grep -lFi -- "$term" 2>/dev/null || true)"
    [ -n "$MORE" ] && HITS="$HITS
$MORE"
  done < "$TERMS_FILE"
else
  echo "!! $TERMS_FILE is missing — the real-world term scan did NOT run." >&2
  echo "!! Restore it before publishing." >&2
  exit 1
fi

HITS="$(printf '%s\n' "$HITS" | sed '/^$/d' | sort -u)"
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo "!! The above file(s) match a privacy pattern. Aborting before touching the public repo." >&2
  exit 1
fi
echo "   clean."

# ── Build the flattened public release commit ─────────────────────────────
echo "==> Bumping VERSION to $VERSION"
printf '%s\n' "$VERSION" > VERSION
git add VERSION
git commit -m "Bump version to $VERSION"

echo "==> Fetching origin/main"
git fetch origin main
REMOTE_BEFORE="$(git rev-parse FETCH_HEAD)"

TMP_BRANCH="release-tmp-$$"
git checkout -q -B "$TMP_BRANCH" origin/main

echo "==> Replacing tree with current main's content"
git rm -rf --ignore-unmatch . > /dev/null
git checkout main -- .

# Private-only: personal one-off tooling and the privacy term list. Never
# reaches the public repo.
PRIVATE_ONLY_PATHS=(
  "scripts/import-example-shifts.mjs"
  "scripts/release-privacy-terms.txt"
)
for p in "${PRIVATE_ONLY_PATHS[@]}"; do
  rm -f "$p"
done

git add -A

if git diff --cached --quiet; then
  echo "No changes since the last published release — nothing to publish." >&2
  git checkout -q main
  git branch -D "$TMP_BRANCH" >/dev/null
  exit 1
fi

# ── Gate 3: show exactly what is about to become public ───────────────────
echo "==> Files entering the public snapshot:"
git diff --cached --stat | tail -40
echo
echo "==> Total files in the public tree: $(git diff --cached --name-only | wc -l) changed"
echo "==> Publishing v$VERSION to $EXPECTED_REMOTE"

git commit -q -m "Release v$VERSION"
git tag "v$VERSION"

# ── Gate 4: refuse if the public upstream moved since we fetched ──────────
# Same class of protection as --force-with-lease: unexpected divergence is a
# reason to investigate, never to overwrite.
echo "==> Verifying the public upstream has not moved"
REMOTE_NOW="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [ "$REMOTE_NOW" != "$REMOTE_BEFORE" ]; then
  echo "!! origin/main moved from $REMOTE_BEFORE to $REMOTE_NOW during this run." >&2
  echo "!! Refusing to publish. Investigate before retrying." >&2
  git checkout -q main
  git branch -D "$TMP_BRANCH" >/dev/null
  git tag -d "v$VERSION" >/dev/null
  exit 1
fi

git push --force-with-lease="refs/heads/main:$REMOTE_BEFORE" origin "$TMP_BRANCH:main"
git push origin "v$VERSION"

echo "==> Creating GitHub release"
gh release create "v$VERSION" --title "v$VERSION" --generate-notes

echo "==> Cleaning up"
git checkout -q main
git branch -D "$TMP_BRANCH" >/dev/null

echo "==> Done. Published v$VERSION to https://github.com/Sako404/hgv-hub"
