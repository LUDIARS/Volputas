# Empty Lapilli submodule blocks test setup

- Date: 2026-08-21
- Status: fixed in working tree
- Area: dependency setup
- Severity: test suite blocked

## Summary

Regression: an empty `lib/lapilli` submodule directory caused setup to abort, preventing the local sentiment-core dependency from being built and installed.

## Evidence

`npm run setup:submodules` failed with: `Lapilli exists but is incomplete ... refusing to delete it automatically.` Subsequent tests failed with `Cannot find module '@ludiars/sentiment-core'`.

## Regression Context

The setup command should initialize the declared Lapilli submodule when its checkout directory is empty.

## Cause

The incomplete-directory guard treated an empty directory the same as one containing possible local work.

## Fix Requirements

Allow an empty Lapilli directory to reach `git submodule update`; continue refusing to remove nonempty incomplete directories.

## Verification

Revisor must rerun `setup-submodules` and the registered test suite. No tests were run locally per task constraints.

## Follow-up

None.
