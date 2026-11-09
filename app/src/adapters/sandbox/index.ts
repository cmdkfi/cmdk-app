// Sandbox adapters (PRD §8a), stub only until Phase 6b.
// Every action rejects; nothing here returns simulated protocol data yet.
// This module must never import wagmi, the live adapters or protocol/* at runtime.
import type { Adapters, ProtocolAdapter, WalletAdapter, WalletState } from '../types.ts'

const DISCONNECTED: WalletState = { status: 'disconnected' }
const notImplemented = () => Promise.reject(new Error('Sandbox is not implemented yet (Phase 6b).'))

export function createSandboxWallet(): WalletAdapter {
  return {
    kind: 'sandbox',
    getState: () => DISCONNECTED,
    subscribe: () => () => undefined,
    connect: notImplemented,
    disconnect: notImplemented,
    switchToBaseSepolia: notImplemented,
    signMessage: notImplemented,
    sendTransaction: notImplemented,
    waitForTransaction: notImplemented,
    readBalances: notImplemented,
    readAccountKind: notImplemented,
    dispose: () => undefined,
  }
}

export function createSandboxProtocol(): ProtocolAdapter {
  return {
    kind: 'sandbox',
    loadConfig: notImplemented,
    discoverVaults: notImplemented,
    readRelayerHealth: notImplemented,
    startCreateVault: notImplemented,
    readCreateJob: notImplemented,
    startSetupJob: notImplemented,
    readSetupJob: notImplemented,
    assertFreshOwnerIntent: notImplemented,
    readOwnerRecovery: notImplemented,
    verifyOwnerJob: notImplemented,
    unsubmittedOwnerExpired: notImplemented,
    readLivePosition: notImplemented,
    readActivity: notImplemented,
    readNearSecurity: notImplemented,
    readEvidenceJson: notImplemented,
    readBootFile: notImplemented,
  }
}

export function createSandboxAdapters(): Adapters {
  return { kind: 'sandbox', wallet: createSandboxWallet(), protocol: createSandboxProtocol() }
}
