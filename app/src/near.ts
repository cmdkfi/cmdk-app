export type AppConfig = { baseChainId: number; nearNetwork: string; nearRpcUrl: string; near: { factory: string | null } }
export type Vault = { accountId: string; number: number; owner: string; baseAddress?: string; marketCount: number }

export async function loadConfig(fetcher: typeof fetch = fetch): Promise<AppConfig> {
  const response = await fetcher('/config.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('App configuration could not be loaded.')
  const config: unknown = await response.json()
  if (!config || typeof config !== 'object') throw new Error('App configuration is invalid.')
  const value = config as AppConfig
  if (value.baseChainId !== 84532 || value.nearNetwork !== 'testnet' || typeof value.nearRpcUrl !== 'string' ||
    !value.near || (value.near.factory !== null && typeof value.near.factory !== 'string')) {
    throw new Error('App configuration does not match the supported testnet.')
  }
  return value
}

export async function viewNear<T>(rpcUrl: string, accountId: string, methodName: string, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'cmdk', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: accountId, method_name: methodName, args_base64: 'e30=' } }),
  })
  if (!response.ok) throw new Error('NEAR RPC is unavailable.')
  const data: unknown = await response.json()
  const result = data as { error?: unknown; result?: { result?: number[] } }
  if (result.error || !Array.isArray(result.result?.result)) throw new Error(`Could not read ${methodName} from ${accountId}.`)
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result.result))) as T
}

export async function discoverVaults(config: AppConfig, address: string, fetcher: typeof fetch = fetch): Promise<{ vaults: Vault[]; failed: number }> {
  const factory = config.near.factory
  if (!factory) throw new Error('Factory deployment is not available yet.')
  const factoryState = await viewNear<{ count: number }>(config.nearRpcUrl, factory, 'get_config', fetcher)
  if (!Number.isSafeInteger(factoryState.count) || factoryState.count < 0 || factoryState.count > 10000) throw new Error('Factory returned an invalid vault count.')
  const vaults: Vault[] = []
  let failed = 0
  for (let start = 1; start <= factoryState.count; start += 5) {
    const batch = Array.from({ length: Math.min(5, factoryState.count - start + 1) }, (_, offset) => start + offset)
    const results = await Promise.allSettled(batch.map(async number => {
      const accountId = `v${number}.${factory}`
      const state = await viewNear<{ owner?: string; base_address?: string; markets?: unknown[] }>(config.nearRpcUrl, accountId, 'get_state', fetcher)
      return { number, accountId, state }
    }))
    for (const result of results) {
      if (result.status === 'rejected') { failed++; continue }
      const { number, accountId, state } = result.value
      if (state.owner?.toLowerCase() === address.toLowerCase()) {
        vaults.push({ accountId, number, owner: state.owner, baseAddress: state.base_address, marketCount: Array.isArray(state.markets) ? state.markets.length : 0 })
      }
    }
  }
  vaults.sort((a, b) => b.number - a.number)
  return { vaults, failed }
}
