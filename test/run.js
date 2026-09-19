/**
 * Test entry (`npm test`). Each module is a self-contained script that runs its
 * assertions at import time and prints one `ok:`/`skip:` line; a failure throws
 * and stops the run.
 *
 * No harness, no host, and no network are required: the discovery check detects
 * an installed harness and skips itself when there is none.
 */
await import('./composition.mjs');
await import('./mask.mjs');
await import('./roots-path.mjs');
await import('./discovery.mjs');

console.log('all tests passed');
