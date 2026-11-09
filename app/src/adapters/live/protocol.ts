import { discoverVaults, loadConfig } from '../../protocol/near.ts'
import { readRelayerHealth } from '../../protocol/relayer.ts'
import { readCreateJob, startCreateVault } from '../../protocol/create-vault.ts'
import { readSetupJob, startSetupJob } from '../../protocol/vault-setup.ts'
import { assertFreshOwnerIntent, readOwnerRecovery, unsubmittedOwnerExpired, verifyOwnerJob } from '../../protocol/owner-recovery.ts'
import { readLivePosition } from '../../protocol/positions.ts'
import { readActivity } from '../../protocol/activity.ts'
import { readNearSecurity } from '../../protocol/near-security.ts'
import { readBootFile, readEvidenceJson } from '../../protocol/agent-evidence.ts'
import { readMarketQuote } from '../../protocol/market-quote.ts'
import { readAccountKind, readWalletFunding } from '../../protocol/wallet-funding.ts'
import { readSetupFacts } from '../../protocol/setup-facts.ts'
import type { ProtocolAdapter } from '../types.ts'

// Thin pass-through to the unchanged protocol modules; no logic lives here.
export function createLiveProtocol(): ProtocolAdapter {
  return {
    kind: 'live',
    loadConfig: () => loadConfig(),
    discoverVaults: (config, owner) => discoverVaults(config, owner),
    readRelayerHealth: config => readRelayerHealth(config),
    startCreateVault: (config, owner) => startCreateVault(config, owner),
    readCreateJob: (config, job) => readCreateJob(config, job),
    startSetupJob: (config, vault, message, signature) => startSetupJob(config, vault, message, signature),
    readSetupJob: (config, job) => readSetupJob(config, job),
    assertFreshOwnerIntent: (config, vault, message) => assertFreshOwnerIntent(config, vault, message),
    readOwnerRecovery: (config, vault, record, nearHash) => readOwnerRecovery(config, vault, record, nearHash),
    verifyOwnerJob: (config, vault, record, job) => verifyOwnerJob(config, vault, record, job),
    unsubmittedOwnerExpired: (config, vault, record) => unsubmittedOwnerExpired(config, vault, record),
    readLivePosition: (config, vaultId, owner) => readLivePosition(config, vaultId, owner),
    readActivity: (config, vault, from, to) => readActivity(config, vault, from, to),
    readNearSecurity: (config, vault, agentKey) => readNearSecurity(config, vault, agentKey),
    readEvidenceJson: (url, signal) => readEvidenceJson(url, signal),
    readBootFile: (base, index, row, vault, signal) => readBootFile(base, index, row, vault, signal),
    readMarketQuote: (config, market, morpho) => readMarketQuote(config, market, morpho),
    readWalletFunding: (config, owner, tokens, gasLimit, amount) => readWalletFunding(config, owner, tokens, gasLimit, amount),
    readAccountKind: (config, address) => readAccountKind(config, address),
    readSetupFacts: (config, vaultId, owner, position) => readSetupFacts(config, vaultId, owner, position),
  }
}
