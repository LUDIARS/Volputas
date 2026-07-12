# Cernere integration blocker

WS-A3 is intentionally not wired in this revision. The implementation plan references `CernereServiceAdapter` user-admission messages on `/ws/service`, while the current Cernere canonical setup states that `/ws/service` does not exist and service sessions use project credentials plus `/ws/project`. The adapter package still exposes the older admission types, so selecting either contract in Voluptas would invent an authentication path outside the approved design.

Human/platform preparation required before A3:

1. Decide whether Cernere will restore/replace push admission on the project-session protocol, or publish a current adapter that verifies user-for-project PASETO tokens for Express.
2. Register the `voluptas` managed project and issue its project credential according to Cernere `spec/setup/service-registration.md`.
3. Specify the current admission/revoke payload and token audience.
4. Then add the `cernere` IdentitySource and integration tests for admission → Voluptas JWT → `/api/v1/users/me`, plus the disabled-source isolation test.

Until those decisions are made, `AUTH_SOURCES` accepts the implemented `google` and `discord` OIDC sources only. Voluptas API middleware continues to trust only Voluptas-issued RS256 tokens.
