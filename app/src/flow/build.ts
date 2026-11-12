// Build flags. The sandbox (Phase 6b) is compiled in by default (vite.config.ts `define`); a build with VITE_SANDBOX=0
// leaves it out: every sandbox branch folds to false, the minifier drops it, and the stub adapter is not bundled.
// Node tests that exercise the sandbox seams set globalThis.__SANDBOX__ = true before importing.
declare const __SANDBOX__: boolean | undefined

export const SANDBOX: boolean = typeof __SANDBOX__ !== 'undefined' && __SANDBOX__ === true
