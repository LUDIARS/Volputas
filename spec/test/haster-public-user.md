# HASTER public test user

HASTER is a local, disposable integration-test environment. It is not a staging or release environment and must never be promoted to one.

Public fixture facts:

- User ID: `00000000-0000-4000-8000-000000000657`
- Discord subject: `1000000000000000657`
- Cernere subject: `00000000-0000-4000-8000-000000000657`
- Public bearer fixture: `haster-public-test-token-v1`
- Persona report public fixture: `haster-public-persona-export-token-v1`
- Pseudonym public fixture: `haster-public-pseudo-id-secret-v1`
- Research-export consent: enabled
- Discussion-import consent: enabled

The ID and token are intentionally public and provide no security. The token is accepted only by the dedicated `volputas-haster` service. Startup fails when HASTER uses `NODE_ENV=production`, a non-loopback frontend or issuer, or a database without the `_haster` suffix.

HASTER derives its database name from `VOLPUTAS_DATABASE_URL` by appending `_haster`, so its fixture user and evidence never enter the normal Volputas database.

## Contract clauses

### SPEC-HASTER-ISOLATION

HASTER is enabled only by the exact `VOLPUTAS_ENVIRONMENT=HASTER` marker. Its database name is derived with an `_haster` suffix. Startup must fail under `NODE_ENV=production`, for a non-loopback frontend or issuer, or when the effective database lacks that suffix. HASTER binds its HTTP listener to loopback. The Excubitor service is local-only, non-autostart, and runs from the main project folder.

### SPEC-HASTER-PUBLIC-IDENTITY

The documented user, Discord subject, Cernere subject, and bearer value are public test fixtures, not credentials. The bearer value authenticates only while HASTER is enabled. Startup idempotently restores the fixture user, both verified identities, and both integration-test consents in the isolated HASTER database. Keeping the Cernere identity linked allows the Discord identity to be removed during the unlink-consent E2E without deleting the test account's last identity.
