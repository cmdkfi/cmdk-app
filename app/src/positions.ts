import { createPublicClient, http, isAddress, parseAbi, type Address, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { type AppConfig, viewNear } from './near.ts'

const morphoAbi = parseAbi([
  'function isAuthorized(address owner, address spender) view returns (bool)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
])
const oracleAbi = parseAbi(['function price() view returns (uint256)'])
const executorAbi = parseAbi(['function closedForAgent(address user, bytes32 id) view returns (bool)', 'function corridors(address user, bytes32 id) view returns (uint64 target, uint64 act, uint64 floor, uint64 sellBudget, bool migrateAllowed, bool exitAllowed, bool set)'])
const tokenAbi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)'])
const WAD = 10n ** 18n

export type MarketPosition = {
  id: Hex
  collateral: bigint
  debt: bigint
  collateralValue: bigint
  ltv: bigint | null
  liquidationLtv: bigint
  oraclePrice: bigint
  autopilot: string
  agentTrigger: bigint | null
  loanToken: Address
  collateralToken: Address
  loanSymbol: string
  collateralSymbol: string
  loanDecimals: number
  collateralDecimals: number
}
export type LivePosition = { vault: string; baseAddress: Address; markets: MarketPosition[]; readAt: number }

export function marketMath(collateral: bigint, borrowShares: bigint, totalBorrowAssets: bigint, totalBorrowShares: bigint, oraclePrice: bigint) {
  const debt = (borrowShares * (totalBorrowAssets + 1n) + totalBorrowShares + 1_000_000n - 1n) / (totalBorrowShares + 1_000_000n)
  const collateralValue = collateral * oraclePrice / (10n ** 36n)
  const ltv = collateralValue === 0n ? null : (debt * WAD + collateralValue - 1n) / collateralValue
  return { debt, collateralValue, ltv }
}

type VaultState = { owner?: string; base_address?: string; morpho?: string; agent?: { public_key?: string; expires_at?: number }; markets?: { id?: string; executor?: string; corridor_set?: boolean }[] }

export async function readLivePosition(config: AppConfig, vaultId: string, expectedOwner: string): Promise<LivePosition> {
  const state = await viewNear<VaultState>(config.nearRpcUrl, vaultId, 'get_state')
  if (state.owner?.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error('This vault is no longer owned by the connected wallet.')
  if (!state.base_address || !isAddress(state.base_address) || !state.morpho || !isAddress(state.morpho) || !Array.isArray(state.markets)) {
    throw new Error('The vault returned incomplete position data.')
  }
  const baseAddress = state.base_address as Address
  const morpho = state.morpho as Address
  const client = createPublicClient({ chain: baseSepolia, transport: http(config.baseRpcUrl) })
  const observation = await fetch(`${config.relayerUrl}/agent/vaults`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    .then(async response => response.ok ? await response.json() : null).catch(() => null)
  const watched = Array.isArray(observation?.vaults) ? observation.vaults.find((item: { vault?: string }) => item.vault === vaultId) : null
  const blockNumber = await client.getBlockNumber()
  const markets = await Promise.all(state.markets.map(async market => {
    if (!market.id || !/^0x[0-9a-fA-F]{64}$/.test(market.id) || !market.executor || !isAddress(market.executor)) {
      throw new Error('A vault market has an invalid address or ID.')
    }
    const id = market.id as Hex
    const [position, totals, params, corridor, closed, authorized] = await Promise.all([
      client.readContract({ address: morpho, abi: morphoAbi, functionName: 'position', args: [id, baseAddress], blockNumber }),
      client.readContract({ address: morpho, abi: morphoAbi, functionName: 'market', args: [id], blockNumber }),
      client.readContract({ address: morpho, abi: morphoAbi, functionName: 'idToMarketParams', args: [id], blockNumber }),
      client.readContract({ address: market.executor as Address, abi: executorAbi, functionName: 'corridors', args: [baseAddress, id], blockNumber }),
      client.readContract({ address: market.executor as Address, abi: executorAbi, functionName: 'closedForAgent', args: [baseAddress, id], blockNumber }),
      client.readContract({ address: morpho, abi: morphoAbi, functionName: 'isAuthorized', args: [baseAddress, market.executor as Address], blockNumber }),
    ])
    const [oraclePrice, loanSymbol, collateralSymbol, loanDecimals, collateralDecimals] = await Promise.all([
      client.readContract({ address: params[2], abi: oracleAbi, functionName: 'price', blockNumber }),
      client.readContract({ address: params[0], abi: tokenAbi, functionName: 'symbol' }),
      client.readContract({ address: params[1], abi: tokenAbi, functionName: 'symbol' }),
      client.readContract({ address: params[0], abi: tokenAbi, functionName: 'decimals' }),
      client.readContract({ address: params[1], abi: tokenAbi, functionName: 'decimals' }),
    ])
    if (oraclePrice <= 0n) throw new Error('The market oracle did not return a usable price.')
    const values = marketMath(position[2], position[1], totals[2], totals[3], oraclePrice)
    return {
      id, collateral: position[2], debt: values.debt, collateralValue: values.collateralValue,
      ltv: values.ltv, liquidationLtv: params[4], oraclePrice,
      autopilot: protectionStatus(state.agent, market.corridor_set === true && corridor[6] && authorized, closed, watched, baseAddress, Date.now() / 1000),
      agentTrigger: corridor[6] ? corridor[1] : null,
      loanToken: params[0], collateralToken: params[1], loanSymbol, collateralSymbol, loanDecimals, collateralDecimals,
    }
  }))
  return { vault: vaultId, baseAddress, markets, readAt: Date.now() }
}

export function protectionStatus(agent: { public_key?: string; expires_at?: number } | undefined, configured: boolean, closed: boolean,
  observation: { agent_status?: string; base_address?: string; expires_at?: number; last_tick_unix?: number } | null, baseAddress: string, now: number): string {
  if (!agent?.public_key || !configured) return 'Not configured'
  if (!agent.expires_at || agent.expires_at <= now) return 'Expired'
  if (closed) return 'Closed for agent'
  const tick = observation?.last_tick_unix
  if (observation?.agent_status !== 'active' || observation.base_address?.toLowerCase() !== baseAddress.toLowerCase() ||
    observation.expires_at !== agent.expires_at || typeof tick !== 'number' || tick > now + 30 || now - tick > 60) return 'Unavailable'
  return 'Active'
}
