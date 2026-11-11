// Adapter interfaces (PRD §8a). Screens, components and flow talk only to these; the live implementation is the
// only consumer of protocol/, the sandbox one is simulated (Phase 6b).
import type { Address, Hex, TransactionReceipt } from 'viem'
import type { AccountKind } from '../flow/account.ts'
import type { AddChainParams, LoadedConfig } from '../flow/config.ts'

export type AdapterKind = 'live' | 'sandbox'

export type WalletState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  /** `walletName`: the connected wallet's announced name (EIP-6963), or null for an unnamed injected provider. */
  | { status: 'connected'; address: Address; chainId: number; walletName: string | null }

/** One entry of the S3 wallet list (Phase 8): an EIP-6963 announcement, or the unannounced `window.ethereum`. */
export type WalletOption = { id: string; name: string; icon?: string }

export interface WalletAdapter {
  readonly kind: AdapterKind
  /** Stable snapshot for useSyncExternalStore. */
  getState(): WalletState
  subscribe(listener: () => void): () => void
  /** The injected wallets in this browser (stable snapshot; changes when a wallet announces itself). */
  getWallets(): WalletOption[]
  subscribeWallets(listener: () => void): () => void
  connect(walletId: string): Promise<void>
  disconnect(): Promise<void>
  /** Switches to Base Sepolia; a wallet's 4902 answer (unknown chain) adds the network with exactly these values. */
  switchToBaseSepolia(network: AddChainParams): Promise<void>
  signMessage(message: string): Promise<Hex>
  sendTransaction(tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex>
  waitForTransaction(hash: Hex, confirmations: number): Promise<TransactionReceipt>
  /** wallet_watchAsset (EIP-747) for an ERC-20: asks the wallet to list the token; true when the wallet accepted. */
  watchAsset(asset: TokenAsset): Promise<boolean>
  dispose(): void
}

/** An ERC-20 as the wallet lists it (EIP-747 options): the address from config.json, symbol and decimals read from the token. */
export type TokenAsset = { address: Address; symbol: string; decimals: number; image?: string }

/** S1/S2 market read at one block; any field that could not be read is null. */
export type MarketQuote = {
  blockNumber: bigint
  lltv: bigint
  loanDecimals: number
  collateralDecimals: number
  price: bigint | null
  liquidity: bigint | null
  /** Simple borrow APR as a fraction (0.05 = 5%), or null. */
  borrowApr: number | null
}

export type DepositEstimate = {
  value: bigint | null
  target: bigint | null
  borrow: bigint | null
  limited: boolean
  resultingLtv: bigint | null
  liquidityKnown: boolean
  /** When limited: the largest deposit that would still open at the target today. */
  maxAmountAtTarget: bigint | null
}

export type WalletFunding = { blockNumber: bigint; eth: bigint; weth: bigint; wrapCost: bigint; transferCost: bigint }

/** The vault D4 picks for an owner, reduced to what the entry resolver needs. */
export type PositionSummary = {
  vault: { accountId: string; number: number; baseAddress: Address }
  markets: { collateral: bigint; debt: bigint }[]
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  setupComplete: boolean
}

export type Readiness = { kind: 'ready' | 'pending' | 'failed'; message: string }

/** A vault as S4 needs it: NEAR state plus one Base snapshot. `setup` is opaque protocol data for composeOwnerMessage. */
export type VaultView = {
  accountId: string
  number: number
  owner: Address
  baseAddress: Address
  ownerNonce: number
  agentPublicKey: string | null
  setupComplete: boolean
  measurementApproved: boolean
  /** The vault approves some measurement (`approved` not null); false after revoke_agent or before the first setup. */
  approvesAny: boolean
  /** The vault holds the published markets, executor and cooldown (protocol/near/vault.ts `policyMatches`). */
  policyMatches: boolean
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  markets: { id: Hex; collateral: bigint; borrowShares: bigint; debt: bigint }[]
  setup: unknown
}

export type OwnerIntent =
  | { method: 'setup' }
  | { method: 'open'; collateralIn: bigint; targetLtv: bigint }
  | { method: 'withdraw'; token: 'weth' | 'usdc'; amount: bigint; destination: Address }
  | { method: 'close'; market: Hex }
  /** Phase 12: delete the agent key and clear the approval (vault/src/lib.rs l.419-424). */
  | { method: 'revoke_agent' }

export type JobView = {
  ok: boolean
  stage: 'accepted' | 'vault_checked' | 'base_sent' | 'vault_created' | 'float_sent' | 'done' | 'failed'
  vault?: string
  baseAddress?: Address
  nearTx?: string
  receipts: { hash: Hex; status: number }[]
  error?: string
  httpStatus?: number
}

/** Relayer and chain failures, in the terms S4 acts on. */
export class ProtocolError extends Error {
  readonly kind: 'refused' | 'rate-limited' | 'uncertain' | 'lost' | 'unavailable'
  readonly retryAfter?: number
  constructor(kind: ProtocolError['kind'], message: string, retryAfter?: number) {
    super(message)
    this.kind = kind
    this.retryAfter = retryAfter
  }
}

export type OpenPlan = {
  /** Every Chainlink feed of the live market is fresh (Executor._requireFresh). */
  feedsFresh: boolean
  collateralIn: bigint
  value: bigint | null
  /** What the market can lend now after the 1% margin, in loan units. */
  lendable: bigint | null
  loanDecimals: number
  targetLtv: bigint
  belowTarget: boolean
}

export type ReceiptView = { hash: Hex; status: 'success' | 'reverted' | 'pending'; confirmations: number }
export type WalletTokens = { eth: bigint; weth: bigint; usdc: bigint }
export type WalletTx = { to: Address; data: Hex; value: bigint }
export type WalletTxIntent = { kind: 'wrap'; amount: bigint } | { kind: 'transfer'; token: 'weth' | 'usdc'; to: Address; amount: bigint } | { kind: 'topUp'; to: Address; amount: bigint }
/** One check's outcome: the value read, or why it could not be read; `at` is when the check finished (PRD §6). */
/** Sandbox only (PRD §8a.1): the position when the market crash was run, at the start price. */
export type CrashStart = { price: bigint; collateral: bigint; debt: bigint; value: bigint; ltv: bigint | null; borrowed: bigint }
/** One crash stage: the price, the same loan without the agent (a calculation) and the sandbox position (with the agent). */
export type CrashStage = {
  index: 1 | 2 | 3
  price: bigint
  /** What Morpho would have done: `liquidation` when a liquidator acted at this stage; `liquidatedEarlier` when it already had. */
  without: { collateral: bigint; debt: bigint; value: bigint; ltv: bigint | null; liquidation: { repaid: bigint; seized: bigint; ltvBefore: bigint | null } | null; liquidatedEarlier: boolean }
  /** The sandbox position after the stage; `reduce` when the agent's protective reduce acted at this stage. */
  with: { collateral: bigint; debt: bigint; value: bigint; ltv: bigint | null; reduce: { repaid: bigint; sold: bigint; ltvBefore: bigint | null } | null }
}
export type CrashView = {
  /** ready: an open position that has not run it; running: stages 1–3 shown; done: finished (once per position). */
  status: 'ready' | 'running' | 'done'
  start: CrashStart | null
  stages: CrashStage[]
  lltv: bigint
  act: bigint
  liquidationIncentive: bigint
}
/**
 * Sandbox only (docs/prd-sandbox-venue-stress.md §5): the recorded scene the Venue stress card replays, the subset of
 * cmdkfi/app evidence/scenes/venue-stress.json kept in adapters/sandbox/scenes/venue-stress.json (keys as in the source).
 */
export type VenueMarketFigures = { utilization: number; free_liquidity_units: string; borrow_apr: number }
export type VenuePhase = { block: number; ts: number; utc: string; markets: { live: VenueMarketFigures; backup: VenueMarketFigures } }
export type VenueTranscript = {
  name: string
  sha256: string
  time_utc: string
  trigger: { kind: string; new_screens: string[] }
  screens: string[]
  judge: null | { outcome: string; accepted: boolean; answer: { risk: string; action: string; market: string; reasons: string[] } }
  decisions: { market: string; action: string; to: string | null; fraction: string; amount: string; protective: boolean; basis: string }[]
  proposal?: { method: string; sent: boolean; base_tx: string; base_block: number }
}
export type VenueScene = {
  source: { repository: string; path: string; commit: string; sha256: string }
  scene: string
  market: string
  destination: string
  phases: { before: VenuePhase; after_borrow: VenuePhase; after: VenuePhase }
  comparison: { collateral_identical: boolean; debt_equal: boolean; debt_equal_within_units: number }
  actions: { block: number; kind: string; tx: string; by: string; from: string; to: string; fraction: string; debt_moved_units: string; collateral_moved_wei: string }[]
  transcripts: VenueTranscript[]
}
/** The sandbox position when the venue stress was run, on the live market. */
export type VenueStart = { collateral: bigint; debt: bigint; ltv: bigint | null }
/**
 * The sandbox position's move at stage 3 (Executor.migrate semantics) and the summary's interest for a year, debt ×
 * APR simple, at the recorded live APR after the borrow and the recorded backup APR after the move (as shown, two decimals).
 */
export type VenueMove = { collateralBefore: bigint; collateralAfter: bigint; debtBefore: bigint; debtAfter: bigint; interestLive: bigint; interestBackup: bigint }
export type VenueView = {
  /** ready: an open position that has not run it; running: stages 1–3; done: finished (once per position). */
  status: 'ready' | 'running' | 'done'
  stage: 0 | 1 | 2 | 3
  start: VenueStart | null
  move: VenueMove | null
  scene: VenueScene
}
/** The sandbox's venue stress controls (venue stress PRD §5 "venue.run() and venue.next()"); the live adapter has none. */
export interface VenueControl {
  /** null when there is no open position to run it on. */
  read(): Promise<VenueView | null>
  run(): Promise<void>
  next(): Promise<void>
}

/** The sandbox's market crash controls (PRD §8a.1 "crash.run(), crash.next()"); the live adapter has none. */
export interface CrashControl {
  /** null when there is no open position to run it on. */
  read(): Promise<CrashView | null>
  run(): Promise<void>
  next(): Promise<void>
  /**
   * Start over: the price back to the start before the new position opens (§8a.1), and the position back on the live
   * market (venue stress PRD §2); refused while a position is open.
   */
  resetPrice(): Promise<void>
}

export type Fetched<T> = { ok: true; at: number; value: T } | { ok: false; at: number; error: string }

/**
 * The PRD §6 verification facts for one vault, each fetched independently (a failed fetch touches its own row only).
 * Booleans come from evidence/verify.ts; null means the check has nothing to compare yet (no approval, no key).
 */
export type VerificationFacts = {
  vaultId: string
  /** Row 1: get_state().approved against the published manifest's agent.measurement. */
  measurement: Fetched<{ matches: boolean | null; sourceCommit: string | null; version: string | null }>
  /** Row 2: sha256(app-compose.json) against approved.compose_hash, and against the /agent/ index entry (null: no entry). */
  compose: Fetched<{ matchesApproved: boolean | null; matchesIndex: boolean | null; sha256: string }>
  /** Row 3: the /agent/vaults row for this vault (null: the agent lists no row for it yet). */
  registration: Fetched<{ registration: string; agentStatus: string | null; expiresAt: number | null; registrationTx: string | null } | null>
  /** Row 4: view_access_key_list against the vault's agent key (null: the vault records no agent key yet). */
  keys: Fetched<{ limited: boolean | null; count: number }>
  /** Row 5: the vault's code hash against the factory's. */
  code: Fetched<{ matches: boolean }>
}

export type PositionMarket = {
  id: Hex
  executor: Address
  collateral: bigint
  debt: bigint
  /** Collateral value in loan units at the oracle price, or null when the price is unreadable. */
  value: bigint | null
  ltv: bigint | null
  lltv: bigint
  corridor: { target: bigint; act: bigint; floor: bigint; sellBudget: bigint; migrateAllowed: boolean; set: boolean }
  closedForAgent: boolean
  collateralToken: Address
  loanDecimals: number
  collateralDecimals: number
  /** The Executor's configured Chainlink feeds; `description` from the deployment manifest, null when not listed there. */
  feeds: { address: Address; description: string | null; maxAge: number; updatedAt: bigint | null }[]
}

/** S6: what closing needs, read at one block (relayer.py l.516-529; Executor.close l.226-240; PRD S6, R10). */
export type ClosePlan = {
  blockNumber: bigint
  blockTime: bigint
  /** Markets holding debt or collateral, each to be closed by one owner call. */
  markets: { id: Hex; borrowShares: bigint; collateral: bigint; debtNow: bigint; debtAhead: bigint }[]
  /** Σ debt accrued to the read block, and to the read block + the message lifetime (600 s). */
  debtNow: bigint
  debtAhead: bigint
  /** The relayer's requirement (debt + debt // 100) on debtNow and on debtAhead. */
  needNow: bigint
  needAhead: bigint
  /** Collateral that close releases (Σ Morpho collateral). */
  collateral: bigint
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  walletUsdc: bigint
}

/** S5: one snapshot at one block (PRD S5, FR-9). */
export type PositionView = {
  blockNumber: bigint
  blockTime: bigint
  vault: { accountId: string; number: number; owner: Address; baseAddress: Address }
  morpho: Address
  markets: PositionMarket[]
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  sellBudgets: { executor: Address; token: Address; activeCollateral: bigint; sold: bigint; budgetWad: bigint; remaining: bigint }[]
}

export type AgentListRow = { registration?: string; agent_status?: string; expires_at?: number; last_tick_unix?: number | null }

/**
 * The facts the agent card derives its status from (PRD S5, Phase 7b): the chain first (the vault's recorded agent,
 * vault/src/lib.rs l.555, and the NEAR key check), then the agent's own /agent/vaults list, which may lag behind the
 * chain and is read on its own, so a failed list read does not hide what the chain shows.
 */
export type AgentFacts = {
  /**
   * The vault's approved measurement against the published manifest (help.manifest, read each time): true/false, null
   * when the vault approves none; a failed manifest read is ok: false. The agent watches a vault only while `approved`
   * equals its own measurement (agent/src/vaults.rs l.8-9, l.82-87), so a stale approval protects nothing.
   */
  approval: { ok: true; matches: boolean | null } | { ok: false; error: string }
  keyLimited: boolean
  vaultAgent: { public_key: string; expires_at: number } | null
  /** The agent's row for this vault (null: no row yet), or the list could not be read. */
  list: { ok: true; row: AgentListRow | null } | { ok: false; error: string }
}

export type ActivityItem = {
  name: string
  actor: 'you' | 'agent' | 'transfer'
  blockNumber: bigint
  /** Block time in seconds, or null when the block could not be read. */
  time: bigint | null
  transactionHash: Hex
  logIndex: number
  args: Record<string, unknown>
  token?: Address
}

/** One window of recent actions; `reachedStart` when it reaches the Executor's deploy block. */
export type ActivityWindow = { from: bigint; to: bigint; head: bigint; items: ActivityItem[]; reachedStart: boolean }

/**
 * Deployment data that does not move (market params, decimals, LLTV, Executor feeds and max ages), read once per
 * session for S1 and S5 (PRD §9 2). Opaque outside the live adapter; the onboarding and close chains never use it.
 */
export type DeploymentStatic = { readonly kind: 'deployment-static'; readonly data: unknown }

/** Only what the screens use; methods are added when a screen needs them. */
export interface ProtocolAdapter {
  readonly kind: AdapterKind
  loadConfig(): Promise<LoadedConfig>
  /** Static deployment data for the configured markets (Morpho idToMarketParams, Executor.config, decimals). */
  readStatic(app: LoadedConfig): Promise<DeploymentStatic>
  readMarketQuote(app: LoadedConfig, statics: DeploymentStatic): Promise<MarketQuote>
  /** Pure: value, borrow at the configured target and the liquidity cap for a deposit amount (no I/O). */
  estimateDeposit(app: LoadedConfig, quote: MarketQuote, amountWei: bigint): DepositEstimate
  readWalletFunding(app: LoadedConfig, owner: Address, amountWei: bigint): Promise<WalletFunding>
  readAccountKind(app: LoadedConfig, address: Address): Promise<AccountKind>
  /** The USDC of config.json (deployments/testnet.json base.tokens.usdc) with its ERC-20 symbol and decimals, for watchAsset (Phase 7b). */
  readUsdcAsset(app: LoadedConfig): Promise<TokenAsset>
  /**
   * Whether the measurement baked into config.json (the one a setup message approves) equals the published manifest's
   * agent.measurement at run time (Phase 7b item 1a); throws when the manifest cannot be read.
   */
  configMatchesPublished(app: LoadedConfig): Promise<boolean>
  /** D4: the owner's newest vault numbered from firstVaultNumber, or null; throws when that cannot be known. `hint`: the vault last found for this owner, verified with one get_state (PRD §9 5). */
  discoverPosition(app: LoadedConfig, owner: Address, hint?: string | null): Promise<PositionSummary | null>
  relayerReadiness(app: LoadedConfig): Promise<Readiness>

