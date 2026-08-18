# GLAB review relay

### SPEC-GLAB-REVIEW-RELAY

Community-visible game reviews reach Discord through GLAB, not through a
callback from Volputas. GLAB is the authenticated front for review posting: it
proxies `POST /api/v1/integrations/glab/reviews`, reads the `201 { ok, data: { record } }`
response, and queues its own relay row (`glab_review_relay`) from
`record.id` / `glabProjectId` / `gameTitle` / `recommend` / `comment` / `visibility` /
`anonymous`. Volputas therefore keeps those fields on the created record and
does not need `GLAB_URL`, `GLAB_SERVICE_TOKEN`, a relay client, or an author
lookup for relaying (removed 2026-08-18; the previous
`POST /api/x/volputas/external/review-relay` callback no longer exists on GLAB).

Volputas neither stores Discord credentials nor posts to Discord directly. The
`relayedAt` field on older voice records is historical and is no longer written.
Attribution, mention neutralisation, and length limits for the Discord card are
GLAB's responsibility (GLAB `spec/interface/review-relay.md`).
