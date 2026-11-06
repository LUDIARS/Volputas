# SPEC-GLAB-SCOPED-EVIDENCE-UPLOAD

GLAB evidence requests use the accepted Cernere Composite backend contract at
71d6c368dc188bbb95f9af323d347060425d99d6. A project/global Bearer token or a media
ticket alone cannot replace an online one-operation delegation. Local profile
and spectator APIs keep their independent contracts.

For uploads, the destination reserves the arrival capability before receiving
bytes. The SDK binds source/target/user/service session/action/exact path/query,
semantic headers and actual body digest/count. Each destination attempt is
consumed once; unknown outcomes are never automatically retried. Host limits
are the actual ProfileMediaStore rules: screenshots20MiB, voice-memos50MiB,
videos2GiB and game-logs100MiB, maximum300seconds. Global private spool capacity
is4GiB and8 concurrent leases; these are backend-owned constants.

Staging uses exclusive files under a backend-owned private directory on the
same filesystem as protected media. Incomplete, oversized, disconnected,
expired or rejected attempts release their reader, file and lease. The host
does not count a failed unlink as released capacity; cleanup errors are visible
and the orphan's quota remains charged until operational recovery. The SDK
digests the fixed file Blob before finalize. The spool path is never accepted
from a client. Only the owned capture can atomically move its file into the
validated media destination; no second2GiB copy is needed after authorization.

Immediately after online finalize, Voluptas rechecks current record ownership
and media-kind compatibility. It repeats that check immediately before rename.
Only sourceProject=glab is accepted at this integration boundary. Concurrent
commits for a record are rejected; metadata failure cleans up only the file
owned by that attempt. Database metadata and filesystem rename are not a
distributed transaction, so failures after write are explicit unknown outcomes.

Sensitive GET/ticket/read/evaluation and create are explicitly classified.
Ticket playback additionally requires current delegation for the same owner;
an old signed ticket cannot bypass revocation. Missing configuration, unknown
classification or authority uncertainty is an error, with no legacy fallback.

Implementation/registered review, canonical checkout synchronization, deployment
and runtime evidence are separate completion conditions. No coordinated switch
is allowed before all required consumers and administrator settings are ready.

This review unit migrates GLAB evidence routes only. GLAB surveys/reviews/games
still require the corresponding scoped delegation migration; the old middleware
on those separate routers is not a fallback for these evidence routes. SDK and
new contract sources were statically compiled/checked, but the agent did not run
runtime tests, services or a real2GiB upload. Revisor owns registered execution.
