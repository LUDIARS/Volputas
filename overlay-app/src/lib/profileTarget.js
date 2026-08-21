// ウインドウ列挙・ピック結果を profile の永続 target へ変換する。
// UI と Tauri bridge の間の更新契約を純粋ロジックとして分離し、
// 「追従だけ変わって再起動後に戻る」状態を作らない。
import { validateOverlayProfile } from './profileSchema.js';

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function targetForWindow(windowInfo) {
  const processName = String(windowInfo?.processName || '').trim();
  if (!processName) {
    throw Object.assign(new Error('選択したウインドウの processName がありません'), {
      code: 'INVALID_WINDOW_TARGET',
    });
  }
  return { processName, titlePattern: null };
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export async function persistWindowTarget(profile, windowInfo, save) {
  if (typeof save !== 'function') {
    throw new TypeError('save は関数である必要があります');
  }
  const next = validateOverlayProfile({ ...profile, target: targetForWindow(windowInfo) });
  return validateOverlayProfile(await save(next));
}
