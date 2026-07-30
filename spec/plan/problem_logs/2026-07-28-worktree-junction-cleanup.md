# Worktree cleanup followed a cross-checkout junction

- Date: 2026-07-28
- Status: fixed in local checkout
- Area: local development / git worktree cleanup
- Severity: high (tracked submodule files were temporarily deleted)

## Summary

During cleanup of the T10 worktree
`E:\Document\Ars\.wt-Voluptas-persona-v2-t10`, `git worktree remove --force`
followed a dependency junction created for test setup. The junction connected
the worktree's `player-profile-server/lib/lapilli/packages` path to the main
Voluptas checkout. As a result, 77 tracked Lapilli package files in the main
checkout were temporarily deleted.

No commit or push contained the deletions. The files were restored from the
Lapilli submodule `HEAD`, and both the submodule and Voluptas main checkout
were verified clean before feature work resumed.

## Evidence

At 2026-07-28T18:39+09:00:

- `git worktree remove --force E:\Document\Ars\.wt-Voluptas-persona-v2-t10`
  reported `Directory not empty`.
- `git status --short` in
  `player-profile-server/lib/lapilli` listed 77 deleted tracked files under
  `packages/`.
- `git diff --stat` reported 5,875 deleted lines.
- The parent Voluptas checkout reported
  `m player-profile-server/lib/lapilli`.

## Regression Context

The worktree had no source changes after commit `c13222c`, and the main
Voluptas checkout was clean before T10 test setup. The unsafe condition was
introduced by using an NTFS junction to reuse the main checkout's initialized
Lapilli package directory.

## Cause

The cleanup command was run before all reparse points inside the worktree had
been enumerated and removed. Git's recursive worktree deletion traversed the
cross-checkout directory junction before failing on other remaining content.

## Fix Requirements

- Never place a junction inside a disposable worktree when its target is
  another checkout.
- Before recursively removing a worktree, enumerate every reparse point below
  the target and inspect its resolved target.
- Remove confirmed junctions non-recursively before `git worktree remove`.
- Prefer a real submodule checkout and worktree-local dependency installation.
- Verify both the removed worktree and every former junction target after
  cleanup.

## Verification

The immediate recovery used:

```text
git restore --source=HEAD --worktree -- packages
```

Verification results:

- Lapilli submodule: clean detached `HEAD`
- Voluptas main: clean and aligned with `origin/main`
- `packages/sentiment-core/package.json`: present
- T10 worktree directory: absent

## Follow-up

Use the safe cleanup sequence above for T11 and later persona-v2 worktrees.
Do not reuse the junction-based dependency setup from T10.
