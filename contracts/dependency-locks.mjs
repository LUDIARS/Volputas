import { contract } from './contract-runtime.mjs'; /* augur-inject:import:b5942476 */
import augurContract_5b743a74 from './overlay-lock.contract.mjs'; /* augur-inject:contract-predicate:40e8d5cf */
import augurContract_ab17805e from './server-lock.contract.mjs'; /* augur-inject:contract-predicate:30388b74 */
// Read the selected dependency boundaries without loading application code.
export function inspectOverlayLock(lock) {
  return {
    parentRange: lock.packages['node_modules/mermaid'].dependencies.dompurify,
    entry: lock.packages['node_modules/dompurify'],
  };
}
// @ts-expect-error augur-inject
inspectOverlayLock = contract(inspectOverlayLock, { ...augurContract_5b743a74, contractId: 'C-1', mode: 'observe', sample: 1, where: 'contracts/dependency-locks.mjs:2', rule: 'contract-wrap', id: '5b743a74' }); /* augur-inject:contract-wrap:5b743a74 */

export function inspectServerLock(lock) {
  return {
    bodyParserRange: lock.packages['node_modules/body-parser'].dependencies.qs,
    entry: lock.packages['node_modules/body-parser/node_modules/qs'],
    expressRange: lock.packages['node_modules/express'].dependencies.qs,
    retained: lock.packages['node_modules/qs'],
  };
}
// @ts-expect-error augur-inject
inspectServerLock = contract(inspectServerLock, { ...augurContract_ab17805e, contractId: 'C-2', mode: 'observe', sample: 1, where: 'contracts/dependency-locks.mjs:9', rule: 'contract-wrap', id: 'ab17805e' }); /* augur-inject:contract-wrap:ab17805e */
