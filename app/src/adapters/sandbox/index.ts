// Sandbox adapters (PRD §8a), stub only until Phase 6b.
// Every action rejects; nothing here returns simulated protocol data yet.
// This module must never import wagmi, the live adapters or protocol/* at runtime.
import type { Adapters, ProtocolAdapter, WalletAdapter, WalletState } from '../types.ts'

const DISCONNECTED: WalletState = { status: 'disconnected' }
const MESSAGE = 'Sandbox is not implemented yet (Phase 6b).'
const notImplemented = () => Promise.reject(new Error(MESSAGE))

export function createSandboxWallet(): WalletAdapter {
  return {
    kind: 'sandbox',
    getState: () => DISCONNECTED,
    subscribe: () => () => undefined,
    hasMetaMask: () => false,
    connect: notImplemented,
    disconnect: notImplemented,
    switchToBaseSepolia: notImplemented,
    signMessage: notImplemented,
    sendTransaction: notImplemented,
    waitForTransaction: notImplemented,
    dispose: () => undefined,
  }
}

export function createSandboxProtocol(): ProtocolAdapter {
  return {
    kind: 'sandbox',
    loadConfig: notImplemented,
    readStatic: notImplemented,
    readMarketQuote: notImplemented,
    estimateDeposit: () => { throw new Error(MESSAGE) },
    readWalletFunding: notImplemented,
    readAccountKind: notImplemented,
    discoverPosition: notImplemented,
    relayerReadiness: notImplemented,
    readVault: notImplemented,
    readNearTime: notImplemented,
    readWalletTokens: notImplemented,
    readOpenPlan: notImplemented,
    readReceipts: notImplemented,
    createVault: notImplemented,
    ownerCall: notImplemented,
    readJob: notImplemented,
    composeOwnerMessage: () => { throw new Error(MESSAGE) },
    checkOwnerSignature: notImplemented,
    walletTx: () => { throw new Error(MESSAGE) },
    fundsShortfall: () => null,
    readAgentRegistration: notImplemented,
    readPosition: notImplemented,
    readAgent: notImplemented,
    readActivity: notImplemented,
    readClosePlan: notImplemented,
  }
}

export function createSandboxAdapters(): Adapters {
  return { kind: 'sandbox', wallet: createSandboxWallet(), protocol: createSandboxProtocol() }
}
