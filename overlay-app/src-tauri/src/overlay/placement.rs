//! オーバーレイ矩形の計算 (spec/feature/window-overlay-extension.md §配置モード)。
//!
//! ここは純粋な整数演算だけで完結させる: OS 実装やウインドウハンドルに触れない
//! ので、9 アンカー × 4 ドック辺 × マルチモニタをテストで固定できる。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use serde::{Deserialize, Serialize};

/// 物理ピクセルの矩形。追従対象・モニタ・オーバーレイの全部に使う。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self { x, y, width, height }
    }

    pub fn right(&self) -> i32 {
        self.x + self.width
    }

    pub fn bottom(&self) -> i32 {
        self.y + self.height
    }

    pub fn center_x(&self) -> i32 {
        self.x + self.width / 2
    }

    pub fn center_y(&self) -> i32 {
        self.y + self.height / 2
    }

    /// 重なり面積。対象ウインドウが載っているモニタを選ぶのに使う。
    pub fn overlap_area(&self, other: &Rect) -> i64 {
        let width = (self.right().min(other.right()) - self.x.max(other.x)).max(0) as i64;
        let height = (self.bottom().min(other.bottom()) - self.y.max(other.y)).max(0) as i64;
        width * height
    }
}

/// overlay モードの 9 アンカー。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Anchor {
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    MiddleCenter,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

/// dock モードの 4 辺。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DockSide {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum PlacementMode {
    Overlay { anchor: Anchor },
    Dock { side: DockSide },
    Detached { x: i32, y: i32 },
}

fn default_width() -> i32 {
    420
}

fn default_height() -> i32 {
    320
}

fn default_margin() -> i32 {
    12
}

fn default_opacity() -> f64 {
    0.92
}

/// プロファイルの `placement` (overlay-app/src/lib/profileSchema.js と同じ形)。
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct Placement {
    #[serde(flatten)]
    pub mode: PlacementMode,
    #[serde(default = "default_width")]
    pub width: i32,
    #[serde(default = "default_height")]
    pub height: i32,
    #[serde(default = "default_margin")]
    pub margin: i32,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            mode: PlacementMode::Dock { side: DockSide::Right },
            width: default_width(),
            height: default_height(),
            margin: default_margin(),
            opacity: default_opacity(),
        }
    }
}

/// 対象ウインドウが最も大きく載っているモニタ。どれにも載っていなければ
/// 先頭のモニタに寄せる (マルチモニタ環境で座標が飛ばないようにするため)。
pub fn monitor_for(target: &Rect, monitors: &[Rect]) -> Option<Rect> {
    monitors
        .iter()
        .max_by_key(|monitor| monitor.overlap_area(target))
        .copied()
        .filter(|monitor| monitor.overlap_area(target) > 0)
        .or_else(|| monitors.first().copied())
}

fn clamp_into(rect: Rect, bounds: &Rect) -> Rect {
    let x = rect
        .x
        .min(bounds.right() - rect.width)
        .max(bounds.x);
    let y = rect
        .y
        .min(bounds.bottom() - rect.height)
        .max(bounds.y);
    Rect::new(x, y, rect.width, rect.height)
}

fn overlay_rect(placement: &Placement, target: &Rect, anchor: Anchor) -> Rect {
    let margin = placement.margin;
    let width = placement.width.min(target.width);
    let height = placement.height.min(target.height);
    let left = target.x + margin;
    let center_x = target.center_x() - width / 2;
    let right = target.right() - width - margin;
    let top = target.y + margin;
    let middle_y = target.center_y() - height / 2;
    let bottom = target.bottom() - height - margin;
    let (x, y) = match anchor {
        Anchor::TopLeft => (left, top),
        Anchor::TopCenter => (center_x, top),
        Anchor::TopRight => (right, top),
        Anchor::MiddleLeft => (left, middle_y),
        Anchor::MiddleCenter => (center_x, middle_y),
        Anchor::MiddleRight => (right, middle_y),
        Anchor::BottomLeft => (left, bottom),
        Anchor::BottomCenter => (center_x, bottom),
        Anchor::BottomRight => (right, bottom),
    };
    Rect::new(x, y, width, height)
}

