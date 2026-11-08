import { isAddress, recoverMessageAddress } from 'viem'
import type { AgentMeasurement, AppConfig } from './near.ts'
import {validInitialRules,type InitialRules} from './initial-rules.ts'

export type SetupJob = { ok: boolean; job: string; kind: 'owner_call'; stage: 'accepted' | 'vault_checked' | 'base_sent' | 'done' | 'failed'; vault: string; near_tx?: string; base_sent?: string[]; signed?: { hash: string; nonce: number; from: string }[]; receipts?: { hash: string; status: number }[]; error?: string; http_status?: number }
export class SetupError extends Error {
  readonly uncertain: boolean
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain }
}

const secp256k1HalfOrder = BigInt('0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0')
const fraction = (percent: number) => (BigInt(Math.round(percent * 10)) * 10n ** 15n).toString()

export function setupArgs(config: AppConfig, rules: InitialRules) {
  if (!validInitialRules(rules) || !config.createVault || config.createVault.markets.length !== 2 || !config.agent.measurement) {
    throw new SetupError('The rules, two markets, or approved agent measurement are not ready.')
  }
  const corridor = { target: fraction(rules.target), act: fraction(rules.act), floor: fraction(rules.floor), sell_budget: fraction(rules.budget), migrate_allowed: rules.migrate, exit_allowed: rules.exit }
  return { markets: config.createVault.markets.map((item, index) => ({ market: item.id, approve: index === 0, authorize: index === 0, corridor })), measurement: config.agent.measurement }
}

export function setupMessage(vault: string, nonce: number, expiry: number, config: AppConfig, rules: InitialRules): string {
  if (!config.near.factory || !/^v[1-9][0-9]*$/.test(vault.split('.')[0]) || vault.slice(vault.indexOf('.') + 1) !== config.near.factory) throw new SetupError('Select a vault from the published factory.')
  if (!Number.isSafeInteger(nonce) || nonce < 1 || !Number.isSafeInteger(expiry)) throw new SetupError('Invalid nonce or expiry.')
  return JSON.stringify({ protocol: 'cmdk-vault/1', network: 'testnet', vault, method: 'setup', args: setupArgs(config, rules), nonce, expiry })
}

export async function checkSetupSignature(message: string, signature: string, owner: string): Promise<void> {
  if (!isAddress(owner) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new SetupError('The wallet returned an invalid owner signature.')
  const s = BigInt(`0x${signature.slice(66, 130)}`)
  if (s > secp256k1HalfOrder) throw new SetupError('The wallet signature has a high-s value and cannot be accepted.')
  const signer = await recoverMessageAddress({ message, signature: signature as `0x${string}` })
  if (signer.toLowerCase() !== owner.toLowerCase()) throw new SetupError('The signature does not match this vault owner.')
}

export async function startSetupJob(config: AppConfig, vault: string, message: string, signature: string, fetcher: typeof fetch = fetch): Promise<string> {
  let response: Response
  try {
    response = await fetcher(`${config.relayerUrl}/owner-call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vault, message, signature }) })
  } catch { throw new SetupError('The relayer did not confirm whether setup started. Check your vault before signing again.', true) }
  if (response.status !== 202) {
    const body: unknown = await response.json().catch(() => null)
    throw new SetupError(typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : `Setup returned HTTP ${response.status}.`)
  }
  const body: unknown = await response.json().catch(() => null)
  const job = (body as { ok?: unknown; job?: unknown } | null)?.job
  if ((body as { ok?: unknown } | null)?.ok !== true || typeof job !== 'string' || !/^[0-9a-f]{16}$/.test(job)) throw new SetupError('Setup may have started, but its job ID is missing. Check your vault before signing again.', true)
  return job
}

export async function readSetupJob(config: AppConfig, job: string, fetcher: typeof fetch = fetch): Promise<SetupJob> {
  if (!/^[0-9a-f]{16}$/.test(job)) throw new SetupError('Invalid setup job ID.', true)
  let response: Response
  try { response = await fetcher(`${config.relayerUrl}/job/${job}`, { cache: 'no-store' }) }
  catch { response = await fetcher(`${config.relayerUrlFallback}/job/${job}`, { cache: 'no-store' }) }
  if (response.status === 404) throw new SetupError('The relayer lost the job record. Check your vault and Base transactions before signing again.', true)
  if (!response.ok) throw new SetupError(`Setup status returned HTTP ${response.status}.`, true)
  const data: unknown = await response.json()
  const value = data as Partial<SetupJob> | null
  if (!value || value.job !== job || value.kind !== 'owner_call' || !['accepted', 'vault_checked', 'base_sent', 'done', 'failed'].includes(value.stage ?? '')) throw new SetupError('The relayer returned an unexpected setup job.', true)
  return value as SetupJob
}

export function hasMeasurement(value: AgentMeasurement | null): value is AgentMeasurement { return value !== null }

export function repairSetupArgs(config: AppConfig, rules: InitialRules, facts: {id:string;executor:string;loanToken:string;collateralToken:string;authorized:boolean;needsApproval:boolean;corridorSet:boolean;liquidationLtv?:bigint;corridor?:{target:string;act:string;floor:string;sell_budget:string;migrate_allowed:boolean;exit_allowed:boolean}}[], measurementMatches:boolean) {
  const initial=setupArgs(config,rules)
  const authorizations=new Set<string>(), approvals=new Set<string>()
  const markets=facts.map(fact=>{
    const executor=fact.executor.toLowerCase()
    const authorize=!fact.authorized&&!authorizations.has(executor)
    if(authorize)authorizations.add(executor)
    const tokens=[fact.loanToken,fact.collateralToken].map(token=>`${executor}:${token.toLowerCase()}`)
    const approve=fact.needsApproval&&tokens.some(token=>!approvals.has(token))
    if(approve)tokens.forEach(token=>approvals.add(token))
    const corridor=fact.corridorSet?null:fact.corridor??initial.markets[0].corridor
    if(corridor&&fact.liquidationLtv!==undefined&&BigInt(corridor.act)>=fact.liquidationLtv)throw new SetupError('Initial trigger must be below the actual market liquidation threshold.')
    return {market:fact.id,approve,authorize,corridor}
  })
  if(measurementMatches&&markets.every(m=>!m.approve&&!m.authorize&&!m.corridor))throw new SetupError('Setup is already complete. No unchanged rules need to be saved.')
  return {markets,measurement:measurementMatches?null:initial.measurement}
}
