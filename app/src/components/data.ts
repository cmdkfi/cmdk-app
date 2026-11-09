// React Query hooks over the adapters. Every key includes the adapter kind so live and sandbox data
// never share a cache entry (PRD §8a "never mix"). Failed reads surface as errors, never as values.
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useAdapters } from '../adapters/AdapterProvider.tsx'
import { discoverActiveVault } from '../flow/active-vault.ts'
import { relayerReadiness } from '../flow/creation.ts'
import type { Discovery } from '../flow/entry.ts'
import { readGuided } from '../flow/guided-config.ts'
import type { WalletFunding } from '../protocol/wallet-funding.ts'

export function useAppConfig() {
  const { protocol, kind } = useAdapters()
  return useQuery({
    queryKey: ['config', kind],
    queryFn: async () => {
      const config = await protocol.loadConfig()
      return { config, guided: readGuided(config) }
    },
    staleTime: Infinity,
    retry: 1,
  })
}

/** Live market read for S1/S2; refreshed every 30 s while the tab is visible. */
export function useMarketQuote() {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({
    queryKey: ['quote', kind],
    enabled: !!app,
    queryFn: () => protocol.readMarketQuote(app!.config, app!.guided.liveMarket, app!.guided.base.morpho),
    refetchInterval: 30_000,
    retry: false,
  })
}

/** Vault discovery + D4 for the connected owner (FR-4). */
export function useDiscovery(owner: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig()
  const query = useQuery({
    queryKey: ['discovery', kind, owner?.toLowerCase() ?? null],
    enabled: !!owner && !!app.data,
    queryFn: () => discoverActiveVault(protocol, app.data!.config, app.data!.guided, owner!),
    staleTime: Infinity,
    retry: false,
  })
  let entry: Discovery
  if (!owner) entry = { kind: 'not-checked' }
  else if (app.isError || query.isError) entry = { kind: 'failed' }
  else if (query.data) entry = { kind: 'found', status: query.data.status }
  else entry = { kind: 'checking' }
  return { entry, result: query.data, retry: () => { void (app.isError ? app.refetch() : query.refetch()) } }
}

export function useAccountKind(address: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({
    queryKey: ['account-kind', kind, address?.toLowerCase() ?? null],
    enabled: !!address && !!app,
    queryFn: () => protocol.readAccountKind(app!.config, address!),
    staleTime: Infinity,
    retry: 1,
  })
}

/** Wallet ETH/WETH and wallet-transaction costs; re-read every 10 s until `funded` holds (S3a, FR-17). */
export function useWalletFunding(owner: Address | undefined, amount: bigint | null, funded: (data: WalletFunding) => boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({
    queryKey: ['funding', kind, owner?.toLowerCase() ?? null, amount?.toString() ?? null],
    enabled: !!owner && !!app && amount !== null,
    queryFn: () => protocol.readWalletFunding(app!.config, owner!, { weth: app!.guided.base.weth, gasPriceOracle: app!.guided.base.gasPriceOracle }, app!.guided.walletTxGasLimit, amount!),
    refetchInterval: query => (query.state.data && funded(query.state.data) ? false : 10_000),
    retry: false,
  })
}

export function useRelayerReadiness(enabled: boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({
    queryKey: ['relayer', kind],
    enabled: enabled && !!app,
    queryFn: () => relayerReadiness(protocol, app!.config),
    refetchInterval: 30_000,
    retry: false,
  })
}
