// The S3 wallet list (PRD S3, FR-3; Phase 8): every injected wallet announced through EIP-6963 (wagmi creates one
// connector per announcement, id = rdns, with the announced name and icon), plus the legacy `window.ethereum` entry
// (wagmi's generic `injected()` connector) only when that provider was not announced. Pure: no wagmi import.

export type WalletOption = { id: string; name: string; icon?: string }

export type ConnectorInfo = { id: string; name: string; icon?: string; type: string; provider: unknown }

/** wagmi's id of the generic injected connector (`injected()`), which wraps `window.ethereum`. */
export const LEGACY_ID = 'injected'

/** The generic connector's name when the provider sets no recognised flag; shown as a plain description instead. */
const GENERIC_NAMES = new Set(['Injected', 'Injected Wallet'])

export function walletOptions(connectors: ConnectorInfo[], legacyProvider: unknown): WalletOption[] {
  const announced = connectors.filter(c => c.type === 'injected' && c.id !== LEGACY_ID)
  const out: WalletOption[] = announced.map(c => ({ id: c.id, name: c.name, icon: c.icon }))
  const legacy = connectors.find(c => c.id === LEGACY_ID)
  if (legacy && legacyProvider && !announced.some(c => c.provider === legacyProvider)) out.push({ id: LEGACY_ID, name: walletName(legacy.name) ?? 'Browser wallet' })
  return out
}

/** The connected wallet's name for copy ("Waiting for Rabby…"); null for the generic connector (copy says "your wallet"). */
export function walletName(name: string | undefined): string | null {
  return !name || GENERIC_NAMES.has(name) ? null : name
}
