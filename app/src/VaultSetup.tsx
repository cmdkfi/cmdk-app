import { useEffect, useState } from 'react'
import { useAccount, usePublicClient, useSignMessage } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { loadConfig, viewNear, type AppConfig } from './near.ts'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { useDemo } from './DemoContext.tsx'
import { accountKind } from './wallet-utils.ts'
import { checkSetupSignature, readSetupJob, setupMessage, startSetupJob, type SetupJob, SetupError } from './vault-setup.ts'

type State = { kind: 'loading' | 'pending' | 'ready' | 'signing' | 'working' | 'done' | 'failed' | 'uncertain'; message: string }
type VaultState = { owner: string; owner_nonce: number | string }
const stages = ['accepted', 'vault_checked', 'base_sent', 'done'] as const
const labels = ['Wallet signed', 'Vault checked on NEAR', 'Sent on Base', 'Setup complete']

export function VaultSetup() {
  const { address, isConnected } = useAccount()
  const { selected, refresh } = useVaultSelection()
  const { state: demo } = useDemo()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const { signMessageAsync } = useSignMessage()
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
          if (receipts.length !== 5 || receipts.some(item => item.status !== 1)) setState({ kind: 'uncertain', message: 'The relayer marked setup done, but five successful Base receipts were not confirmed. Check your vault.' })
          else { setState({ kind: 'done', message: 'Vault setup completed on both markets. The agent can register after it detects this version.' }); refresh() }
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
    setState({ kind: 'signing', message: 'Checking the vault owner, nonce and wallet account…' })
    try {
      const code = await client.getCode({ address })
      if (!['plain', 'delegated'].includes(accountKind(code))) throw new SetupError('This wallet cannot sign owner actions. Connect an EOA.')
      const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase()) throw new SetupError('The connected wallet is not this vault owner.')
      if (vault.owner_nonce !== 0 && vault.owner_nonce !== '0') throw new SetupError('This vault already has owner actions or its nonce is unavailable. Refresh its current setup before signing again.')
      const now = await client.getBlock().then(block => Number(block.timestamp)).catch(() => Math.floor(Date.now() / 1000))
      const text = setupMessage(selected.accountId, 1, now + 600, config, demo.rules)
      setState({ kind: 'signing', message: 'Review and sign the exact setup message in your wallet.' })
      const signature = await signMessageAsync({ message: text })
      await checkSetupSignature(text, signature, address)
      setState({ kind: 'working', message: 'Submitting the signed setup once…' })
      const id = await startSetupJob(config, selected.accountId, text, signature)
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
    <div className="card__header"><div><h2 id="setup-heading">Set up your testnet vault</h2><p>One owner signature approves the executor, sets the corridor on both markets and approves this agent version.</p></div></div>
    <p className="create-job__status" role="status">{state.message}</p>
    {selected && <p className="setup-live__detail">Vault: {selected.accountId}</p>}
    {config?.agent.measurement && <><p className="setup-live__detail">Agent fingerprint: <code>{config.agent.measurement.mrtd.slice(0, 12)}…{config.agent.measurement.mrtd.slice(-8)}</code></p><p className="setup-live__detail">Version: {config.agent.version ?? 'Published measurement'} · Source commit: {config.agent.sourceCommit ?? 'Not published'}</p></>}
    {review && <div className="setup-live__review"><h3>Review before signing</h3><p>On both Morpho markets: Floor {demo.rules.floor}%, Target {demo.rules.target}%, Agent acts {demo.rules.act}%, daily sell budget {demo.rules.budget}%. Move to backup: {demo.rules.migrate ? 'allowed' : 'off'}. Exit: {demo.rules.exit ? 'allowed' : 'off'}.</p><p>Approves USDC and WETH allowances and authorizes the executor. The approved agent version may register its limited key. Nothing leaves your position address. The message expires in 10 minutes.</p><p><a href="https://github.com/cmdkfi/app/blob/main/agent/MEASUREMENT.md" target="_blank" rel="noreferrer">How to compare the agent measurement ↗</a></p></div>}
    {jobId && <div className="create-job__progress" aria-label="Setup progress">{labels.map((label, step) => <div key={label} className={step <= index ? 'is-reached' : ''}><span aria-hidden="true">{step < index || job?.stage === 'done' ? '✓' : step + 1}</span>{label}</div>)}</div>}
    {job?.near_tx && <p className="setup-live__detail"><a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(job.near_tx)}`} target="_blank" rel="noreferrer">View NEAR transaction ↗</a></p>}
    {job?.base_sent?.map(hash => <p className="setup-live__detail" key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction {hash.slice(0, 12)}… ↗</a></p>)}
    <div className="card-actions">{!review ? <button className="button button--secondary" onClick={() => setReview(true)}>Review setup</button> : <button className="button" disabled={state.kind !== 'ready'} onClick={() => void signAndSubmit()}>Sign vault setup <span aria-hidden="true">→</span></button>}<a className="button button--secondary" href="#connect">View my vaults <span aria-hidden="true">→</span></a></div>
    <p className="explain">The saved local demo rules are the values shown for review. A live signature is available only after the published deployment and agent measurement are loaded.</p>
  </section>
}
