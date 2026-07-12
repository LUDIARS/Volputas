# Voluptas × Discutere integration

Voluptas keeps three independent profile spaces: its calibrated-later 12-dimensional preference vector, Discutere's 15 questionnaire axes, and the canonical sentiment-core 20-dimensional affect vector. No cross-space mapping is persisted.

Viewer reaction timelines accept Discutere `ExternalUtterance` records carrying `videoOffsetMs`. They are derived data: comments are binned without filling missing intervals, and can be recomputed for a new algorithm version. Beat scripts are append-only versions and use controlled affect vocabulary keys plus manual `t_hint_ms` alignment. The primary output is per-beat cosine match plus the three largest target-minus-observed gaps.

Voluptas user data never enters Discutere with a raw SID. Export uses `ext:voluptas:<HMAC prefix>` and requires an explicitly configured secret.
