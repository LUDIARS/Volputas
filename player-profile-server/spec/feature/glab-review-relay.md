# GLAB review relay

Community-visible game reviews are delivered best-effort to GLAB at
`POST /api/x/volputas/external/review-relay`. Volputas sends the review ID,
project ID, game title, boolean-or-null recommendation, sanitised 300-character
excerpt, author, and a Volputas review URL. The request authenticates with
`X-Glab-Service-Token`; Volputas neither stores Discord credentials nor posts to
Discord directly.

Both HTTP 200 and 201 acknowledge a relay. Missing GLAB configuration, a
rejected status, and a relay that exceeds the 10-second request timeout all
leave review creation successful and do not set `relayedAt`; review submission
never waits on an unresponsive GLAB.
Anonymous reviews use an anonymous author label, and all outbound free text
neutralises mass mentions before GLAB's bot renders it.
