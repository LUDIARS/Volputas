# Private live eye and face tracking

ID: SPEC-PRIVATE-LIVE-TRACKING

Source: neco, 2026-10-25, Vo/Odeum. During streaming use the phone's front
camera or the PC camera for eye and face tracking. Camera images must not be
broadcast or used for any other purpose.

## Invariants

- Camera frames are transient, device-local inference input only. No preview,
  recording, upload, WebRTC track, image log, face recognition or other image use.
- A private owner acquires video with `facingMode: user`, audio disabled. It
  releases tracks and inference resources on session end, page exit, failures,
  and late permission/model completion after cancellation.
- Only eye movement, head-pose proxies and expression coefficients leave the
  owner. The current UI retains only the latest sample in memory.
- Missing model, denied permission and unsupported camera are visible failures;
  they must never be represented as active tracking.
- Optional microphone and screen recording are separate explicit operations.
  This supersedes the automatic face recording route described in
  `emotion-capture-companion.md`; historical recording import is not a camera
  acquisition path and existing files are not deleted.

## Vo implementation boundary

`usePrivateLiveTracking` starts for an active capture session on `/capture` on
smartphone or PC. `privateLiveTracking` owns the camera and local MediaPipe
model. `PrivateLiveTrackingPanel` displays tracking/lost-face/error state.
Eye movement is an uncalibrated iris signal, not a calibrated screen gaze point.
Face tracking uses pose proxies and MediaPipe expression coefficients, not
emotion or identity inference. No derived samples are uploaded in this slice.

Models/WASM must already be deployed by the existing `setup:gaze-model` path.
API reference: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js

## Remaining integration boundary

Odeum's native presenter is a separate C++ screen capture pipeline; it does not
currently start a Vo capture session or host this browser tracker. Its native
Windows/macOS and phone sender camera/inference lifecycle needs a separate
integration. Vo browser support must not be reported as Odeum support.
Likewise the existing paired-phone companion page is not the Vo `/capture` UI.

## Evidence and acceptance

Base: Voluptas `7570ab8`. Praeforma Voluptas project
`01M3FVMGJJD2KANRFT039HHXK6`, UX revision 1; Odeum absent from project list.
Anatomia context on `voluptas` returned the emotion-capture domain and current
spec references; cache persistence failed with EPERM. Source inspection is the
implementation evidence, not a runtime acceptance result.

Required review checks: front camera preference, PC camera, permission denial,
late permission after stop, model load failure, session replacement, page exit,
face loss, and no camera bytes in recordings/network/storage. iOS Safari,
Android browser and desktop camera behavior require real-device verification.
Unit cases are supplied in `privateLiveTracking.test.js`. Session policy forbids
running tests without explicit instruction; tests and real devices are unverified.
