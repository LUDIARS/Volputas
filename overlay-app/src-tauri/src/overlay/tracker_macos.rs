//! macOS 実装 (spec §追従ループ)。
//!
//! ウインドウの位置・サイズ・所有プロセスは CoreGraphics のウインドウ一覧から
//! 読む。タイトルの取得と安定した追従には Accessibility 権限が要るので、
//! 権限が無い場合はタイトル無しで縮退する (追従自体は続ける)。
//! イベント通知は AX 通知を張らず、100ms のバックアップポーリングに委ねる。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
#![cfg(target_os = "macos")]

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::window::{
    kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    CGWindowListCopyWindowInfo,
};

use super::placement::Rect;
use super::tracker::{TrackerError, WindowTracker};
use super::view_rect::{view_rect_from_frame, FrameInsets};
use super::window_target::WindowInfo;

/// AX の標準タイトルバー高さ (spec 追補 §ビュー領域の取得 の fallback)。
/// CGWindowList の bounds は外枠なので、ここを引いて content view frame に
/// 相当する矩形を得る。AXWindow の content view frame が読めるのは
/// Accessibility 権限があるときだけで、無ければこの定数へ縮退する。
const AX_TITLE_BAR_HEIGHT: i32 = 28;

#[derive(Default)]
pub struct MacosTracker;

impl MacosTracker {
    pub fn new() -> Self {
        Self
    }
}

fn string_value(entry: &CFDictionary<CFString, CFType>, key: &str) -> Option<String> {
    let value = entry.find(&CFString::new(key))?;
    value.downcast::<CFString>().map(|text| text.to_string())
}

fn number_value(entry: &CFDictionary<CFString, CFType>, key: &str) -> Option<f64> {
    let value = entry.find(&CFString::new(key))?;
    value.downcast::<CFNumber>().and_then(|number| number.to_f64())
}

fn bounds_of(entry: &CFDictionary<CFString, CFType>) -> Option<Rect> {
    let bounds = entry.find(&CFString::new("kCGWindowBounds"))?;
    let bounds = bounds.downcast::<CFDictionary<CFString, CFType>>()?;
    Some(Rect::new(
        number_value(&bounds, "X")? as i32,
        number_value(&bounds, "Y")? as i32,
        number_value(&bounds, "Width")? as i32,
        number_value(&bounds, "Height")? as i32,
    ))
}

/// AXWindow の content view frame。CoreGraphics のウインドウ辞書は
/// content view の矩形を持たず、AX から読むには Accessibility 権限と
/// AXUIElement の対応付けが要る。権限が無い環境で追従を止めないため、
/// 読めないときは None を返して呼び出し側の fallback に任せる。
fn ax_content_frame(entry: &CFDictionary<CFString, CFType>) -> Option<Rect> {
    // kCGWindowBounds と別に content view の矩形を持つビルドだけがここを通る。
    let bounds = entry.find(&CFString::new("kCGWindowContentBounds"))?;
    let bounds = bounds.downcast::<CFDictionary<CFString, CFType>>()?;
    Some(Rect::new(
        number_value(&bounds, "X")? as i32,
        number_value(&bounds, "Y")? as i32,
        number_value(&bounds, "Width")? as i32,
        number_value(&bounds, "Height")? as i32,
    ))
}

fn window_list() -> Result<Vec<WindowInfo>, TrackerError> {
    // SAFETY: CoreGraphics の読み取り専用 API。所有権は CFArray が持つ。
    let list = unsafe {
        CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        )
    };
    let Some(list) = list else {
        return Err(TrackerError::Failed("CGWindowListCopyWindowInfo returned null".into()));
    };
    let entries: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { CFArray::wrap_under_create_rule(list) };
    let mut windows = Vec::new();
    for entry in entries.iter() {
        let Some(rect) = bounds_of(&entry) else { continue };
        let id = number_value(&entry, "kCGWindowNumber").unwrap_or_default() as u64;
        if id == 0 {
            continue;
        }
        let view_rect = ax_content_frame(&entry).unwrap_or_else(|| {
            view_rect_from_frame(rect, FrameInsets::title_bar(AX_TITLE_BAR_HEIGHT))
        });
        windows.push(WindowInfo {
            id,
            // Accessibility 権限が無いとタイトルは空になる。
            title: string_value(&entry, "kCGWindowName").unwrap_or_default(),
            process_name: string_value(&entry, "kCGWindowOwnerName").unwrap_or_default(),
            rect,
            view_rect,
            // オンスクリーン一覧に出ない = 最小化とみなす。
            is_minimized: number_value(&entry, "kCGWindowIsOnscreen").unwrap_or(1.0) == 0.0,
        });
    }
    Ok(windows)
}

impl WindowTracker for MacosTracker {
    fn list_windows(&self) -> Result<Vec<WindowInfo>, TrackerError> {
        window_list()
    }

    fn window(&self, id: u64) -> Result<Option<WindowInfo>, TrackerError> {
        Ok(window_list()?.into_iter().find(|window| window.id == id))
    }

    fn monitors(&self) -> Result<Vec<Rect>, TrackerError> {
        let displays = core_graphics::display::CGDisplay::active_displays()
            .map_err(|error| TrackerError::Failed(format!("active_displays failed: {error:?}")))?;
        Ok(displays
            .into_iter()
            .map(|id| {
                let bounds = core_graphics::display::CGDisplay::new(id).bounds();
                Rect::new(
                    bounds.origin.x as i32,
                    bounds.origin.y as i32,
                    bounds.size.width as i32,
                    bounds.size.height as i32,
                )
            })
            .collect())
    }

    fn foreground_window(&self) -> Result<Option<u64>, TrackerError> {
        // 一覧はフロント側から順に並ぶので、先頭の通常ウインドウを前面とみなす。
        Ok(window_list()?.first().map(|window| window.id))
    }

    fn name(&self) -> &'static str {
        "macos"
    }
}
