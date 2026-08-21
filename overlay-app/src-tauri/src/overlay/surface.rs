//! 情報サーフェスの矩形計算 (spec 追補 §配置計算)。
//!
//! ここは純粋な整数演算だけで完結させる: OS API・ウインドウハンドルには
//! 一切触れない。`view` がモニタを覆っているか (= フルスクリーン相当か) は
//! 計算に現れない — 不変条件 4 のとおり、モニタへのクランプ 1 本で扱う。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use serde::{Deserialize, Serialize};

use super::placement::Rect;

/// ビュー領域内の相対座標 (0..1)。0.5/0.2 なら「横中央・上から 2 割」。
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct ViewPoint {
    #[serde(rename = "viewX")]
    pub view_x: f64,
    #[serde(rename = "viewY")]
    pub view_y: f64,
}

impl Default for ViewPoint {
    fn default() -> Self {
        Self { view_x: 0.5, view_y: 0.5 }
    }
}

/// アンカー点からのピクセルずらし。対象ウインドウの枠外に出てよい。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
pub struct Offset {
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
}

/// サーフェスの大きさ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub struct SurfaceSize {
    pub width: i32,
    pub height: i32,
}

impl Default for SurfaceSize {
    fn default() -> Self {
        Self { width: 360, height: 200 }
    }
}

/// アンカー点にサーフェスのどこを合わせるか (9 通り)。
/// @implements SPEC-WINDOW-OVERLAY-EXTENSION
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceAlign {
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    #[default]
    MiddleCenter,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

/// `attachInfo({ at, offset, size, align })` の Rust 側の受け皿。
/// @implements SPEC-WINDOW-OVERLAY-EXTENSION
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize, Serialize)]
pub struct SurfaceSpec {
    #[serde(default)]
    pub at: ViewPoint,
    #[serde(default)]
    pub offset: Offset,
    #[serde(default)]
    pub size: SurfaceSize,
    #[serde(default)]
    pub align: SurfaceAlign,
}

/// (1) ビュー領域内の相対座標からアンカー点を求める。
fn anchor_point(view: &Rect, at: &ViewPoint) -> (i32, i32) {
    let x = view.x as f64 + view.width as f64 * at.view_x;
    let y = view.y as f64 + view.height as f64 * at.view_y;
    (x.round() as i32, y.round() as i32)
}

/// (3) align に従ってサーフェス矩形の左上を決める。
fn origin_for(align: SurfaceAlign, x: i32, y: i32, width: i32, height: i32) -> (i32, i32) {
    let left = x;
    let center_x = x - width / 2;
    let right = x - width;
    let top = y;
    let middle_y = y - height / 2;
    let bottom = y - height;
    match align {
        SurfaceAlign::TopLeft => (left, top),
        SurfaceAlign::TopCenter => (center_x, top),
        SurfaceAlign::TopRight => (right, top),
        SurfaceAlign::MiddleLeft => (left, middle_y),
        SurfaceAlign::MiddleCenter => (center_x, middle_y),
        SurfaceAlign::MiddleRight => (right, middle_y),
        SurfaceAlign::BottomLeft => (left, bottom),
        SurfaceAlign::BottomCenter => (center_x, bottom),
        SurfaceAlign::BottomRight => (right, bottom),
    }
}

/// (4) モニタへ収める。モニタより大きいサーフェスはモニタに合わせて縮める。
fn clamp_to_monitor(rect: Rect, monitor: &Rect) -> Rect {
    let width = rect.width.min(monitor.width).max(1);
    let height = rect.height.min(monitor.height).max(1);
    let x = rect.x.min(monitor.right() - width).max(monitor.x);
    let y = rect.y.min(monitor.bottom() - height).max(monitor.y);
    Rect::new(x, y, width, height)
}

