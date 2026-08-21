//! ビュー領域 (クライアント領域) の導出 (spec 追補 §ビュー領域の取得)。
//!
//! OS API を持たない純粋な矩形演算だけを置く。Windows は `GetClientRect` で
//! 直接ビュー領域が取れるので使わないが、macOS のようにタイトルバー高さを
//! 引く以外の手段が無い環境と、X11 の frame extents はここを通す。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use super::placement::Rect;

/// 外枠の各辺からビュー領域までの厚み。X11 の `_NET_FRAME_EXTENTS` と
/// macOS のタイトルバー高さの両方をこの 1 つの形で表す。
/// @implements SPEC-WINDOW-OVERLAY-EXTENSION
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FrameInsets {
    pub left: i32,
    pub right: i32,
    pub top: i32,
    pub bottom: i32,
}

impl FrameInsets {
    /// macOS のようにタイトルバーだけを差し引く場合。
    pub fn title_bar(height: i32) -> Self {
        Self { top: height, ..Self::default() }
    }
}

/// 外枠 `outer` から `insets` を差し引いたビュー領域。
/// 差し引くと潰れてしまう縮退ケースでは外枠をそのまま返す
/// (ビュー領域を失うより、外枠基準でずれている方が復旧できる)。
pub fn view_rect_from_frame(outer: Rect, insets: FrameInsets) -> Rect {
    let width = outer.width - insets.left - insets.right;
    let height = outer.height - insets.top - insets.bottom;
    if width <= 0 || height <= 0 {
        return outer;
    }
    Rect::new(outer.x + insets.left, outer.y + insets.top, width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insets_are_subtracted_from_every_side() {
        let outer = Rect::new(100, 200, 800, 600);
        let insets = FrameInsets { left: 4, right: 4, top: 30, bottom: 6 };
        assert_eq!(view_rect_from_frame(outer, insets), Rect::new(104, 230, 792, 564));
    }

    #[test]
    fn a_title_bar_only_frame_shifts_the_top_edge() {
        let outer = Rect::new(0, 0, 1280, 720);
        let rect = view_rect_from_frame(outer, FrameInsets::title_bar(28));
        assert_eq!(rect, Rect::new(0, 28, 1280, 692));
    }

    #[test]
    fn a_degenerate_frame_falls_back_to_the_outer_rect() {
        let outer = Rect::new(0, 0, 20, 20);
        let insets = FrameInsets { left: 20, right: 20, top: 20, bottom: 20 };
        assert_eq!(view_rect_from_frame(outer, insets), outer);
    }
}
