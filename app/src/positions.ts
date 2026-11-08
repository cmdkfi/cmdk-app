import { createPublicClient, http, isAddress, parseAbi, encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { type AppConfig, viewNear } from './near.ts'

const morphoAbi = parseAbi([
  'function isAuthorized(address owner, address spender) view returns (bool)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
])
const oracleAbi = parseAbi(['function price() view returns (uint256)'])
const executorAbi = parseAbi(['function soldInWindow(address user,address token) view returns (uint256)', 'function movesInWindow(address user) view returns (uint256)', 'function sessionStart(address user,bytes32 id) view returns (uint256)', 'function lastAgentCall(address user) view returns (uint256)', 'function COOLDOWN() view returns (uint256)', 'function closedForAgent(address user, bytes32 id) view returns (bool)', 'function corridors(address user, bytes32 id) view returns (uint64 target, uint64 act, uint64 floor, uint64 sellBudget, bool migrateAllowed, bool exitAllowed, bool set)'])
const tokenAbi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)'])
const irmAbi = parseAbi(['function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv),(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)) view returns (uint256)'])
const WAD = 10n ** 18n

export type MarketPosition = {
  id: Hex
  readOnly?: boolean
  priceUnavailable?: boolean
  collateral: bigint
  debt: bigint
  collateralValue: bigint
  ltv: bigint | null
  liquidationLtv: bigint
  oraclePrice: bigint
  autopilot: string
  executor?: Address
  morpho?: Address
  oracle?: Address
  irm?: Address
  liquidity?: bigint
  borrowShares?: bigint
  floor?: bigint | null
  migrateAllowed?: boolean
  exitAllowed?: boolean
  telemetry?: { sold: bigint; moves: bigint; sessionStart: bigint; lastCall: bigint; cooldown: bigint; closed: boolean }
  dailyBudget?: bigint | null
  agentTarget: bigint | null
  agentTrigger: bigint | null
  loanToken: Address
  collateralToken: Address
  loanSymbol: string
  collateralSymbol: string
  loanDecimals: number
  collateralDecimals: number
}
export type LivePosition = { vault: string; baseAddress: Address; markets: MarketPosition[]; readAt: number; gasBalance?: bigint; freeBalances?: {token:Address;symbol:string;decimals:number;balance:bigint}[]; errors?: string[] }

export function accruedBorrowAssets(assets: bigint, rate: bigint, elapsed: bigint) {
  if (elapsed < 0n || rate < 0n) throw new Error('Invalid interest snapshot.')
  const first = rate * elapsed
  const second = first * first / (2n * WAD)
  const third = second * first / (3n * WAD)
  return assets + assets * (first + second + third) / WAD
}

export function marketMath(collateral: bigint, borrowShares: bigint, totalBorrowAssets: bigint, totalBorrowShares: bigint, oraclePrice: bigint) {
  const debt = (borrowShares * (totalBorrowAssets + 1n) + totalBorrowShares + 1_000_000n - 1n) / (totalBorrowShares + 1_000_000n)
  const collateralValue = collateral * oraclePrice / (10n ** 36n)
  const ltv = collateralValue === 0n ? null : (debt * WAD + collateralValue - 1n) / collateralValue
  return { debt, collateralValue, ltv }
}

