// Adapter interfaces (PRD §8a). Screens, components and flow talk only to these; the live implementation is the
// only consumer of protocol/, the sandbox one is simulated (Phase 6b).
import type { Address, Hex, TransactionReceipt } from 'viem'
import type { AccountKind } from '../flow/account.ts'
import type { AddChainParams, LoadedConfig } from '../flow/config.ts'

export type AdapterKind = 'live' | 'sandbox'

export type WalletState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; address: Address; chainId: number }

export interface WalletAdapter {
  readonly kind: AdapterKind
  /** Stable snapshot for useSyncExternalStore. */
  getState(): WalletState
  subscribe(listener: () => void): () => void
  /** MetaMask is present: an EIP-6963 provider announced as io.metamask, or window.ethereum.isMetaMask. */
  hasMetaMask(): boolean
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Switches to Base Sepolia; MetaMask's 4902 answer adds the network with exactly these values. */
  switchToBaseSepolia(network: AddChainParams): Promise<void>
  signMessage(message: string): Promise<Hex>
  sendTransaction(tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex>
  waitForTransaction(hash: Hex, confirmations: number): Promise<TransactionReceipt>
  dispose(): void
}

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
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  markets: { id: Hex; collateral: bigint; debt: bigint }[]
  setup: unknown
}

export type OwnerIntent =
  | { method: 'setup' }
  | { method: 'open'; collateralIn: bigint; targetLtv: bigint }
  | { method: 'withdraw'; amount: bigint; destination: Address }

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
export type WalletTxIntent = { kind: 'wrap'; amount: bigint } | { kind: 'transfer'; to: Address; amount: bigint } | { kind: 'topUp'; to: Address; amount: bigint }
export type AgentRegistration = { state: 'registered' | 'registering' | 'unavailable' }

/** Only what the screens use; methods are added when a screen needs them. */
export interface ProtocolAdapter {
  readonly kind: AdapterKind
  loadConfig(): Promise<LoadedConfig>
  readMarketQuote(app: LoadedConfig): Promise<MarketQuote>
  /** Pure: value, borrow at the configured target and the liquidity cap for a deposit amount (no I/O). */
  estimateDeposit(app: LoadedConfig, quote: MarketQuote, amountWei: bigint): DepositEstimate
  readWalletFunding(app: LoadedConfig, owner: Address, amountWei: bigint): Promise<WalletFunding>
  readAccountKind(app: LoadedConfig, address: Address): Promise<AccountKind>
  /** D4: the owner's newest vault numbered from firstVaultNumber, or null; throws when that cannot be known. */
  discoverPosition(app: LoadedConfig, owner: Address): Promise<PositionSummary | null>
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
  /** Agent registered and active on the vault, with exactly the restricted key (agent/src/main.rs l.1033; lib.rs l.46, l.498-503). */
  readAgentRegistration(app: LoadedConfig, vaultId: string): Promise<AgentRegistration>
}

export type Adapters = { kind: AdapterKind; wallet: WalletAdapter; protocol: ProtocolAdapter }