fn dock_rect(placement: &Placement, target: &Rect, side: DockSide, monitor: Option<&Rect>) -> Rect {
    let margin = placement.margin;
    // 横に吸着するときは対象と同じ高さ、縦に吸着するときは同じ幅にする。
    let rect = match side {
        DockSide::Left => Rect::new(
            target.x - placement.width - margin,
            target.y,
            placement.width,
            target.height,
        ),
        DockSide::Right => Rect::new(
            target.right() + margin,
            target.y,
            placement.width,
            target.height,
        ),
        DockSide::Top => Rect::new(
            target.x,
            target.y - placement.height - margin,
            target.width,
            placement.height,
        ),
        DockSide::Bottom => Rect::new(
            target.x,
            target.bottom() + margin,
            target.width,
            placement.height,
        ),
    };
    // 画面外に出る辺は反対側へ折り返す。対象を覆わないという dock の約束を
    // 守れないときだけ、最後に clamp で画面内へ戻す。
    let Some(bounds) = monitor else {
        return rect;
    };
    let fits = match side {
        DockSide::Left => rect.x >= bounds.x,
        DockSide::Right => rect.right() <= bounds.right(),
        DockSide::Top => rect.y >= bounds.y,
        DockSide::Bottom => rect.bottom() <= bounds.bottom(),
    };
    if fits {
        return clamp_into(rect, bounds);
    }
    let flipped = match side {
        DockSide::Left => DockSide::Right,
        DockSide::Right => DockSide::Left,
        DockSide::Top => DockSide::Bottom,
        DockSide::Bottom => DockSide::Top,
    };
    let alternative = dock_rect(placement, target, flipped, None);
    let alternative_fits = match flipped {
        DockSide::Left => alternative.x >= bounds.x,
        DockSide::Right => alternative.right() <= bounds.right(),
        DockSide::Top => alternative.y >= bounds.y,
        DockSide::Bottom => alternative.bottom() <= bounds.bottom(),
    };
    clamp_into(if alternative_fits { alternative } else { rect }, bounds)
}

