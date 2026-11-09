// What must never ship in the production build (scripts/check-test-boundary.mjs): browser-test fixtures and wallet
// controls, and — until Phase 6b re-enables it with VITE_SANDBOX=1 — anything of the sandbox.
export const TEST_MARKERS = ['fixture.testnet', '/e2e/harness', 'fixtureWallet', 'fixtureSign']
export const SANDBOX_MARKER = /[sS]andbox/

/** The forbidden markers found in one built file's text. */
export function forbiddenMarkers(content, { sandbox = false } = {}) {
  const found = TEST_MARKERS.filter(marker => content.includes(marker))
  if (!sandbox) { const m = SANDBOX_MARKER.exec(content); if (m) found.push(m[0]) }
  return found
}
