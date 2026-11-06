# Accepted Composite backend source

MIT Cernere source is pinned by `source-pin.json`. Only the eight-file backend
graph is included. `dist/` contains the standard TypeScript output used by this
CommonJS service via dynamic import; it is not a custom token implementation.
There are no runtime package dependencies or lifecycle scripts here.

To reproduce source, first review the exact accepted source/history and run
`node scripts/vendor-composite.mjs <reviewed-local-Cernere-repository>` from
player-profile-server. Compile `tsconfig.json` with an already reviewed standard
TypeScript compiler and Node types. This change used TypeScript5.9.3, ES2022 /
NodeNext, declarations, no transforms. The source hashes and output hashes in
`artifact-pin.json` make the exact committed inputs/output inspectable.
Do not fetch packages, execute source or run services as part of source review.

The SDK communicates lazily with the configured Cernere authority only. Project
credentials stay in backend memory; body bytes remain in protected local media
storage. The service must still authorize its own current records.
