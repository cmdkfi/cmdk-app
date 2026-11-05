import { useEffect, useRef, useState } from 'react'
import { isAddress, type Address, type Hex } from 'viem'
import { useAccount, usePublicClient, useSignMessage } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { validRules, type DemoRules } from './demo.ts'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { loadConfig, viewNear, type AppConfig } from './near.ts'
import { corridorFromChain, corridorMessage } from './live-corridor.ts'
import { checkSetupSignature, readSetupJob, startSetupJob, SetupError, type SetupJob } from './vault-setup.ts'
import { accountKind } from './wallet-utils.ts'

type VaultState = { owner?: string; owner_nonce?: number | string; base_address?: string; markets?: { id?: string; executor?: string; corridor_set?: boolean }[] }
type Data = { config: AppConfig; position: Address; market: Hex; executor: Address; stored: DemoRules }
const corridorAbi = [{ type: 'function', name: 'corridors', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bool' }, { type: 'bool' }, { type: 'bool' }] }] as const
const setCorridorAbi = [{ type: 'function', name: 'setCorridor', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'tuple', components: [{ name: 'target', type: 'uint64' }, { name: 'act', type: 'uint64' }, { name: 'floor', type: 'uint64' }, { name: 'sellBudget', type: 'uint64' }, { name: 'migrateAllowed', type: 'bool' }, { name: 'exitAllowed', type: 'bool' }, { name: 'set', type: 'bool' }] }, { type: 'uint256' }], outputs: [] }] as const
const initial: DemoRules = { floor: 30, target: 50, act: 70, budget: 20, migrate: false, exit: false }

