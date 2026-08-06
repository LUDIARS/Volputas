# HASTER Persona Export Config Mismatch

- Date: 2026-08-06
- Status: fixed in working tree
- Area: HASTER persona bridge configuration
- Severity: blocks T14 persona export

## Summary

After Volputas #262 was merged and `volputas-haster` was restarted through
Excubitor, persona export still returned `PERSONA_EXPORT_UNAVAILABLE`. The
catalog contained both public HASTER fixture values, but the pseudo-ID secret was
read from an obsolete environment-variable spelling.

## Evidence

At 2026-08-06 15:35 JST, `GET /api/personas/export` returned HTTP 503 while the
Excubitor catalog snapshot contained `VOLPUTAS_PSEUDO_ID_SECRET`. The runtime
config read `VOLUPTAS_PSEUDO_ID_SECRET` instead. Export authentication itself
succeeded; `PersonaExportService` rejected the missing pseudo-ID secret.

## Regression Context

The repository was renamed from Voluptas to Volputas. Most bridge configuration
uses the canonical `VOLPUTAS_` prefix, but this one legacy lookup was not migrated.
Unit tests injected the service dependency and did not exercise HASTER config.

## Cause

`src/config/index.js` used `VOLUPTAS_PSEUDO_ID_SECRET`, while the service-owned
Excubitor catalog correctly provided `VOLPUTAS_PSEUDO_ID_SECRET`.

## Fix Requirements

- Prefer the canonical `VOLPUTAS_` variable while retaining the legacy spelling.
- Use the documented public HASTER fixture when no value is injected in HASTER.
- Never enable the public fallback outside HASTER.
- Keep explicit configuration higher priority than the fixture fallback.

## Verification

`src/config/index.test.js` verifies the effective HASTER configuration: public
fallbacks, canonical-variable priority, and the absence of a non-HASTER
fallback. The live T14 test must export NDJSON, import it into Discutere, and
return a population report.

## Follow-up

Restart `volputas-haster` through Excubitor after merge, complete T14/T16, and
record results in the Discord TestWorkflow thread.
