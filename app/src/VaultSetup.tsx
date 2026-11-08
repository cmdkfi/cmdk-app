import { useEffect, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSignMessage } from 'wagmi'
import {parseAbi} from 'viem'
import { baseSepolia } from 'wagmi/chains'
import { loadConfig, viewNear, type AppConfig } from './near.ts'
import {readLivePosition} from './positions.ts'
import type { Vault } from './near.ts'
import { accountKind } from './wallet-utils.ts'
import { checkSetupSignature, readSetupJob, setupMessage, repairSetupArgs, startSetupJob, type SetupJob, SetupError } from './vault-setup.ts'

type State = { kind: 'loading' | 'pending' | 'ready' | 'signing' | 'working' | 'done' | 'failed' | 'uncertain'; message: string }
type VaultState = { owner: string; owner_nonce: number | string; approved?:Record<string,string>;markets?:{id:string;corridor_set:boolean}[] }
const stages = ['accepted', 'vault_checked', 'base_sent', 'done'] as const
const labels = ['Wallet signed', 'Vault checked on NEAR', 'Sent on Base', 'Setup complete']

export function VaultSetup({ vault: selected, onComplete }: { vault: Vault; onComplete: () => void }) {
  const { address, isConnected } = useAccount()
  // Initial values apply only to corridors that have not been configured.
  const rules = { floor: 30, target: 50, act: 70, budget: 20, migrate: true, exit: true }
  const client = usePublicClient({ chainId: baseSepolia.id })
  const { signMessageAsync } = useSignMessage()
  const session=useRef('');session.current=`${selected.accountId}:${address}`
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading', message: 'Checking setup requirements…' })
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<SetupJob | null>(null)
  const [review, setReview] = useState(false)
  const key = config?.near.factory && selected && address ? `cmdk-setup:${selected.accountId}:${address.toLowerCase()}` : null

  useEffect(() => {
    let active = true
    setState({ kind: 'loading', message: 'Checking setup requirements…' })
    loadConfig().then(config => {
      if (!active) return
      setConfig(config)
      if (!config.near.factory || !config.agent.measurement || !config.createVault) {
        setState({ kind: 'pending', message: 'Setup is waiting for the published factory, two markets and complete agent measurement.' })
        return
      }
      if (!isConnected || !address || !selected) {
        setState({ kind: 'pending', message: 'Connect the owner wallet and select its newly created vault.' })
        return
      }
      const saved = sessionStorage.getItem(`cmdk-setup:${selected.accountId}:${address.toLowerCase()}`)
      if (saved === 'uncertain') setState({ kind: 'uncertain', message: 'A previous setup request was not confirmed. Check the vault and Base transactions before signing again.' })
      else if (saved) { setJobId(saved); setState({ kind: 'working', message: 'Checking the previous setup job…' }) }
      else setState({ kind: 'ready', message: 'Review the two-market setup before asking your wallet to sign.' })
    }).catch(error => { if (active) setState({ kind: 'failed', message: error instanceof Error ? error.message : 'Could not load setup configuration.' }) })
    return () => { active = false }
  }, [address, isConnected, selected?.accountId])

  useEffect(() => {
    if (!config || !jobId || job?.stage === 'done' || job?.stage === 'failed' || state.kind === 'uncertain') return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await readSetupJob(config, jobId)
        if (!active) return
        setJob(next)
        if (next.stage === 'done') {
          const receipts = next.receipts ?? []
          if (next.vault !== selected.accountId || !next.near_tx || !next.signed || receipts.length !== next.signed.length || receipts.some(item => item.status !== 1) || next.signed.some(tx=>!receipts.some(receipt=>receipt.hash.toLowerCase()===tx.hash.toLowerCase()))) setState({ kind: 'uncertain', message: 'The relayer marked setup done, but all planned Base receipts were not confirmed. Check your vault.' })
          else {
            if(!client)throw new SetupError('Base confirmation client unavailable.',true)
            for(const tx of next.signed){const receipt=await client.waitForTransactionReceipt({hash:tx.hash as `0x${string}`,confirmations:2});if(receipt.status!=='success')throw new SetupError('A setup transaction reverted.',true)}
            const confirmed=await readLivePosition(config,selected.accountId,selected.owner)
            if(confirmed.errors?.length||confirmed.markets.some(m=>m.agentTrigger===null))throw new SetupError('Setup state is incomplete. Inspect the vault before retrying.',true)
            if(!active)return
            if(key)sessionStorage.removeItem(key);localStorage.removeItem(`cmdk-live-action:${selected.accountId}:${address}`); setState({ kind: 'done', message: 'Vault setup completed on both markets. The agent can register after it detects this version.' }); onComplete() }
        } else if (next.stage === 'failed') setState({ kind: next.http_status === 502 || next.base_sent?.length ? 'uncertain' : 'failed', message: next.error || 'Setup failed. Check the vault and transaction links before signing again.' })
        else { setState({ kind: 'working', message: 'The relayer is processing the owner-signed setup.' }); timer = window.setTimeout(poll, 1000) }
      } catch (error) {
        if (!active) return
        if (error instanceof SetupError && error.uncertain) setState({ kind: 'uncertain', message: error.message })
        else { setState({ kind: 'working', message: 'Status temporarily unavailable. Checking again…' }); timer = window.setTimeout(poll, 1000) }
      }
    }
    void poll()
    return () => { active = false; window.clearTimeout(timer) }
  }, [config, jobId, job?.stage, state.kind])

  async function signAndSubmit() {
    if (!config || !selected || !address || !client || !key || !config.agent.measurement || state.kind !== 'ready') return
    const expected=session.current
    setState({ kind: 'signing', message: 'Checking the vault owner, nonce and wallet account…' })
    try {
      const code = await client.getCode({ address })
      if (!['plain', 'delegated'].includes(accountKind(code))) throw new SetupError('This wallet cannot sign owner actions. Connect an EOA.')
      const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase()) throw new SetupError('The connected wallet is not this vault owner.')
      const nonce=Number(vault.owner_nonce)+1
      if(!Number.isSafeInteger(nonce)||nonce<1)throw new SetupError('Owner nonce unavailable.')
      const lock=`cmdk-live-action:${selected.accountId}:${address}`
      if(localStorage.getItem(lock))throw new SetupError('Another vault action is pending. Reconcile it first.')
      const position=await readLivePosition(config,selected.accountId,address)
      if(position.errors?.length||position.markets.length!==config.createVault?.markets.length||position.markets.some(m=>m.readOnly||m.policyUnavailable))throw new SetupError('Read all registered markets and verify the deployment before repair.')
      const permissionAbi=parseAbi(['function allowance(address,address) view returns(uint256)','function isAuthorized(address,address) view returns(bool)'])
      const facts=await Promise.all(position.markets.map(async m=>{const [authorized,loan,collateral]=await Promise.all([client.readContract({address:m.morpho!,abi:permissionAbi,functionName:'isAuthorized',args:[position.baseAddress,m.executor!]}),client.readContract({address:m.loanToken,abi:permissionAbi,functionName:'allowance',args:[position.baseAddress,m.executor!]}),client.readContract({address:m.collateralToken,abi:permissionAbi,functionName:'allowance',args:[position.baseAddress,m.executor!]})]);return{id:m.id,executor:m.executor!,loanToken:m.loanToken,collateralToken:m.collateralToken,authorized,needsApproval:loan===0n||collateral===0n,corridorSet:m.agentTrigger!==null&&vault.markets?.find(item=>item.id.toLowerCase()===m.id.toLowerCase())?.corridor_set===true,corridor:m.agentTarget!==null&&m.agentTrigger!==null&&m.floor!=null&&m.dailyBudget!=null?{target:m.agentTarget.toString(),act:m.agentTrigger.toString(),floor:m.floor.toString(),sell_budget:m.dailyBudget.toString(),migrate_allowed:!!m.migrateAllowed,exit_allowed:!!m.exitAllowed}:undefined}}))
      const args=repairSetupArgs(config,rules,facts,!!vault.approved&&Object.entries(config.agent.measurement).every(([k,v])=>vault.approved![k]===v))
      const now = await client.getBlock().then(block => Number(block.timestamp)).catch(() => Math.floor(Date.now() / 1000))
      const expiry=now+600
      const initial=JSON.parse(setupMessage(selected.accountId,nonce,expiry,config,rules))
      const text=JSON.stringify({...initial,args})
      setState({ kind: 'signing', message: 'Review and sign the exact setup message in your wallet.' })
      const signature = await signMessageAsync({ message: text })
      await checkSetupSignature(text, signature, address)
      if(!mounted.current||session.current!==expected)throw new SetupError('Wallet or vault changed. Reopen setup.')
      setState({ kind: 'working', message: 'Submitting the signed setup once…' })
      if(localStorage.getItem(lock))throw new SetupError('Another vault action started.')
      localStorage.setItem(lock,JSON.stringify({pending:true,kind:'owner',operation:'setup',ownerNonce:String(nonce),expiry,startedAt:Date.now()}))
      const id = await startSetupJob(config, selected.accountId, text, signature)
      localStorage.setItem(lock,JSON.stringify({...JSON.parse(localStorage.getItem(lock)??'{}'),job:id}))
      sessionStorage.setItem(key, id)
      setJobId(id)
    } catch (error) {
      const problem = error instanceof SetupError ? error : new SetupError(error instanceof Error ? error.message : 'Wallet signing was cancelled or failed.')
      if (problem.uncertain) sessionStorage.setItem(key, 'uncertain')
      setState({ kind: problem.uncertain ? 'uncertain' : 'ready', message: problem.message })
    }
  }

  const index = stages.indexOf(job?.stage as typeof stages[number])
  return <section className="card setup-live" aria-labelledby="setup-heading">
    <div className="card__header"><div><h2 id="setup-heading">Set up your testnet vault</h2><p>Repair missing token allowances, Morpho authorization, corridors and measurement approval. Existing rules are preserved; no unchanged corridor is rewritten.</p></div></div>
    <p className="create-job__status" role="status">{state.message}</p>
    {selected && <p className="setup-live__detail">Vault: {selected.accountId}</p>}
    {config?.agent.measurement && <><p className="setup-live__detail">Agent fingerprint: <code>{config.agent.measurement.mrtd.slice(0, 12)}…{config.agent.measurement.mrtd.slice(-8)}</code></p><p className="setup-live__detail">Version: {config.agent.version ?? 'Published measurement'} · Source commit: {config.agent.sourceCommit ?? 'Not published'}</p></>}
    {config?.createVault && <p className="setup-live__detail">Executor: {config.createVault.markets[0]?.executor}</p>}
    {review && <div className="setup-live__review"><h3>Review before signing</h3><p>Only for unconfigured markets: Floor {rules.floor}%, Target {rules.target}%, Agent acts {rules.act}%, daily sell budget {rules.budget}%. Move to backup: {rules.migrate ? 'allowed' : 'off'}. Exit: {rules.exit ? 'allowed' : 'off'}.</p><p>Grants unlimited USDC and WETH allowances from the vault to its registered Executor and authorizes that Executor on Morpho. The approved agent version may register its limited key. Nothing leaves your position address. The message expires in 10 minutes.</p><p><a href="https://github.com/cmdkfi/app/blob/main/agent/MEASUREMENT.md" target="_blank" rel="noreferrer">How to compare the agent measurement ↗</a></p></div>}
    {jobId && <div className="create-job__progress" aria-label="Setup progress">{labels.map((label, step) => <div key={label} className={step <= index ? 'is-reached' : ''}><span aria-hidden="true">{step < index || job?.stage === 'done' ? '✓' : step + 1}</span>{label}</div>)}</div>}
    {job?.near_tx && <p className="setup-live__detail"><a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(job.near_tx)}`} target="_blank" rel="noreferrer">View NEAR transaction ↗</a></p>}
    {job?.base_sent?.map(hash => <p className="setup-live__detail" key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction {hash.slice(0, 12)}… ↗</a></p>)}
    <div className="card-actions">{!review ? <button className="button button--secondary" onClick={() => setReview(true)}>Review setup</button> : <button className="button" disabled={state.kind !== 'ready'} onClick={() => void signAndSubmit()}>Sign vault setup <span aria-hidden="true">→</span></button>}<a className="button button--secondary" href="#connect">View my vaults <span aria-hidden="true">→</span></a></div>
    <p className="explain">These initial rules match the protocol setup policy. They are not stored on-chain until you sign and setup confirms.</p>
  </section>
}
