# Integration test plan

Critical paths are protected by deterministic Node tests for one-shot OAuth state/tickets, raw-profile minimization, transactional SID creation, delegated-profile authorization and field policy, independent preference/affect scoring, pseudonymous utterance/persona export, viewer-reaction aggregation, beat validation, and time-series DesignGap. The React login completion route must also pass a production Vite build.

`npm run export:personas` emits only affect-profile rows with a 20D vector-spec v1. The output field is named `user_id` for Discutere's identity anchor, but its value is the existing `ext:voluptas:<HMAC>` pseudonym, never the internal SID. Display names, emails, provider IDs, raw profiles, survey answers, and free text are excluded.

Database migrations and the real-video import path require a PostgreSQL integration environment. A release check imports at least one timestamped niconico or YouTube replay, records lexicon hit rate, registers a beat script, and calls the Gap API with a bearer token.
