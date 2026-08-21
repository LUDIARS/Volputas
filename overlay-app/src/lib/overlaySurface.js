// 情報サーフェスのラッパー (spec 追補 §呼び出し)。
//
//   const surface = await attachInfo({ at, offset, size, align, content });
//   await surface.update({ content });
//   await surface.close();
//
// 呼び出し側は「対象のビュー領域のこの点に、この大きさで、この内容を出す」
// だけを書く。矩形計算は Rust の overlay/surface.rs、追従は追従ループが持つ。
// サーフェスは見せるだけの面なので、クリック透過を解除する経路はここにも
// Rust 側にも無い (spec 追補 §不変条件 1)。
// overlayBridge は @tauri-apps/api を静的に取り込むので、ここでは遅延読み込み
// にする。矩形と content の正規化は純粋ロジックで、Tauri ランタイムどころか
// 依存の解決すら要らずに単体検証できる状態を保つ。
import { normalizeSurfaceContent } from './surfaceContent.js';
import { normalizeSurfaceSpec } from './surfaceSpec.js';

const bridge = () => import('./overlayBridge.js');

/** 差分更新の引数を「spec / content の変更分」に割る。 */
function splitUpdate(changes = {}) {
  const hasGeometry = ['at', 'offset', 'size', 'align'].some((key) => changes[key] !== undefined);
  return {
    spec: hasGeometry ? normalizeSurfaceSpec(changes) : undefined,
    content: changes.content === undefined ? undefined : normalizeSurfaceContent(changes.content),
  };
}

/**
 * Tauri command を差し替えられる形の実装。既定は overlayBridge を使う。
 * @implements SPEC-WINDOW-OVERLAY-EXTENSION
 */
export function createSurfaceApi({
  attach = (request) => bridge().then((api) => api.surfaceAttach(request)),
  update = (args) => bridge().then((api) => api.surfaceUpdate(args)),
  close = (args) => bridge().then((api) => api.surfaceClose(args)),
} = {}) {
  async function attachInfo(options = {}) {
    const spec = normalizeSurfaceSpec(options);
    const content = normalizeSurfaceContent(options.content);
    const descriptor = await attach({ ...spec, content });
    const id = descriptor?.id;
    if (!id) {
      throw Object.assign(new Error('情報サーフェスの生成に失敗しました'), {
        code: 'SURFACE_ATTACH_FAILED',
      });
    }
    let closed = false;
    const guard = () => {
      if (closed) {
        throw Object.assign(new Error(`情報サーフェス ${id} は閉じられています`), {
          code: 'SURFACE_CLOSED',
        });
      }
    };
    return {
      id,
      async update(changes) {
        guard();
        const { spec: nextSpec, content: nextContent } = splitUpdate(changes);
        await update({ id, spec: nextSpec, content: nextContent });
      },
      async close() {
        if (closed) return;
        closed = true;
        await close({ id });
      },
    };
  }
  return { attachInfo };
}

const defaultApi = createSurfaceApi();

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export const attachInfo = (options) => defaultApi.attachInfo(options);
