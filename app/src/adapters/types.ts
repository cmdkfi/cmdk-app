// Adapter interfaces (PRD §8a). Screens and components talk only to these;
// the live implementation wraps wagmi and protocol/*, the sandbox one is simulated.
import type { Address, Hex, TransactionReceipt } from 'viem'
import type { AppConfig, Vault, discoverVaults } from '../protocol/near.ts'
import type { RelayerHealth } from '../protocol/relayer.ts'
import type { CreateJob } from '../protocol/create-vault.ts'
import type { SetupJob } from '../protocol/vault-setup.ts'
import type { LivePosition } from '../protocol/positions.ts'
import type { ActivityEvent } from '../protocol/activity.ts'
import type { PendingTransaction } from '../protocol/transaction-recovery.ts'
import type { assertFreshOwnerIntent, readOwnerRecovery, unsubmittedOwnerExpired, verifyOwnerJob } from '../protocol/owner-recovery.ts'
import type { readNearSecurity } from '../protocol/near-security.ts'
import type { EvidenceFile, EvidenceIndex, readBootFile } from '../protocol/agent-evidence.ts'
import type { MarketQuote } from '../protocol/market-quote.ts'
import type { WalletFunding } from '../protocol/wallet-funding.ts'
import type { SetupFacts } from '../protocol/setup-facts.ts'
import type { AddChainParams } from '../flow/guided-config.ts'

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

/**
 * One-to-one mirror of the I/O functions in protocol/*, without the injectable fetcher.
 * Methods are added only when protocol code backs them.
 */
export interface ProtocolAdapter {
  readonly kind: AdapterKind
  loadConfig(): Promise<AppConfig>
  discoverVaults(config: AppConfig, owner: string): ReturnType<typeof discoverVaults>
  readRelayerHealth(config: AppConfig): Promise<RelayerHealth>
  startCreateVault(config: AppConfig, owner: string): Promise<string>
  readCreateJob(config: AppConfig, job: string): Promise<CreateJob>
  startSetupJob(config: AppConfig, vault: string, message: string, signature: string): Promise<string>
  readSetupJob(config: AppConfig, job: string): Promise<SetupJob>
  assertFreshOwnerIntent(config: AppConfig, vault: Vault, message: string): ReturnType<typeof assertFreshOwnerIntent>
  readOwnerRecovery(config: AppConfig, vault: Vault, record: PendingTransaction, nearHash: string): ReturnType<typeof readOwnerRecovery>
  verifyOwnerJob(config: AppConfig, vault: Vault, record: PendingTransaction, job: SetupJob): ReturnType<typeof verifyOwnerJob>
  unsubmittedOwnerExpired(config: AppConfig, vault: Vault, record: PendingTransaction): ReturnType<typeof unsubmittedOwnerExpired>
  readLivePosition(config: AppConfig, vaultId: string, expectedOwner: string): Promise<LivePosition>
  readActivity(config: AppConfig, vault: Vault, from: bigint, to: bigint): Promise<ActivityEvent[]>
  readNearSecurity(config: AppConfig, vault: Vault, agentKey?: string): ReturnType<typeof readNearSecurity>
  readEvidenceJson(url: string, signal: AbortSignal): Promise<unknown>
  readBootFile(base: string, index: EvidenceIndex, row: EvidenceFile, vault: Vault, signal: AbortSignal): ReturnType<typeof readBootFile>
  readMarketQuote(config: AppConfig, market: { id: Hex; executor: Address }, morpho: Address): Promise<MarketQuote>
  readWalletFunding(config: AppConfig, owner: Address, tokens: { weth: Address; gasPriceOracle: Address }, gasLimit: bigint, amount: bigint): Promise<WalletFunding>
  readAccountKind(config: AppConfig, address: Address): Promise<'plain' | 'delegated' | 'contract'>
  readSetupFacts(config: AppConfig, vaultId: string, owner: string, position: LivePosition): Promise<SetupFacts>
}

export type Adapters = { kind: AdapterKind; wallet: WalletAdapter; protocol: ProtocolAdapter }
