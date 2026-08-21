//! Windows 実装 (spec §追従ループ)。
//!
//! 位置は `GetWindowRect` / `GetWindowTextW` / `IsIconic`、変化検知は
//! `SetWinEventHook` (LOCATIONCHANGE / FOREGROUND / DESTROY)。
//! 対象ウインドウの内容には一切触れない — 重ね描画のためだけの読み取り。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
#![cfg(target_os = "windows")]

use std::sync::mpsc::Sender;
use std::sync::Mutex;

use windows::Win32::Foundation::{BOOL, HWND, LPARAM, MAX_PATH, POINT, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{ClientToScreen, EnumDisplayMonitors, HDC, HMONITOR};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClientRect, GetForegroundWindow, GetMessageW, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, EVENT_OBJECT_LOCATIONCHANGE,
    EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use super::placement::Rect;
use super::tracker::{TrackerError, WindowTracker};
use super::window_target::WindowInfo;

/// WinEvent の hook proc はユーザデータを取れないので、通知先はここに置く。
static NOTIFIER: Mutex<Option<Sender<()>>> = Mutex::new(None);

#[derive(Default)]
pub struct WindowsTracker;

impl WindowsTracker {
    pub fn new() -> Self {
        Self
    }
}

fn rect_of(handle: HWND) -> Option<Rect> {
    let mut rect = RECT::default();
    // SAFETY: handle は列挙で得た生存中のトップレベルウインドウ。
    unsafe { GetWindowRect(handle, &mut rect) }.ok()?;
    Some(Rect::new(
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
    ))
}

/// クライアント領域をスクリーン座標で返す (spec 追補 §ビュー領域の取得)。
/// `GetClientRect` は左上原点の相対矩形なので `ClientToScreen` で持ち上げる。
/// 取れないときは外枠へ縮退する (ずれても表示が消えるよりましなため)。
/// @implements SPEC-WINDOW-OVERLAY-EXTENSION
fn view_rect_of(handle: HWND, outer: Rect) -> Rect {
    let mut client = RECT::default();
    // SAFETY: handle は列挙で得た生存中のトップレベルウインドウ。
    if unsafe { GetClientRect(handle, &mut client) }.is_err() {
        return outer;
    }
    let mut origin = POINT { x: client.left, y: client.top };
    // SAFETY: origin はスタック上の POINT。失敗時は変換されないので外枠を使う。
    if !unsafe { ClientToScreen(handle, &mut origin) }.as_bool() {
        return outer;
    }
    Rect::new(
        origin.x,
        origin.y,
        client.right - client.left,
        client.bottom - client.top,
    )
}

fn title_of(handle: HWND) -> String {
    let mut buffer = [0u16; 512];
    // SAFETY: buffer は呼び出し中だけ渡す固定長配列。
    let length = unsafe { GetWindowTextW(handle, &mut buffer) };
    if length <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buffer[..length as usize])
}

fn process_name_of(handle: HWND) -> String {
    let mut process_id = 0u32;
    // SAFETY: 出力先はスタック上の u32。
    unsafe { GetWindowThreadProcessId(handle, Some(&mut process_id)) };
    if process_id == 0 {
        return String::new();
    }
    // SAFETY: 取得したハンドルは下で必ず閉じる。
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) })
    else {
        return String::new();
    };
    let mut buffer = [0u16; MAX_PATH as usize];
    let mut length = buffer.len() as u32;
    let name = unsafe {
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = windows::Win32::Foundation::CloseHandle(process);
        if result.is_err() {
            String::new()
        } else {
            String::from_utf16_lossy(&buffer[..length as usize])
        }
    };
    name.rsplit(['/', '\\']).next().unwrap_or(&name).to_string()
}

unsafe extern "system" fn enum_window_proc(handle: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowInfo>);
    if !IsWindowVisible(handle).as_bool() {
        return TRUE;
    }
    let title = title_of(handle);
    if title.is_empty() {
        return TRUE;
    }
    if let Some(rect) = rect_of(handle) {
        windows.push(WindowInfo {
            id: handle.0 as u64,
            title,
            process_name: process_name_of(handle),
            rect,
            view_rect: view_rect_of(handle, rect),
            is_minimized: IsIconic(handle).as_bool(),
        });
    }
    TRUE
}

