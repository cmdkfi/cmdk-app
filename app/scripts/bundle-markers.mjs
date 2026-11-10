// What must never ship in the production build (scripts/check-test-boundary.mjs): browser-test fixtures and wallet
// controls. The sandbox ships since Phase 6b (PRD §8a); its isolation is proven by tests instead (never persists to
// localStorage, never contacts a network host: e2e/sandbox.spec.ts, src/adapters/sandbox/engine.test.mjs).
export const TEST_MARKERS = ['fixture.testnet', '/e2e/harness', 'fixtureWallet', 'fixtureSign']

/** The forbidden markers found in one built file's text. */
export function forbiddenMarkers(content) {
  return TEST_MARKERS.filter(marker => content.includes(marker))
}
