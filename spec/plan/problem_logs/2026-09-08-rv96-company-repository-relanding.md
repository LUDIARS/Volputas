# Company repository change conflicts with the shared local context

- Date: 2026-09-08
- Status: fixed in working tree; Revisor verification pending
- Area: local data repository configuration

## Evidence

neco approved Rv #96 and confirmed that data repositories differ by company.
The merge failed against main a14a70c in local-okf-survey.md and localRoutes.js.
The reviewed head was 44d67ab. Main had extracted configuredContext into
localContext.js and added capture, narrative, game-insight and overlay routes.

## Resolution

Reapply the reviewed feature on local main. Keep the shared context extraction,
profileRecord and build-test documentation link. Verify the configured origin's
private visibility in the shared context, so the newer route groups cannot bypass
the same boundary. No company-specific repository is a product default.

Keep the current spec/domains taxonomy instead of restoring obsolete
.anatomia/domains definitions and their superseded migration task.

## Verification

Existing visibility and settings tests are retained. Shared-context regression
cases cover switching company repositories and rejection before identity writes.
Newer route tests inject the visibility checker to avoid network access.
Syntax and patch checks run locally; registered tests are delegated to Revisor.
