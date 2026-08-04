# Publishing to the public GitHub repo

HGV HUB has two separate git histories:

- **Local `main`** (this checkout) — the real, full development
  history. Never pushed anywhere. Stays private.
- **`https://github.com/Sako404/hgv-hub`'s `main`** — a public history
  that only ever grows via `scripts/publish-release.sh`. Each public
  commit is a release: the full current state of local `main` at the
  moment it was published, squashed into one commit on top of the
  previous release.

This split exists because local history predates a full anonymization
pass (see `decision-2026-08-04-working-time-github-publish`) and
because not every local commit is meant to be a public checkpoint.

## Publishing a new release

```bash
scripts/publish-release.sh 0.3.0
```

This:
1. Bumps `VERSION` and commits that on local `main` (normal commit,
   stays local).
2. Re-scans the whole tree for known-sensitive terms (the same check
   used for the original anonymization pass) and refuses to continue
   if it finds anything — this is the safety net that keeps a future
   accidental hardcoded real name/rate/employer from ever reaching the
   public repo.
3. Builds a new commit on top of the public repo's existing history
   containing local `main`'s current tree, tags it `vX.Y.Z`, and
   pushes it to `origin main`.
4. Creates a matching GitHub Release via `gh release create` — this is
   exactly what `server/src/services/updateService.js` polls for, so
   publishing a release here is also what makes self-hosted installs
   (including the TrueNAS one) see an "update available" banner.

Local `main` is never given an `origin` upstream tracking branch, on
purpose — a bare `git push` from it fails safely instead of ever
pushing the private full history.

## Version numbers

Plain semver in the `VERSION` file at repo root, no automated bumping
logic — just pick the next sensible number when you run the script.
