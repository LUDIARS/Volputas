# SPEC-GLAB-SCOPED-CATALOG-DELEGATION

GLAB surveys/reviews/games consume one current Cernere delegation for the exact
method/path/query/semantic headers/raw bytes. Their routers mount before the
global JSON parser, and parse only the authenticated fixed bytes. A generic
project/global Bearer token, caller identity or positive cache is not accepted.
Only sourceProject=glab is accepted by the shared target adapter. An operation
must be explicitly classified; unknown endpoints/methods fail closed.

Each fixed method/path declaration is matched by Express itself, with its
snapshot of decoded route params. A backend-owned WeakSet records successful
SDK execution within this request only; it is not a cache or a credential. It
prevents overlapping route declarations from consuming the same proof twice.
The exact method is checked (including rejecting undeclared HEAD), and the
fallback before all handlers rejects requests without this internal marker.
This removes duplicate manual request-path regex parsing; no shell/process/
dynamic-code boundary exists in request classification.

Data ACLs stay in Voluptas. Catalog administration requires current Cr admin
role both before execution and at existing route gates. Published survey and
owner response checks remain current at read/write. Review follow-up/analysis
requires the current owner-scoped voice; public review projections retain their
visibility rules. The SDK proof never replaces those checks or the explicit
analysis consent:true boundary. Capture is bounded1MiB/30seconds for these
small-body requests; the separate bounded-upload protocol is unchanged.

The shared middleware keeps the request owner until Express finishes/closes the
response, including asynchronous handlers. It neither retries nor reports a
post-execution database/response failure as authorization uncertainty. Source
and target exact action/risk declarations must be registered by an administrator
before cutover. Secret values stay in Ex-managed injection; no config is changed
or service started by this source migration.

This follows the accepted evidence/upload target PR3637 (publishedf97c1472).
Source review/static checks, registered review, canonical source reflection,
administrator settings, coordinated deployment and actual runtime evidence are
separate acceptance conditions. No early deployment while other consumers are
still on the incompatible credential contract.

Before switching, the administrator must verify the existing Ex-managed
CERNERE_BASE_URL, CERNERE_PROJECT_CLIENT_ID and CERNERE_PROJECT_CLIENT_SECRET
belong to managed project `voluptas`. The SDK validates that returned project
key. Cernere's administrator-owned target hub_url must match Voluptas's published
origin, and source GLAB must have its own registered hub_url/composite_origins,
scoped consent and target delegation permissions. No credential value is copied
into this document or sent to a browser. Existing config absence fails explicitly.

Use the established Cr `service_operations` declaration contract to register
these exact actions/risks and explicit permission names for user consent on the
required source/target projects. Identity/basic consent alone is insufficient.

| Risk | Exact actions |
| --- | --- |
| read | review.analysis.catalog |
| sensitive_read | survey.list, survey.read, review.list, review.follow-up.read, review.analysis.read, games.recent, games.list |
| important | survey.create, survey.update, survey.respond, review.create, review.follow-up.write, review.analysis.create, games.create, games.update |

GLAB source must classify `reviews/analysis/catalog` before its record-id pattern
and use target `reviews/recent-games` (the actual mounted route). Its current
downstream list's root `recent-games` spelling does not match that target; that
caller correction and GLAB local operation classifications are still required.
The SDK protocol/target endpoint does not silently accept the wrong alternate
path. Configuration changes and deployment remain pending, with no new runtime
secret or permission presumed available merely because source is merged.
