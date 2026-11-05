import { useEffect, useState } from 'react'
import { useAccount, usePublicClient, useSignMessage } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { loadConfig, viewNear, type AppConfig } from './near.ts'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { useDemo } from './DemoContext.tsx'
import { accountKind } from './wallet-utils.ts'
import { checkSetupSignature, readSetupJob, setupMessage, startSetupJob, type SetupJob, SetupError } from './vault-setup.ts'
import { approvalMessage, measurementMatches, readCurrentAgent, type CurrentAgent } from './measurement.ts'

type State = { kind: 'loading' | 'pending' | 'ready' | 'matched' | 'signing' | 'working' | 'done' | 'failed' | 'uncertain'; message: string }
type VaultState = { owner: string; owner_nonce: number | string; approved?: unknown }
type Mode = 'setup' | 'approve' | 'matched'
const setupStages = ['accepted', 'vault_checked', 'base_sent', 'done'] as const
const setupLabels = ['Wallet signed', 'Vault checked on NEAR', 'Sent on Base', 'Setup complete']
const approvalStages = ['accepted', 'vault_checked', 'done'] as const
const approvalLabels = ['Wallet signed', 'Vault checked on NEAR', 'Version approved']

export function VaultSetup() {
  const { address, isConnected } = useAccount()
  const { selected, refresh } = useVaultSelection()
  const { state: demo } = useDemo()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const { signMessageAsync } = useSignMessage()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [currentAgent, setCurrentAgent] = useState<CurrentAgent | null>(null)
  const [mode, setMode] = useState<Mode>('setup')
  const [state, setState] = useState<State>({ kind: 'loading', message: 'Checking setup requirements…' })
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<SetupJob | null>(null)
  const [review, setReview] = useState(false)
  const key = config?.near.factory && selected && address && currentAgent
    ? mode === 'approve' ? `cmdk-approve:${selected.accountId}:${address.toLowerCase()}:${currentAgent.measurement.compose_hash}` : `cmdk-setup:${selected.accountId}:${address.toLowerCase()}`
    : null

  useEffect(() => {
    let active = true
    setState({ kind: 'loading', message: 'Checking setup requirements…' })
    setJobId(null)
    setJob(null)
    setReview(false)
    loadConfig().then(async config => {
      if (!active) return
      setConfig(config)
      if (!config.near.factory || !config.createVault) {
        setState({ kind: 'pending', message: 'Setup is waiting for the published factory, two markets and complete agent measurement.' })
        return
      }
      const agent = await readCurrentAgent(config)
      if (!active) return
      setCurrentAgent(agent)
      if (!isConnected || !address || !selected) {
        setState({ kind: 'pending', message: 'Connect the owner wallet and select its newly created vault.' })
        return
      }
      const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
      if (!active) return
      if (vault.owner?.toLowerCase() !== address.toLowerCase()) throw new SetupError('The connected wallet is not this vault owner.')
      const nextMode: Mode = measurementMatches(vault.approved, agent.measurement) ? 'matched' : vault.approved == null && (vault.owner_nonce === 0 || vault.owner_nonce === '0') ? 'setup' : 'approve'
      setMode(nextMode)
      if (nextMode === 'matched') { setState({ kind: 'matched', message: 'This vault approved the current agent version. It can be watched once its agent key is registered.' }); return }
      const savedKey = nextMode === 'approve' ? `cmdk-approve:${selected.accountId}:${address.toLowerCase()}:${agent.measurement.compose_hash}` : `cmdk-setup:${selected.accountId}:${address.toLowerCase()}`
      const saved = sessionStorage.getItem(savedKey)
      if (saved === 'uncertain') setState({ kind: 'uncertain', message: 'A previous owner action was not confirmed. Check the vault state before signing again.' })
      else if (saved) { setJobId(saved); setState({ kind: 'working', message: 'Checking the previous owner action…' }) }
      else setState({ kind: 'ready', message: nextMode === 'approve' ? 'This vault approved an older agent image and is not watched. Review one owner-signed version update.' : 'Review the two-market setup before asking your wallet to sign.' })
    }).catch(error => { if (active) setState({ kind: 'failed', message: error instanceof Error ? error.message : 'Could not load setup configuration.' }) })
    return () => { active = false }
  }, [address, isConnected, selected?.accountId])

  useEffect(() => {
    if (!config || !selected || !jobId || job?.stage === 'done' || job?.stage === 'failed' || state.kind === 'uncertain') return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      let completed = false
      try {
        const next = await readSetupJob(config, jobId)
        if (!active) return
        setJob(next)
        if (next.stage === 'done') {
          completed = true
          const receipts = next.receipts ?? []
          if ((mode === 'setup' && (receipts.length !== 5 || receipts.some(item => item.status !== 1))) || (mode === 'approve' && receipts.length !== 0)) setState({ kind: 'uncertain', message: 'The relayer marked the job done, but its receipts do not match this owner action. Check your vault.' })
          else {
            const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
            if (!active) return
            const latest = await readCurrentAgent(config)
            if (!active) return
            if (!measurementMatches(vault.approved, latest.measurement)) setState({ kind: 'uncertain', message: 'The owner action finished, but the vault does not approve the latest agent image. Review its current status before signing again.' })
            else { setState({ kind: 'done', message: mode === 'approve' ? 'Current agent image approved. The agent can watch after it registers its key.' : 'Vault setup completed on both markets. The agent can register after it detects this version.' }); refresh() }
          }
        } else if (next.stage === 'failed') setState({ kind: next.http_status === 502 || next.base_sent?.length ? 'uncertain' : 'failed', message: next.error || 'Setup failed. Check the vault and transaction links before signing again.' })
        else { setState({ kind: 'working', message: 'The relayer is processing the owner-signed action.' }); timer = window.setTimeout(poll, 1000) }
      } catch (error) {
        if (!active) return
        if (completed) setState({ kind: 'uncertain', message: 'The owner action finished, but its approval could not be verified against the current vault and agent image. Refresh to check again.' })
        else if (error instanceof SetupError && error.uncertain) setState({ kind: 'uncertain', message: error.message })
        else { setState({ kind: 'working', message: 'Status temporarily unavailable. Checking again…' }); timer = window.setTimeout(poll, 1000) }
      }
    }
    void poll()
    return () => { active = false; window.clearTimeout(timer) }
  }, [config, jobId, job?.stage, state.kind, mode, selected?.accountId])

  async function signAndSubmit() {
    if (!config || !selected || !address || !client || !key || !currentAgent || state.kind !== 'ready') return
    setState({ kind: 'signing', message: 'Checking the vault owner, nonce and wallet account…' })
    try {
      const code = await client.getCode({ address })
      if (!['plain', 'delegated'].includes(accountKind(code))) throw new SetupError('This wallet cannot sign owner actions. Connect an EOA.')
      const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase()) throw new SetupError('The connected wallet is not this vault owner.')
      const freshAgent = await readCurrentAgent(config)
      if (!measurementMatches(freshAgent.measurement, currentAgent.measurement)) throw new SetupError('The agent image changed during review. Refresh and review the new fingerprint before signing.')
      const nonce = Number(vault.owner_nonce)
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new SetupError('The owner nonce is unavailable.')
      if (mode === 'setup' && nonce !== 0) throw new SetupError('This vault already has owner actions. Refresh to review its current agent approval.')
      if (mode === 'approve' && measurementMatches(vault.approved, freshAgent.measurement)) throw new SetupError('This vault already approved the current agent image. Refresh its status.')
      const now = await client.getBlock().then(block => Number(block.timestamp)).catch(() => Math.floor(Date.now() / 1000))
      const text = mode === 'approve'
        ? approvalMessage(selected.accountId, nonce + 1, now + 600, config, freshAgent.measurement)
        : setupMessage(selected.accountId, 1, now + 600, { ...config, agent: freshAgent }, demo.rules)
      setState({ kind: 'signing', message: `Review and sign the exact ${mode === 'approve' ? 'agent approval' : 'setup'} message in your wallet.` })
      const signature = await signMessageAsync({ message: text })
      await checkSetupSignature(text, signature, address)
      setState({ kind: 'working', message: 'Submitting the signed owner action once…' })
      const id = await startSetupJob(config, selected.accountId, text, signature)
      sessionStorage.setItem(key, id)
      setJobId(id)
    } catch (error) {
      const problem = error instanceof SetupError ? error : new SetupError(error instanceof Error ? error.message : 'Wallet signing was cancelled or failed.')
      if (problem.uncertain) sessionStorage.setItem(key, 'uncertain')
      setState({ kind: problem.uncertain ? 'uncertain' : 'ready', message: problem.message })
    }
  }

  const stages: readonly string[] = mode === 'approve' ? approvalStages : setupStages
  const labels = mode === 'approve' ? approvalLabels : setupLabels
  const index = stages.indexOf(job?.stage ?? '')
  return <section className="card setup-live" aria-labelledby="setup-heading">
    <div className="card__header"><div><h2 id="setup-heading">{mode === 'matched' ? 'Agent version is current' : mode === 'approve' ? 'Approve the current agent' : 'Set up your testnet vault'}</h2><p>{mode === 'matched' ? 'The vault approves the current image. Its registered agent key determines whether monitoring is active.' : mode === 'approve' ? 'The current agent image differs from this vault’s approval, so the vault is not watched. One owner signature updates the measurement; no Base transaction is sent.' : 'One owner signature approves the executor, sets the corridor on both markets and approves this agent version.'}</p></div></div>
    <p className="create-job__status" role="status">{state.message}</p>
    {selected && <p className="setup-live__detail">Vault: {selected.accountId}</p>}
    {currentAgent && <><p className="setup-live__detail">Current fingerprint: <code>{currentAgent.measurement.mrtd.slice(0, 12)}…{currentAgent.measurement.mrtd.slice(-8)}</code></p><p className="setup-live__detail">Version: {currentAgent.version ?? 'Published measurement'} · Source commit: {currentAgent.sourceCommit ?? 'Not published'}</p></>}
    {review && <div className="setup-live__review"><h3>Review before signing</h3>{mode === 'approve' ? <p>Approve the six current measurement values from the published deployment manifest. The vault is not watched while they differ. This owner action makes no Base transaction and expires in 10 minutes.</p> : <><p>On both Morpho markets: Floor {demo.rules.floor}%, Target {demo.rules.target}%, Agent acts {demo.rules.act}%, daily sell budget {demo.rules.budget}%. Move to backup: {demo.rules.migrate ? 'allowed' : 'off'}. Exit: {demo.rules.exit ? 'allowed' : 'off'}.</p><p>Approves USDC and WETH allowances and authorizes the executor. The approved agent version may register its limited key. Nothing leaves your position address. The message expires in 10 minutes.</p></>}<p><a href="https://github.com/cmdkfi/app/blob/main/agent/MEASUREMENT.md" target="_blank" rel="noreferrer">How to compare the agent measurement ↗</a></p></div>}
    {jobId && <div className="create-job__progress" aria-label={mode === 'approve' ? 'Approval progress' : 'Setup progress'}>{labels.map((label, step) => <div key={label} className={step <= index ? 'is-reached' : ''}><span aria-hidden="true">{step < index || job?.stage === 'done' ? '✓' : step + 1}</span>{label}</div>)}</div>}
    {job?.near_tx && <p className="setup-live__detail"><a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(job.near_tx)}`} target="_blank" rel="noreferrer">View NEAR transaction ↗</a></p>}
    {job?.base_sent?.map(hash => <p className="setup-live__detail" key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction {hash.slice(0, 12)}… ↗</a></p>)}
    <div className="card-actions">{state.kind !== 'matched' && (!review ? <button className="button button--secondary" disabled={state.kind !== 'ready'} onClick={() => setReview(true)}>Review {mode === 'approve' ? 'agent version' : 'setup'}</button> : <button className="button" disabled={state.kind !== 'ready'} onClick={() => void signAndSubmit()}>Sign {mode === 'approve' ? 'agent approval' : 'vault setup'} <span aria-hidden="true">→</span></button>)}<a className="button button--secondary" href="#connect">View my vaults <span aria-hidden="true">→</span></a></div>
    <p className="explain">{mode === 'matched' ? 'No new owner signature is needed for this image.' : mode === 'approve' ? 'Approval updates the vault measurement on NEAR. The agent must register its key before protection resumes.' : 'The saved local demo rules are the values shown for review. Live signing uses the current published agent measurement.'}</p>
  </section>
}
