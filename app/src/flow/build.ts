// Build flags. The sandbox (Phase 6b) is compiled in only when the build sets VITE_SANDBOX=1 (vite.config.ts `define`);
// otherwise every sandbox branch folds to false, the minifier drops it, and the stub adapter is not bundled.
// Node tests that exercise the sandbox seams set globalThis.__SANDBOX__ = true before importing.
declare const __SANDBOX__: boolean | undefined

export const SANDBOX: boolean = typeof __SANDBOX__ !== 'undefined' && __SANDBOX__ === true