/// 対象のビュー領域とモニタからサーフェスの矩形を決める。
///
/// 対象ウインドウの矩形にはクリップしない (不変条件 3)。はみ出しは対象に
/// 対してだけ許し、モニタに対しては許さない (不変条件 4)。
/// @implements SPEC-WINDOW-OVERLAY-EXTENSION
pub fn resolve_surface_rect(view: Rect, monitor: Rect, spec: &SurfaceSpec) -> Rect {
    let (anchor_x, anchor_y) = anchor_point(&view, &spec.at);
    // (2) offset を足す。ここで対象の枠外へ出るのは想定どおり。
    let x = anchor_x + spec.offset.x;
    let y = anchor_y + spec.offset.y;
    let width = spec.size.width.max(1);
    let height = spec.size.height.max(1);
    let (left, top) = origin_for(spec.align, x, y, width, height);
    clamp_to_monitor(Rect::new(left, top, width, height), &monitor)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Rect = Rect { x: 0, y: 0, width: 1920, height: 1080 };
    // ウインドウモードの対象: 外枠より一回り小さいクライアント領域。
    const VIEW: Rect = Rect { x: 200, y: 130, width: 1000, height: 600 };

    const ALL_ALIGNS: [SurfaceAlign; 9] = [
        SurfaceAlign::TopLeft,
        SurfaceAlign::TopCenter,
        SurfaceAlign::TopRight,
        SurfaceAlign::MiddleLeft,
        SurfaceAlign::MiddleCenter,
        SurfaceAlign::MiddleRight,
        SurfaceAlign::BottomLeft,
        SurfaceAlign::BottomCenter,
        SurfaceAlign::BottomRight,
    ];

    fn at(view_x: f64, view_y: f64) -> ViewPoint {
        ViewPoint { view_x, view_y }
    }

    fn spec(at: ViewPoint, offset: Offset, align: SurfaceAlign) -> SurfaceSpec {
        SurfaceSpec { at, offset, size: SurfaceSize { width: 360, height: 200 }, align }
    }

    #[test]
    fn the_anchor_point_comes_from_the_view_rect_not_the_outer_rect() {
        // 4 隅と中心。外枠 (ビュー領域より上・左に広い) を使っていたらずれる。
        let corners = [
            (at(0.0, 0.0), (200, 130)),
            (at(1.0, 0.0), (1200, 130)),
            (at(0.0, 1.0), (200, 730)),
            (at(1.0, 1.0), (1200, 730)),
            (at(0.5, 0.5), (700, 430)),
        ];
        for (point, expected) in corners {
            let rect = resolve_surface_rect(
                VIEW,
                MONITOR,
                &spec(point, Offset::default(), SurfaceAlign::TopLeft),
            );
            assert_eq!((rect.x, rect.y), expected, "anchor {point:?}");
        }
    }

    #[test]
    fn each_of_the_nine_aligns_places_the_surface_around_the_anchor() {
        // アンカーはビュー中央 (700, 430)、サーフェスは 360x200。
        let placed = |align| {
            resolve_surface_rect(VIEW, MONITOR, &spec(at(0.5, 0.5), Offset::default(), align))
        };
        assert_eq!(placed(SurfaceAlign::TopLeft), Rect::new(700, 430, 360, 200));
        assert_eq!(placed(SurfaceAlign::TopCenter), Rect::new(520, 430, 360, 200));
        assert_eq!(placed(SurfaceAlign::TopRight), Rect::new(340, 430, 360, 200));
        assert_eq!(placed(SurfaceAlign::MiddleLeft), Rect::new(700, 330, 360, 200));
        assert_eq!(placed(SurfaceAlign::MiddleCenter), Rect::new(520, 330, 360, 200));
        assert_eq!(placed(SurfaceAlign::MiddleRight), Rect::new(340, 330, 360, 200));
        assert_eq!(placed(SurfaceAlign::BottomLeft), Rect::new(700, 230, 360, 200));
        assert_eq!(placed(SurfaceAlign::BottomCenter), Rect::new(520, 230, 360, 200));
        assert_eq!(placed(SurfaceAlign::BottomRight), Rect::new(340, 230, 360, 200));
    }

    #[test]
    fn every_view_corner_and_align_combination_stays_on_the_monitor() {
        for point in [at(0.0, 0.0), at(1.0, 0.0), at(0.0, 1.0), at(1.0, 1.0), at(0.5, 0.5)] {
            for align in ALL_ALIGNS {
                let rect =
                    resolve_surface_rect(VIEW, MONITOR, &spec(point, Offset { x: 0, y: -160 }, align));
                assert!(
                    rect.x >= MONITOR.x && rect.right() <= MONITOR.right(),
                    "{point:?} {align:?}"
                );
                assert!(
                    rect.y >= MONITOR.y && rect.bottom() <= MONITOR.bottom(),
                    "{point:?} {align:?}"
                );
            }
        }
    }

    #[test]
    fn a_surface_is_not_clipped_to_the_target_window() {
        // ビュー上端から 160px 上、つまり対象の枠外へ出す指示。
        // モニタ上端には余裕がある対象を使い、クランプではなく
        // 「対象へクリップしない」ことだけを見る。
        let view = Rect::new(200, 400, 1000, 600);
        let rect = resolve_surface_rect(
            view,
            MONITOR,
            &spec(at(0.5, 0.0), Offset { x: 0, y: -160 }, SurfaceAlign::BottomCenter),
        );
        assert!(rect.bottom() <= view.y, "対象のビュー領域より上に出ていること");
        assert_eq!(rect.overlap_area(&view), 0);
        // 対象矩形へのクリップはしないので、大きさは指定どおりのまま。
        assert_eq!(rect.width, 360);
        assert_eq!(rect.height, 200);
    }

    #[test]
    fn a_surface_pushed_off_the_monitor_is_pulled_back_in() {
        // ビュー領域がモニタ全面 = フルスクリーン相当。同じ 1 本のクランプで
        // 画面内へ戻る (フルスクリーンを特別扱いする分岐は無い)。
        let fullscreen_view = MONITOR;
        let above_the_view = spec(at(0.5, 0.0), Offset { x: 0, y: -160 }, SurfaceAlign::BottomCenter);
        let rect = resolve_surface_rect(fullscreen_view, MONITOR, &above_the_view);
        assert_eq!(rect, Rect::new(780, 0, 360, 200));
        // ビュー領域がモニタと同じなら、ウインドウモードでも結果は同じになる。
        let windowed_view = Rect::new(0, 0, 1920, 1080);
        assert_eq!(resolve_surface_rect(windowed_view, MONITOR, &above_the_view), rect);

        // 右下へのはみ出しも同じクランプで戻る。
        let past_bottom_right =
            spec(at(1.0, 1.0), Offset { x: 400, y: 400 }, SurfaceAlign::TopLeft);
        let corner = resolve_surface_rect(fullscreen_view, MONITOR, &past_bottom_right);
        assert_eq!(corner.right(), MONITOR.right());
        assert_eq!(corner.bottom(), MONITOR.bottom());
    }

    #[test]
    fn a_surface_larger_than_the_monitor_shrinks_to_fit() {
        let huge = SurfaceSpec {
            at: at(0.5, 0.5),
            offset: Offset::default(),
            size: SurfaceSize { width: 4000, height: 3000 },
            align: SurfaceAlign::MiddleCenter,
        };
        assert_eq!(resolve_surface_rect(VIEW, MONITOR, &huge), MONITOR);
    }

    #[test]
    fn a_surface_follows_the_view_onto_a_second_monitor() {
        let second = Rect::new(1920, 0, 1920, 1080);
        let view = Rect::new(2000, 100, 800, 600);
        let rect = resolve_surface_rect(
            view,
            second,
            &spec(at(0.5, 0.5), Offset::default(), SurfaceAlign::MiddleCenter),
        );
        assert!(rect.x >= second.x && rect.right() <= second.right());
    }

    #[test]
    fn the_spec_round_trips_through_the_attach_info_json_shape() {
        let json = "{\"at\":{\"viewX\":0.5,\"viewY\":0.2},\"offset\":{\"x\":0,\"y\":-160},\
                    \"size\":{\"width\":360,\"height\":200},\"align\":\"bottom-center\"}";
        let parsed: SurfaceSpec = serde_json::from_str(json).expect("surface spec parses");
        assert_eq!(parsed.align, SurfaceAlign::BottomCenter);
        assert_eq!(parsed.offset, Offset { x: 0, y: -160 });
        assert_eq!(parsed.size, SurfaceSize { width: 360, height: 200 });

        // 省略時は中央・ずらし無し・既定サイズ。
        let sparse: SurfaceSpec = serde_json::from_str("{}").expect("defaults parse");
        assert_eq!(sparse, SurfaceSpec::default());
    }
}
