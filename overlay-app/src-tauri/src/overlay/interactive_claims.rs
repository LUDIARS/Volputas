//! 操作可能状態 (クリック透過の一時解除) の要求集合。
//!
//! 解除を要求する主体は複数あり、互いに独立に出入りする:
//!   - グラブハンドルの hover (`ProfileBar`)
//!   - コメント入力 (`commentHotkey` → `MarkerPanel`)
//!   - 対象へ束縛できていない間の設定表示 (Rust 側)
//!
//! これを単一の bool で持つと、後から解除した主体が他の主体の要求まで
//! 消してしまう。実際に踏むのは「ヘッダに乗ったままコメントを閉じる」経路で、
//! ポインタが動いていないので `onMouseLeave` による復帰も起きず、ヘッダが
//! クリック透過のまま操作できなくなる。要求元ごとに数え、空になったときだけ
//! 透過へ戻す。OS API に触らない純粋なロジックなので単体で検証する。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::collections::BTreeSet;

/// 追従できず設定を見せている間の操作可能要求 (Rust 側が握る)。
pub const CLAIM_UNBOUND: &str = "unbound";
/// グラブハンドルへの hover 中。
pub const CLAIM_HOVER: &str = "hover";
/// コメント入力中。
pub const CLAIM_COMMENT: &str = "comment";

/// WebView から要求できる主体。ここに無い名前は受け付けない — 任意の文字列を
/// 通すと、解除されないまま残る要求でオーバーレイを操作可能に固定できてしまう。
pub const WEBVIEW_CLAIMS: [&str; 2] = [CLAIM_HOVER, CLAIM_COMMENT];

pub fn is_webview_claim(claim: &str) -> bool {
    WEBVIEW_CLAIMS.contains(&claim)
}

#[derive(Debug, Default)]
pub struct InteractiveClaims {
    held: BTreeSet<String>,
}

impl InteractiveClaims {
    /// 要求の登録 / 取り下げ。戻り値は「まだ操作可能状態が必要か」。
    pub fn set(&mut self, claim: &str, interactive: bool) -> bool {
        if interactive {
            self.held.insert(claim.to_string());
        } else {
            self.held.remove(claim);
        }
        self.is_active()
    }

    pub fn is_active(&self) -> bool {
        !self.held.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_claim_means_click_through() {
        let claims = InteractiveClaims::default();
        assert!(!claims.is_active());
    }

    // 本命の回帰: ヘッダに乗ったままコメントを閉じても、hover の要求が
    // 残っているのでヘッダは操作可能なまま (spec §クリック透過)。
    #[test]
    fn releasing_one_claim_keeps_another_holder_interactive() {
        let mut claims = InteractiveClaims::default();
        assert!(claims.set(CLAIM_HOVER, true));
        assert!(claims.set(CLAIM_COMMENT, true));

        assert!(
            claims.set(CLAIM_COMMENT, false),
            "hover がまだ要求しているので透過へ戻さない"
        );
        assert!(claims.is_active());

        assert!(
            !claims.set(CLAIM_HOVER, false),
            "最後の要求が取り下げられたら透過へ戻る"
        );
    }

    #[test]
    fn repeated_claims_do_not_need_matching_releases() {
        // hover は mouseenter が続けて届くことがある。要求は集合なので
        // 1 回の解除で必ず取り下げられる (数え漏れで固定されない)。
        let mut claims = InteractiveClaims::default();
        claims.set(CLAIM_HOVER, true);
        claims.set(CLAIM_HOVER, true);
        assert!(!claims.set(CLAIM_HOVER, false));
    }

    #[test]
    fn releasing_an_unheld_claim_is_harmless() {
        let mut claims = InteractiveClaims::default();
        assert!(claims.set(CLAIM_HOVER, true));
        // コメントを開かずに閉じる経路 (unmount 時など) を踏んでも
        // hover の要求は残る。
        assert!(claims.set(CLAIM_COMMENT, false));
    }

    #[test]
    fn the_unbound_claim_is_not_reachable_from_the_webview() {
        // 未束縛中の要求は Rust が握る。WebView から取り下げられると、
        // 設定を出したまま操作できなくなる。
        assert!(is_webview_claim(CLAIM_HOVER));
        assert!(is_webview_claim(CLAIM_COMMENT));
        assert!(!is_webview_claim(CLAIM_UNBOUND));
        assert!(!is_webview_claim("surface"));
    }
}