  // ---- Phase 3 (S4) --------------------------------------------------------------------------------------------
  /** NEAR get_state + one Base snapshot (vault/src/lib.rs l.539-557; Interfaces.sol, Executor.sol l.22-32, l.65). */
  readVault(app: LoadedConfig, vaultId: string): Promise<VaultView>
  /** Final NEAR block time in seconds: the clock owner-message expiry is checked against (lib.rs l.49-51). */
  readNearTime(app: LoadedConfig): Promise<number>
  /** ETH, WETH and USDC in a wallet (IERC20.balanceOf). */
  readWalletTokens(app: LoadedConfig, owner: Address): Promise<WalletTokens>
  /** Feed freshness and the liquidity-limited target LTV, re-read just before the open signature (Executor.sol l.481-489, l.519-536). */
  readOpenPlan(app: LoadedConfig, vault: VaultView, collateralIn: bigint): Promise<OpenPlan>
  /** Receipt status and confirmations (FR-5: two). */
  readReceipts(app: LoadedConfig, hashes: Hex[]): Promise<ReceiptView[]>
  /** POST /create-vault with the configured policy (RELAYER.md l.73; cloud/src/index.ts l.442-458) → job id. */
  createVault(app: LoadedConfig, owner: Address): Promise<string>
  /** POST /owner-call (RELAYER.md l.75, l.84-93) → job id. */
  ownerCall(app: LoadedConfig, vaultId: string, message: string, signature: Hex): Promise<string>
  /** GET /job/<id> (RELAYER.md l.96-111); a forgotten job throws ProtocolError 'lost'. */
  readJob(app: LoadedConfig, id: string): Promise<JobView>
  /** Exact owner-message text (vault/src/owner.rs l.21-31; lib.rs l.131-193; relayer.py l.462-483). Pure. */
  composeOwnerMessage(app: LoadedConfig, vault: VaultView, intent: OwnerIntent, nonce: number, expiry: number): string
  /** The signature recovers to the owner (owner.rs l.36-50). */
  checkOwnerSignature(message: string, signature: Hex, owner: Address): Promise<boolean>
  /** Wallet transaction for wrap, WETH transfer or gas top-up (rebalance_pool.py l.349; Interfaces.sol l.86). Pure. */
  walletTx(app: LoadedConfig, intent: WalletTxIntent): WalletTx
  /** The relayer's gas refusal amounts, or null (relayer.py l.814-819). Pure. */
  fundsShortfall(error: string | undefined): { have: bigint; need: bigint } | null

