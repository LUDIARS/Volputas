# Integration test plan

Critical paths are protected by deterministic Node tests for one-shot OAuth state/tickets, raw-profile minimization, transactional SID creation, delegated-profile authorization and field policy, independent preference/affect scoring, pseudonymous utterance/persona export, viewer-reaction aggregation, beat validation, and time-series DesignGap. The React login completion route must also pass a production Vite build.

`npm run export:personas` writes `exports/personas.jsonl` in the configured local data repository. Consent defaults off, producing zero lines. With explicit consent, every v2 line has an `ext:voluptas:<HMAC>` `pseudoId`, confidence-low-or-better preference axes, sanitized aversions and mechanic reactions, and `exportSpecVersion: 2`. Display names, emails, Name, provider IDs, provenance record IDs, survey answers, and free text are excluded.

Online export is `GET /api/personas/export`, protected by the dedicated
`VOLPUTAS_PERSONA_EXPORT_TOKEN` project credential and paged with
`X-Next-Cursor`. It selects only non-deleted users whose
`research_export_consent` is true.

Database migrations and the real-video import path require a PostgreSQL integration environment. A release check imports at least one timestamped niconico or YouTube replay, records lexicon hit rate, registers a beat script, and calls the Gap API with a bearer token.