unsafe extern "system" fn monitor_proc(
    _monitor: HMONITOR,
    _hdc: HDC,
    rect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let monitors = &mut *(lparam.0 as *mut Vec<Rect>);
    let bounds = *rect;
    monitors.push(Rect::new(
        bounds.left,
        bounds.top,
        bounds.right - bounds.left,
        bounds.bottom - bounds.top,
    ));
    TRUE
}

unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _handle: HWND,
    _object_id: i32,
    _child_id: i32,
    _thread_id: u32,
    _timestamp: u32,
) {
    if let Ok(guard) = NOTIFIER.lock() {
        if let Some(sender) = guard.as_ref() {
            // 取りこぼしても 100ms のバックアップポーリングが拾う。
            let _ = sender.send(());
        }
    }
}

impl WindowTracker for WindowsTracker {
    fn list_windows(&self) -> Result<Vec<WindowInfo>, TrackerError> {
        let mut windows: Vec<WindowInfo> = Vec::new();
        // SAFETY: コールバックは同期的に呼ばれ、lparam は上のベクタを指す。
        unsafe {
            EnumWindows(
                Some(enum_window_proc),
                LPARAM(&mut windows as *mut Vec<WindowInfo> as isize),
            )
        }
        .map_err(|error| TrackerError::Failed(error.to_string()))?;
        Ok(windows)
    }

    fn window(&self, id: u64) -> Result<Option<WindowInfo>, TrackerError> {
        let handle = HWND(id as *mut std::ffi::c_void);
        // SAFETY: 無効なハンドルなら IsWindowVisible が false を返すだけ。
        if !unsafe { IsWindowVisible(handle) }.as_bool() {
            return Ok(None);
        }
        let Some(rect) = rect_of(handle) else {
            return Ok(None);
        };
        Ok(Some(WindowInfo {
            id,
            title: title_of(handle),
            process_name: process_name_of(handle),
            rect,
            view_rect: view_rect_of(handle, rect),
            is_minimized: unsafe { IsIconic(handle) }.as_bool(),
        }))
    }

    fn monitors(&self) -> Result<Vec<Rect>, TrackerError> {
        let mut monitors: Vec<Rect> = Vec::new();
        // SAFETY: コールバックは同期的に呼ばれる。
        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(monitor_proc),
                LPARAM(&mut monitors as *mut Vec<Rect> as isize),
            );
        }
        Ok(monitors)
    }

    fn foreground_window(&self) -> Result<Option<u64>, TrackerError> {
        // SAFETY: 引数を取らない読み取り専用の API。
        let handle = unsafe { GetForegroundWindow() };
        if handle.0.is_null() {
            return Ok(None);
        }
        Ok(Some(handle.0 as u64))
    }

    fn name(&self) -> &'static str {
        "windows"
    }
}

/// WinEvent hook 用のスレッドを立てる。イベントが来るたびに `notifier` を叩き、
/// 追従ループは 100ms のバックアップポーリングと合わせて反応する。
pub fn spawn_change_notifier(notifier: Sender<()>) {
    std::thread::spawn(move || {
        if let Ok(mut guard) = NOTIFIER.lock() {
            *guard = Some(notifier);
        }
        // SAFETY: OUTOFCONTEXT のフックはこのスレッドのメッセージループで配送される。
        let hook = unsafe {
            // FOREGROUND(0x0003)..LOCATIONCHANGE(0x800B) の範囲に
            // OBJECT_DESTROY(0x8001) も含まれるので、hook は 1 本で足りる。
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(win_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };
        let mut message = MSG::default();
        // SAFETY: 標準的なメッセージループ。GetMessageW が 0/-1 を返したら抜ける。
        while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {}
        unsafe {
            let _ = UnhookWinEvent(hook);
        }
    });
}