  // ---- Phase 4 (S5) --------------------------------------------------------------------------------------------
  /** Position, corridor, sell budget and idle balances at one block (Interfaces.sol; Executor.sol l.65, l.67, l.453, l.504-517; CorridorMath.sol l.67-75). */
  readPosition(app: LoadedConfig, statics: DeploymentStatic, vaultId: string): Promise<PositionView>
  /** /agent/vaults row (agent/src/main.rs l.1029-1034, agent/src/vaults.rs l.215-222), NEAR key list (lib.rs l.46, l.498-503) and the vault's agent (lib.rs l.539-557). */
  readAgent(app: LoadedConfig, vaultId: string): Promise<AgentFacts>
  /** Executor events and WETH/USDC transfers of the position address in one window of at most 10,000 blocks ending at `toBlock` (head when null) and starting no lower than `fromBlock`. */
  readActivity(app: LoadedConfig, positionAddress: Address, toBlock: bigint | null, fromBlock?: bigint): Promise<ActivityWindow>

  // ---- Phase 5 (S6) --------------------------------------------------------------------------------------------
  /** Debt now and `messageExpirySecs` ahead with the relayer's 1% headroom, idle balances, the owner's wallet USDC (relayer.py l.72, l.516-529; Morpho accrual). */
  readClosePlan(app: LoadedConfig, vaultId: string, owner: Address): Promise<ClosePlan>

  // ---- Phase 6 (§6) --------------------------------------------------------------------------------------------
  /**
   * The five live checks of the verification panel, each settled on its own: published manifest (help.manifest,
   * vault/src/attest.rs l.15-22), app-compose.json and the /agent/ index (agent/MEASUREMENT.md l.99; agent/src/serve.rs
   * l.105-114, l.142), /agent/vaults (agent/src/main.rs l.1029-1034), view_access_key_list (vault/src/lib.rs l.46,
   * l.498-503), view_account against the factory code hash (vault/factory/src/lib.rs l.152; scripts/reproduce-hash.sh l.122-125).
   */
  readVerification(app: LoadedConfig, vaultId: string): Promise<VerificationFacts>

  // ---- Phase 11 (§8a.1) ----------------------------------------------------------------------------------------
  /** Sandbox only: the user-run market crash. Absent on the live adapter. */
  readonly crash?: CrashControl
  /** Sandbox only: the user-run venue stress replay (docs/prd-sandbox-venue-stress.md). Absent on the live adapter. */
  readonly venue?: VenueControl
}

export type Adapters = { kind: AdapterKind; wallet: WalletAdapter; protocol: ProtocolAdapter }