export type VaultState = { signer?: string; path?: string; cooldown_secs?: number; last_agent_action?: number; owner?: string; owner_nonce?: number | string; approved?: Record<string, string>; base_address?: string; morpho?: string; agent?: { public_key?: string; expires_at?: number }; markets?: { id?: string; executor?: string; corridor_set?: boolean }[] }

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
  if (await client.getChainId() !== 84532) throw new Error('RPC is not Base Sepolia.')
  const blockNumber = await client.getBlockNumber()
  const block = await client.getBlock({blockNumber})
  const reads = await Promise.allSettled(state.markets.map(async market => {
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
    const computedId = keccak256(encodeAbiParameters([{type:'address'}, {type:'address'}, {type:'address'}, {type:'address'}, {type:'uint256'}], params))
    if (computedId.toLowerCase() !== id.toLowerCase()) throw new Error('Market parameters do not match the registered market ID.')
    const [oraclePrice, loanSymbol, collateralSymbol, loanDecimals, collateralDecimals] = await Promise.all([
      client.readContract({ address: params[2], abi: oracleAbi, functionName: 'price', blockNumber }).catch(() => 0n),
      client.readContract({ address: params[0], abi: tokenAbi, functionName: 'symbol' }),
      client.readContract({ address: params[1], abi: tokenAbi, functionName: 'symbol' }),
      client.readContract({ address: params[0], abi: tokenAbi, functionName: 'decimals' }),
      client.readContract({ address: params[1], abi: tokenAbi, functionName: 'decimals' }),
    ])
    const rate = params[3] === '0x0000000000000000000000000000000000000000' ? 0n : await client.readContract({address:params[3],abi:irmAbi,functionName:'borrowRateView',blockNumber,args:[{loanToken:params[0],collateralToken:params[1],oracle:params[2],irm:params[3],lltv:params[4]},{totalSupplyAssets:totals[0],totalSupplyShares:totals[1],totalBorrowAssets:totals[2],totalBorrowShares:totals[3],lastUpdate:totals[4],fee:totals[5]}]})
    const borrowAssets = accruedBorrowAssets(totals[2],rate,block.timestamp-totals[4])
    const values = marketMath(position[2], position[1], borrowAssets, totals[3], oraclePrice)
    const telemetry = await Promise.all([
      client.readContract({address:market.executor as Address,abi:executorAbi,functionName:'soldInWindow',args:[baseAddress,params[1]],blockNumber}),
      client.readContract({address:market.executor as Address,abi:executorAbi,functionName:'movesInWindow',args:[baseAddress],blockNumber}),
      client.readContract({address:market.executor as Address,abi:executorAbi,functionName:'sessionStart',args:[baseAddress,id],blockNumber}),
      client.readContract({address:market.executor as Address,abi:executorAbi,functionName:'lastAgentCall',args:[baseAddress],blockNumber}),
      client.readContract({address:market.executor as Address,abi:executorAbi,functionName:'COOLDOWN',blockNumber}),
    ]).then(([sold,moves,sessionStart,lastCall,cooldown])=>({sold,moves,sessionStart,lastCall,cooldown,closed})).catch(()=>undefined)
    return {
      floor:corridor[6] ? corridor[2] : null, migrateAllowed:corridor[4],exitAllowed:corridor[5],telemetry,
      readOnly: !config.createVault?.markets.some(item => item.id.toLowerCase() === id.toLowerCase() && item.executor.toLowerCase() === market.executor!.toLowerCase()),
      priceUnavailable: oraclePrice <= 0n,
      executor: market.executor as Address, morpho, oracle: params[2], irm: params[3], liquidity: totals[0] > totals[2] ? totals[0] - totals[2] : 0n, borrowShares: position[1], dailyBudget: corridor[6] ? corridor[3] : null,
      id, collateral: position[2], debt: values.debt, collateralValue: values.collateralValue,
      ltv: values.ltv, liquidationLtv: params[4], oraclePrice,
      autopilot: protectionStatus(state.agent, market.corridor_set === true && corridor[6] && authorized, closed, watched, baseAddress, Date.now() / 1000),
      agentTarget: corridor[6] ? corridor[0] : null,
      agentTrigger: corridor[6] ? corridor[1] : null,
      loanToken: params[0], collateralToken: params[1], loanSymbol, collateralSymbol, loanDecimals, collateralDecimals,
    }
  }))
  const markets: MarketPosition[] = []
  const errors: string[] = []
  reads.forEach((read,index) => {
    if (read.status === 'fulfilled') markets.push(read.value)
    else errors.push(`Market ${state.markets![index].id ?? index + 1}: ${read.reason instanceof Error ? read.reason.message : 'Read failed. Retry.'}`)
  })
  const tokens = new Map<string,{token:Address;symbol:string;decimals:number}>()
  markets.forEach(m => {tokens.set(m.loanToken.toLowerCase(),{token:m.loanToken,symbol:m.loanSymbol,decimals:m.loanDecimals});tokens.set(m.collateralToken.toLowerCase(),{token:m.collateralToken,symbol:m.collateralSymbol,decimals:m.collateralDecimals})})
  const balanceAbi = parseAbi(['function balanceOf(address) view returns (uint256)'])
  const balances = await Promise.allSettled([...tokens.values()].map(async token => ({...token,balance:await client.readContract({address:token.token,abi:balanceAbi,functionName:'balanceOf',args:[baseAddress],blockNumber})})))
  const freeBalances: NonNullable<LivePosition['freeBalances']> = []
  balances.forEach(result => {if(result.status==='fulfilled') freeBalances.push(result.value);else errors.push('A free-token balance could not be read.')})
  const gasBalance = await client.getBalance({address:baseAddress,blockNumber}).catch(()=>undefined)
  return { vault: vaultId, baseAddress, markets, errors, freeBalances, gasBalance, readAt: Date.now() }
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
