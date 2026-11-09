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
}

export type Adapters = { kind: AdapterKind; wallet: WalletAdapter; protocol: ProtocolAdapter }
