# Integration test plan

Critical paths are protected by deterministic Node tests for one-shot OAuth state/tickets, raw-profile minimization, transactional SID creation, independent preference/affect scoring, pseudonymous export, viewer-reaction aggregation, beat validation, and time-series DesignGap. The React login completion route must also pass a production Vite build.

Database migrations and the real-video import path require a PostgreSQL integration environment. A release check imports at least one timestamped niconico or YouTube replay, records lexicon hit rate, registers a beat script, and calls the Gap API with a bearer token.
