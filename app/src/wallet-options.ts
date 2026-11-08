type WalletOption = { id: string; uid: string; name: string; type: string }

// EIP-6963 connectors have their wallet's RDNS as ID. Prefer those over
// the generic window.ethereum connector, which points at one of the same wallets.
export function walletOptions<T extends WalletOption>(connectors: readonly T[], available: ReadonlySet<string>): T[] {
  const injected = connectors.filter(item => item.type === 'injected' && available.has(item.uid))
  const announced = injected.filter(item => item.id !== 'injected')
  const installed = announced.length ? announced : injected
  const ids = new Set<string>()
  const unique = installed.filter(item => {
    if (ids.has(item.id)) return false
    ids.add(item.id)
    return true
  })
  const hasCoinbase = unique.some(item => /coinbase/i.test(`${item.id} ${item.name}`))
  const sdk = connectors.find(item => item.id === 'coinbaseWalletSDK')
  return [...unique, ...(!hasCoinbase && sdk ? [sdk] : [])]
}