export function LiveCorridor() {
  const { address } = useAccount()
  const { selected } = useVaultSelection()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const { signMessageAsync } = useSignMessage()
  const [index, setIndex] = useState(0)
  const [data, setData] = useState<Data | null>(null)
  const [rules, setRules] = useState<DemoRules>(initial)
  const [status, setStatus] = useState('Reading the stored corridor…')
  const [ready, setReady] = useState(false)
  const [review, setReview] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<SetupJob | null>(null)
  const requestId = useRef(0)
  const [signing, setSigning] = useState(false)
  const savedKey = selected && address ? `cmdk-corridor:${selected.accountId}:${address.toLowerCase()}:${index}` : null

  async function refresh() {
    const currentRequest = ++requestId.current
    setReady(false)
    if (!selected || !address || !client) { setData(null); setStatus('Connect your owner wallet and select a vault first.'); return }
    try {
      const config = await loadConfig()
      const market = config.createVault?.markets[index]
      if (!config.near.factory || !market || !selected.baseAddress || !isAddress(selected.baseAddress) || !isAddress(market.executor)) throw new SetupError('The published market or position is unavailable.')
      const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase() || vault.base_address?.toLowerCase() !== selected.baseAddress.toLowerCase()) throw new SetupError('The selected vault owner or position changed.')
      const active = vault.markets?.find(item => item.id?.toLowerCase() === market.id.toLowerCase())
      if (!active?.corridor_set || active.executor?.toLowerCase() !== market.executor.toLowerCase()) throw new SetupError('This vault has no approved corridor for the selected market.')
      const position = selected.baseAddress as Address
      const executor = market.executor as Address
      const marketId = market.id as Hex
      const stored = corridorFromChain(await client.readContract({ address: executor, abi: corridorAbi, functionName: 'corridors', args: [position, marketId] }))
      if (currentRequest !== requestId.current) return
      setData({ config, position, executor, market: marketId, stored }); setRules(stored)
      if (savedKey && sessionStorage.getItem(savedKey) === 'uncertain') setStatus('A previous change has an uncertain outcome. Check the vault and Base transactions before signing again.')
      else { setStatus('Current rules loaded from Base Sepolia.'); setReady(true) }
    } catch (error) { if (currentRequest === requestId.current) { setData(null); setStatus(error instanceof Error ? error.message : 'Could not read the corridor.') } }
  }
  useEffect(() => { setData(null); setReview(false); setJob(null); setJobId(null); void refresh() }, [address, selected?.accountId, client, index])
  useEffect(() => {
    if (!savedKey) return
    const saved = sessionStorage.getItem(savedKey)
    if (saved && /^[0-9a-f]{16}$/.test(saved)) setJobId(saved)
  }, [savedKey])
  useEffect(() => {
    if (!data || !jobId || job?.stage === 'done' || job?.stage === 'failed') return
    let active = true
    let timer: number | undefined
    async function poll() {
      try {
        const next = await readSetupJob(data!.config, jobId!)
        if (!active) return
        setJob(next)
        if (next.stage === 'done') { setStatus('Rule change completed. Refresh to confirm the stored values.'); await refresh() }
        else if (next.stage === 'failed') setStatus(next.error ?? 'Rule change failed. Check the linked transactions.')
        else { setStatus('The relayer is applying the rule change.'); timer = window.setTimeout(poll, 1000) }
      } catch (error) { if (active) setStatus(error instanceof Error ? error.message : 'Rule change status is uncertain.') }
    }
    void poll()
    return () => { active = false; window.clearTimeout(timer) }
  }, [data, jobId, job?.stage])

  const changed = !!data && JSON.stringify(rules) !== JSON.stringify(data.stored)
  const canReview = ready && !!data && changed && validRules(rules) && !jobId
  async function sign() {
    if (!canReview || !data || !address || !selected || !client || !savedKey) return
    setReady(false); setSigning(true); setStatus('Checking the latest vault and stored rules…')
    try {
      if (!['plain', 'delegated'].includes(accountKind(await client.getCode({ address })))) throw new SetupError('Connect an EOA to sign owner actions.')
      const vault = await viewNear<VaultState>(data.config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase() || vault.base_address?.toLowerCase() !== data.position.toLowerCase()) throw new SetupError('The vault owner or position changed. Refresh before signing.')
      const active = vault.markets?.find(item => item.id?.toLowerCase() === data.market.toLowerCase())
      if (!active?.corridor_set || active.executor?.toLowerCase() !== data.executor.toLowerCase()) throw new SetupError('The market executor changed. Refresh before signing.')
      const current = corridorFromChain(await client.readContract({ address: data.executor, abi: corridorAbi, functionName: 'corridors', args: [data.position, data.market] }))
      if (JSON.stringify(current) !== JSON.stringify(data.stored)) throw new SetupError('The stored corridor changed. Refresh before signing.')
      const nonce = Number(vault.owner_nonce)
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new SetupError('The owner nonce is unavailable.')
      const expiry = Number((await client.getBlock()).timestamp) + 600
      const message = corridorMessage(selected.accountId, nonce + 1, expiry, data.config, data.market, rules)
      const args = JSON.parse(message).args as { target: string; act: string; floor: string; sell_budget: string }
      await client.simulateContract({ account: data.position, address: data.executor, abi: setCorridorAbi, functionName: 'setCorridor', args: [data.market, { target: BigInt(args.target), act: BigInt(args.act), floor: BigInt(args.floor), sellBudget: BigInt(args.sell_budget), migrateAllowed: rules.migrate, exitAllowed: rules.exit, set: false }, BigInt(expiry)] })
      setStatus('Review all six rule values in your wallet.')
      const signature = await signMessageAsync({ message })
      await checkSetupSignature(message, signature, address)
      setStatus('Submitting the signed rule change once…')
      const id = await startSetupJob(data.config, selected.accountId, message, signature)
      sessionStorage.setItem(savedKey, id); setJobId(id)
      setSigning(false)
    } catch (error) {
      const uncertain = error instanceof SetupError && error.uncertain
      if (uncertain) sessionStorage.setItem(savedKey, 'uncertain')
      setStatus(error instanceof Error ? error.message : 'Rule change was cancelled.')
      if (!uncertain) setReady(true)
      setSigning(false)
    }
  }
  function setNumber(key: 'floor' | 'target' | 'act' | 'budget', value: string) { setRules(previous => ({ ...previous, [key]: Number(value) })); setReview(false) }
  function setBool(key: 'migrate' | 'exit', value: boolean) { setRules(previous => ({ ...previous, [key]: value })); setReview(false) }

  return <section className="card setup-live" aria-labelledby="live-corridor-title">
    <div className="card__header"><div><h2 id="live-corridor-title">Rules on the selected vault</h2><p>Each market has its own corridor. Review one market at a time before signing.</p></div></div>
    <p className="create-job__status" role="status">{status}</p>
    {selected && <p className="setup-live__detail">Vault: {selected.accountId}</p>}
    <label className="deposit-live__field">Market<select className="live-corridor__select" value={index} disabled={signing} onChange={event => setIndex(Number(event.target.value))}><option value="0">Primary Morpho WETH / USDC</option><option value="1">Backup Morpho WETH / USDC</option></select></label>
    {data && <><div className="form-list">
      {([['floor', 'Floor'], ['target', 'Target'], ['act', 'Agent acts'], ['budget', 'Daily sell budget']] as const).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input type="number" min="0" max={key === 'budget' ? '100' : '85.9'} step="0.1" value={rules[key]} onChange={event => setNumber(key, event.target.value)} /><span>%</span></label>)}
      <label className="switch-row"><span>Move to backup market <small>At most two moves in 24 hours.</small></span><input type="checkbox" checked={rules.migrate} onChange={event => setBool('migrate', event.target.checked)} /></label>
      <label className="switch-row"><span>Exit when needed <small>The agent tries a move first.</small></span><input type="checkbox" checked={rules.exit} onChange={event => setBool('exit', event.target.checked)} /></label>
    </div>
      {!validRules(rules) && <p className="inline-error" role="alert">Use Floor &lt; Target &lt; Agent acts &lt; 86%, with a daily budget from 0 to 100%.</p>}
      {review && <div className="setup-live__review"><h3>Review rule change</h3><p>For market {data.market}: Floor {rules.floor}%, Target {rules.target}%, Agent acts {rules.act}%, daily budget {rules.budget}%, Migrate {rules.migrate ? 'on' : 'off'}, Exit {rules.exit ? 'on' : 'off'}. The other market keeps its rules. Signature expires in 10 minutes.</p></div>}
      <div className="card-actions"><button className="button" disabled={!canReview} onClick={() => review ? void sign() : setReview(true)}>{review ? 'Sign rule change' : 'Review rule change'} →</button><button className="button button--secondary" onClick={() => void refresh()}>Refresh rules</button></div>
    </>}
    {jobId && <p className="setup-live__detail">Job: <code>{jobId}</code> · {job?.stage ?? 'Checking'}</p>}
    {job?.near_tx && <p className="setup-live__detail"><a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(job.near_tx)}`} target="_blank" rel="noreferrer">View NEAR transaction ↗</a></p>}
    {job?.base_sent?.map(hash => <p className="setup-live__detail" key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">View Base transaction ↗</a></p>)}
    {job && (job.stage === 'done' || (job.stage === 'failed' && !job.base_sent?.length && job.http_status !== 502)) && <div className="card-actions"><button className="button button--secondary" onClick={() => { if (savedKey) sessionStorage.removeItem(savedKey); setJobId(null); setJob(null); setReview(false); void refresh() }}>Check another change</button></div>}
  </section>
}