/// 対象ウインドウ矩形とモニタ一覧からオーバーレイの矩形を決める。
pub fn compute(placement: &Placement, target: &Rect, monitors: &[Rect]) -> Rect {
    let monitor = monitor_for(target, monitors);
    match placement.mode {
        PlacementMode::Detached { x, y } => {
            let rect = Rect::new(x, y, placement.width, placement.height);
            monitor.map_or(rect, |bounds| clamp_into(rect, &bounds))
        }
        PlacementMode::Overlay { anchor } => {
            let rect = overlay_rect(placement, target, anchor);
            monitor.map_or(rect, |bounds| clamp_into(rect, &bounds))
        }
        PlacementMode::Dock { side } => dock_rect(placement, target, side, monitor.as_ref()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Rect = Rect { x: 0, y: 0, width: 1920, height: 1080 };
    const SECOND_MONITOR: Rect = Rect { x: 1920, y: 0, width: 1920, height: 1080 };

    fn overlay(anchor: Anchor) -> Placement {
        Placement {
            mode: PlacementMode::Overlay { anchor },
            width: 400,
            height: 200,
            margin: 10,
            opacity: 0.9,
        }
    }

    fn target() -> Rect {
        Rect::new(200, 100, 1000, 600)
    }

    #[test]
    fn overlay_anchors_cover_the_nine_positions() {
        let target = target();
        let monitors = [MONITOR];
        let placed = |anchor| compute(&overlay(anchor), &target, &monitors);
        assert_eq!(placed(Anchor::TopLeft), Rect::new(210, 110, 400, 200));
        assert_eq!(placed(Anchor::TopCenter), Rect::new(500, 110, 400, 200));
        assert_eq!(placed(Anchor::TopRight), Rect::new(790, 110, 400, 200));
        assert_eq!(placed(Anchor::MiddleLeft), Rect::new(210, 300, 400, 200));
        assert_eq!(placed(Anchor::MiddleCenter), Rect::new(500, 300, 400, 200));
        assert_eq!(placed(Anchor::MiddleRight), Rect::new(790, 300, 400, 200));
        assert_eq!(placed(Anchor::BottomLeft), Rect::new(210, 490, 400, 200));
        assert_eq!(placed(Anchor::BottomCenter), Rect::new(500, 490, 400, 200));
        assert_eq!(placed(Anchor::BottomRight), Rect::new(790, 490, 400, 200));
    }

    #[test]
    fn an_overlay_larger_than_the_target_is_shrunk_to_fit_inside() {
        let small_target = Rect::new(0, 0, 300, 150);
        let rect = compute(&overlay(Anchor::MiddleCenter), &small_target, &[MONITOR]);
        assert_eq!(rect.width, 300);
        assert_eq!(rect.height, 150);
    }

    #[test]
    fn dock_sides_sit_outside_the_target_without_covering_it() {
        // 4 辺すべてに余白がある対象を使い、折り返しではない素の計算を見る。
        let target = Rect::new(600, 300, 700, 400);
        let monitors = [MONITOR];
        let dock = |side| {
            compute(
                &Placement {
                    mode: PlacementMode::Dock { side },
                    width: 400,
                    height: 200,
                    margin: 10,
                    opacity: 0.9,
                },
                &target,
                &monitors,
            )
        };
        assert_eq!(dock(DockSide::Right), Rect::new(1310, 300, 400, 400));
        assert_eq!(dock(DockSide::Left), Rect::new(190, 300, 400, 400));
        assert_eq!(dock(DockSide::Top), Rect::new(600, 90, 700, 200));
        assert_eq!(dock(DockSide::Bottom), Rect::new(600, 710, 700, 200));
        assert_eq!(dock(DockSide::Right).overlap_area(&target), 0);
        assert_eq!(dock(DockSide::Bottom).overlap_area(&target), 0);
    }

    #[test]
    fn a_dock_that_would_leave_the_monitor_flips_to_the_other_side() {
        let target = Rect::new(1500, 100, 400, 600);
        let placement = Placement {
            mode: PlacementMode::Dock { side: DockSide::Right },
            width: 400,
            height: 200,
            margin: 10,
            opacity: 0.9,
        };
        let rect = compute(&placement, &target, &[MONITOR]);
        assert_eq!(rect.right(), target.x - 10);
        assert_eq!(rect.overlap_area(&target), 0);
    }

    #[test]
    fn placement_follows_the_target_onto_a_second_monitor() {
        let target = Rect::new(2000, 200, 800, 600);
        let monitors = [MONITOR, SECOND_MONITOR];
        assert_eq!(monitor_for(&target, &monitors), Some(SECOND_MONITOR));
        let rect = compute(&overlay(Anchor::TopRight), &target, &monitors);
        assert!(rect.x >= SECOND_MONITOR.x);
        assert!(rect.right() <= SECOND_MONITOR.right());
    }

    #[test]
    fn a_detached_overlay_ignores_the_target_but_stays_on_screen() {
        let placement = Placement {
            mode: PlacementMode::Detached { x: 1800, y: 1000 },
            width: 400,
            height: 200,
            margin: 10,
            opacity: 0.9,
        };
        let rect = compute(&placement, &target(), &[MONITOR]);
        assert_eq!(rect, Rect::new(1520, 880, 400, 200));
    }

    #[test]
    fn a_target_on_no_known_monitor_falls_back_to_the_first_one() {
        let target = Rect::new(-4000, -4000, 200, 200);
        assert_eq!(monitor_for(&target, &[MONITOR, SECOND_MONITOR]), Some(MONITOR));
        assert_eq!(monitor_for(&target, &[]), None);
    }

    #[test]
    fn placement_round_trips_through_the_profile_json_shape() {
        let json = r#"{"mode":"dock","side":"right","width":420,"height":320,"margin":12,"opacity":0.92}"#;
        let placement: Placement = serde_json::from_str(json).expect("placement parses");
        assert_eq!(placement.mode, PlacementMode::Dock { side: DockSide::Right });
        let overlay_json = r#"{"mode":"overlay","anchor":"bottom-right"}"#;
        let parsed: Placement = serde_json::from_str(overlay_json).expect("overlay parses");
        assert_eq!(parsed.mode, PlacementMode::Overlay { anchor: Anchor::BottomRight });
        assert_eq!(parsed.width, default_width());
    }
}
