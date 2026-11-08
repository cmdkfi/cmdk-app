import { useEffect, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { accountKind } from './wallet-utils.ts'
import { CreateVaultError, readCreateJob, startCreateVault, type CreateJob } from './create-vault.ts'
import { loadConfig, type AppConfig } from './near.ts'
import { assessRelayer, readRelayerHealth, type Readiness } from './relayer.ts'
import { useVaultSelection } from './VaultSelectionContext.tsx'

type View = { kind: 'checking' | 'pending' | 'ready' | 'working' | 'uncertain' | 'error'; message: string }
const stages = ['accepted', 'vault_created', 'float_sent', 'done'] as const
const labels = ['Request accepted', 'Vault created', 'Gas sent', 'Ready']

export function CreateVaultJob() {
  const { address, isConnected } = useAccount()
  const { refresh, kind: discoveryKind } = useVaultSelection()
  const client = usePublicClient({chainId:84532})
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [view, setView] = useState<View>({ kind: 'checking', message: 'Checking the deployment and relayer…' })
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<CreateJob | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)
  const key = config?.near.factory && address ? `cmdk-create:${config.near.factory}:${address.toLowerCase()}` : null

  useEffect(() => {
    let active = true
    setJobId(null); setJob(null); setRetryAfter(null); setConfig(null)
    setView({kind:'checking',message:'Checking the deployment and relayer…'})
    loadConfig().then(async next => {
      if (!active) return
      setConfig(next)
      if (!next.near.factory || !next.createVault) {
        setView({ kind: 'pending', message: 'Vault creation is waiting for the published factory and market addresses.' })
        return
      }
      const saved = address && sessionStorage.getItem(`cmdk-create:${next.near.factory}:${address.toLowerCase()}`)
      if (saved === 'uncertain') {
        setView({ kind: 'uncertain', message: 'A previous create request had no confirmed response. Check your vaults before trying again.' })
        return
      }
      if (saved) {
        setJobId(saved)
        setView({ kind: 'working', message: 'Checking the previous create request…' })
        return
      }
      const health = await readRelayerHealth(next)
      if (!active) return
      const readiness: Readiness = assessRelayer(next, health)
      setView({ kind: readiness.kind === 'ready' ? 'ready' : readiness.kind === 'pending' ? 'pending' : 'error', message: readiness.message })
    }).catch(error => {
      if (active) setView({ kind: 'error', message: error instanceof Error ? error.message : 'Could not check vault creation.' })
    })
    return () => { active = false }
  }, [address])

  useEffect(() => {
    if (!config || !jobId || job?.stage === 'done' || job?.stage === 'failed' || view.kind === 'uncertain') return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await readCreateJob(config, jobId)
        if (!active) return
        setJob(next)
        if (next.stage === 'done') {
          setView({ kind: 'working', message: 'Vault created. Protection rules still need your approval during setup.' })
          if (key) sessionStorage.removeItem(key)
          refresh()
        } else if (next.stage === 'failed') {
          setView({ kind: 'error', message: next.vault ? 'Vault exists, but a later step failed. Check its status before continuing.' : next.error || 'Vault creation failed.' })
        } else {
          setView({ kind: 'working', message: 'The relayer is creating your testnet vault.' })
          timer = window.setTimeout(poll, 1000)
        }
      } catch (error) {
        if (!active) return
        if (error instanceof CreateVaultError && error.uncertain) {
          setView({ kind: 'uncertain', message: error.message })
        } else {
          setView({ kind: 'working', message: 'The job status is temporarily unavailable. Checking again…' })
          timer = window.setTimeout(poll, 1000)
        }
      }
    }
    void poll()
    return () => { active = false; window.clearTimeout(timer) }
  }, [config, jobId, job?.stage, view.kind])

  async function create() {
    if (!config || !address || !key || !client || discoveryKind !== 'ready' || view.kind !== 'ready') return
    setView({ kind: 'working', message: 'Sending one create request…' })
    try {
      if (accountKind(await client.getCode({address})) === 'contract') throw new CreateVaultError('This account type is not supported yet. Connect another wallet.')
      const id = await startCreateVault(config, address)
      sessionStorage.setItem(key, id)
      setJobId(id)
      setRetryAfter(null)
    } catch (error) {
      const problem = error instanceof CreateVaultError ? error : new CreateVaultError('Vault creation could not start.')
      if (problem.uncertain) sessionStorage.setItem(key, 'uncertain')
      setRetryAfter(problem.retryAfter ?? null)
      setView({ kind: problem.uncertain ? 'uncertain' : 'error', message: problem.message })
    }
  }

  async function checkAgain() {
    if (!config) return
    setView({ kind: 'checking', message: 'Checking the relayer…' })
    try {
      const readiness = assessRelayer(config, await readRelayerHealth(config))
      setView({ kind: readiness.kind === 'ready' ? 'ready' : readiness.kind === 'pending' ? 'pending' : 'error', message: readiness.message })
    } catch (error) {
      setView({ kind: 'error', message: error instanceof Error ? error.message : 'Relayer is unavailable.' })
    }
  }

  const currentStage = job?.stage === 'failed' ? stages.indexOf(job.vault ? 'vault_created' : 'accepted') : stages.indexOf(job?.stage as typeof stages[number])
  return <section className="card create-job" aria-labelledby="create-job-title">
    <div className="card__header"><div><h2 id="create-job-title">Create a testnet vault</h2><p>The relayer creates the vault on NEAR testnet and funds gas on Base Sepolia. No loan or token transfer happens here.</p></div></div>
    <p className="create-job__status" role="status">{view.message}</p>
    {jobId && <div className="create-job__progress" aria-label="Vault creation progress">{labels.map((label, index) => <div key={label} className={index <= currentStage ? 'is-reached' : ''}><span aria-hidden="true">{index < currentStage || job?.stage === 'done' ? '✓' : index + 1}</span>{label}</div>)}</div>}
    {job?.vault && <p className="create-job__address">Vault: <a href={`https://testnet.nearblocks.io/address/${encodeURIComponent(job.vault)}`} target="_blank" rel="noreferrer">{job.vault} ↗</a></p>}
    {jobId && <p className="create-job__address">Job ID: <code>{jobId}</code></p>}
    {retryAfter && <p className="explain">Rate limited. Wait at least {retryAfter} seconds before checking again.</p>}
    <div className="card-actions">
      <button className="button" disabled={!isConnected || discoveryKind !== 'ready' || view.kind !== 'ready' || !!jobId} onClick={() => void create()}>Create testnet vault <span aria-hidden="true">→</span></button>
      {!jobId && view.kind !== 'ready' && <button className="button button--secondary" onClick={() => void checkAgain()}>Check readiness</button>}
      {job?.stage === 'done' && job.vault && <a className="button" href={`#vault?id=${encodeURIComponent(job.vault)}`}>Continue to vault setup →</a>}
      {job?.stage === 'done' && <button className="button button--secondary" onClick={() => {setJobId(null);setJob(null);void checkAgain()}}>Create another vault</button>}
      {(view.kind === 'uncertain' || job?.stage === 'failed') && <a className="button button--secondary" href="#connect">Check my vaults <span aria-hidden="true">→</span></a>}
    </div>
    {isConnected && discoveryKind === 'error' && <p role="alert">Owner account verification failed. Return to Vaults and retry before creating a vault.</p>}
    {!isConnected && <p className="explain">Connect your owner wallet to create a testnet vault.</p>}
    <p className="explain">A successful creation only prepares the vault. Its protection rules are not active until you review and approve setup.</p>
  </section>
}
