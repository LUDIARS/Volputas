# Window Overlay State Regressions

- Date: 2026-08-21
- Status: fixed in working tree
- Area: Tauri window tracking, profile hotkeys, marker delivery
- Severity: blocks reliable first use and ordered capture

## Summary

The new overlay could remain invisible on first launch and in Wayland manual
mode. A conflicting global shortcut could also remove the active shortcuts and
persist the unusable profile. Separately, a failed marker backlog flush could
deliver a newer marker first, and a reused native window ID could attach the
overlay to an unrelated process.

## Evidence

- `overlay-app/src-tauri/src/main.rs` hid the only window before a target could
  be selected; `ManualTracker` never emits a bound event that would show it.
- `commands::overlay_save_profile` saved before applying, while
  `hotkey::register` unregistered the old shortcuts before a potentially
  failing OS registration.
- `MarkerDispatcher.drop` ignored a failed `flush` result and posted the new
  marker directly.
- `TrackerSession.poll` trusted the record returned for `bound_id` without
  rechecking `WindowTarget::matches`.

## Regression Context

These are pre-merge regressions in the replacement of the former in-app
capture controls with a standalone native overlay. The WebView-only CI job did
not compile or test the native state transitions.

## Cause

Window visibility was coupled only to successful automatic binding. Native
shortcut replacement and profile persistence were not treated as one
transaction. Marker recovery and native-ID reuse each skipped an identity/order
invariant at their boundary.

## Fix Requirements

- Show an interactive configuration window for an empty target and for manual
  tracking, with an explicit drag action.
- Restore the previous shortcut set and applied profile on any transition or
  persistence failure.
- Keep a newly dropped marker behind every queued marker after a failed flush.
- Revalidate durable window identity whenever a bound native ID is resolved.
- Compile and test the Rust/Tauri side in CI.

## Verification

Regression tests cover FIFO recovery, native-ID reuse, and manual configuration
visibility. Windows CI runs native Rust tests and `cargo check`. Repository code
was not executed during Revisor autofix, so Windows shortcut conflict recovery,
Wayland manual placement, and actual overlay interaction still require runtime
exercise.

## Follow-up

Exercise first launch, target selection, click-through, window dragging, a
reserved global shortcut, target process restart/ID reuse, and marker recovery
against the live local app before release.
