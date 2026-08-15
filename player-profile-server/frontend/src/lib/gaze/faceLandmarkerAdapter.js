// Thin wrapper around MediaPipe Tasks Vision's FaceLandmarker so the rest of
// the gaze pipeline never touches the library directly. The WASM runtime and
// the model file are served from the app itself (frontend/public/mediapipe,
// populated by `npm run setup:gaze-model`); nothing is fetched from the
// network at analysis time (spec/feature/emotion-capture-companion.md §視線推定).
export const MEDIAPIPE_BASE_URL = '/mediapipe';
export const FACE_LANDMARKER_MODEL_URL = `${MEDIAPIPE_BASE_URL}/face_landmarker.task`;
export const MEDIAPIPE_WASM_URL = `${MEDIAPIPE_BASE_URL}/wasm`;

export class GazeModelUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GazeModelUnavailableError';
    this.code = 'GAZE_MODEL_UNAVAILABLE';
  }
}

// Fails fast with an actionable message instead of letting the WASM loader
// surface an opaque 404 (RULE_CODE §7.1: no silent stubs).
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export async function assertGazeModelAvailable(fetchImpl = fetch) {
  const response = await fetchImpl(FACE_LANDMARKER_MODEL_URL, { method: 'HEAD' });
  if (!response.ok) {
    throw new GazeModelUnavailableError(
      '視線推定モデルが配置されていません。サーバ側で `npm run setup:gaze-model` を実行してから再読み込みしてください。'
    );
  }
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export async function loadFaceLandmarker({ importVision = () => import('@mediapipe/tasks-vision') } = {}) {
  await assertGazeModelAvailable();
  const { FaceLandmarker, FilesetResolver } = await importVision();
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  return {
    // Returns the 478 landmarks of the first face or null.
    detect(videoElement, timestampMs) {
      const result = landmarker.detectForVideo(videoElement, timestampMs);
      return result?.faceLandmarks?.[0] ?? null;
    },
    close() {
      landmarker.close();
    },
  };
}
