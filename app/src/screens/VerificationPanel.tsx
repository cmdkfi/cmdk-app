// The agent verification panel (PRD §6): S4's right rail from step 1, and S5's "Verify the agent".
import { useAppConfig, useVerification } from '../components/data.ts'
import { useNow } from '../components/use-now.ts'
import { verificationRows, type RowId, type VerificationRow } from '../flow/verification.ts'

const TITLE: Record<RowId, string> = {
  measurement: 'Agent version approved by your vault',
  compose: 'Running agent matches the approved version',
  registration: 'Agent registered on your vault',
  keys: 'Agent key is limited',
  code: 'Vault code matches the factory',
  relayer: 'Relayer holds no authority',
  unchecked: 'What is not checked here',
}

const time = (ms: number) => new Date(ms).toLocaleTimeString()
/** "Checked at" only where the check ran to a result; a read that failed or had nothing to compare was only tried (Phase 7b). */
const when = (row: VerificationRow) => (row.checkedAt === null ? null : row.status === 'Checked' || row.status === 'Mismatch' ? `Checked at ${time(row.checkedAt)}` : `Last tried at ${time(row.checkedAt)}`)

export function VerificationPanel({ vaultId, poll, compact }: { vaultId: string | undefined; poll: boolean; compact?: boolean }) {
  const app = useAppConfig().data
  const now = useNow()
  const facts = useVerification(vaultId, poll)
  if (!app) return null
  const nearblocks = app.guided.help.nearblocks.replace(/\/$/, '')
  const vaultPage = vaultId ? `${nearblocks}/address/${vaultId}` : null
  const waiting = !vaultId ? { kind: 'no-vault' as const } : facts.isError ? { kind: 'failed' as const, error: facts.error.message, at: facts.errorUpdatedAt } : { kind: 'pending' as const }
  const rows = verificationRows(vaultId ? facts.data ?? null : null, now, waiting)
  const how = (row: VerificationRow) => {
    switch (row.id) {
      case 'measurement': return <>Open the <a href={app.guided.help.manifest} target="_blank" rel="noreferrer">published manifest</a>{row.sourceCommit ? <> (source commit <code>{row.sourceCommit}</code>)</> : null} and compare its six hex values with your vault's state{vaultPage ? <> on <a href={vaultPage} target="_blank" rel="noreferrer">NearBlocks</a></> : null}.</>
      case 'compose': return <>Download <code>app-compose.json</code> from the agent's evidence and hash it locally with <code>sha256sum</code>; see <a href={app.guided.help.measurementDoc} target="_blank" rel="noreferrer">agent/MEASUREMENT.md</a>.</>
      case 'registration': return row.registrationTx ? <>Open the <a href={`${nearblocks}/txns/${row.registrationTx}`} target="_blank" rel="noreferrer">registration transaction</a> on NearBlocks.</> : <>NearBlocks → {vaultPage ? <a href={vaultPage} target="_blank" rel="noreferrer">your vault</a> : 'your vault'} → Access keys shows the agent key once it is registered.</>
      case 'keys': return <>NearBlocks → {vaultPage ? <a href={vaultPage} target="_blank" rel="noreferrer">your vault</a> : 'your vault'} → Access keys.</>
      case 'code': return <>Compare the vault's code hash with the factory's on {vaultPage ? <a href={vaultPage} target="_blank" rel="noreferrer">NearBlocks</a> : 'NearBlocks'}.</>
      case 'relayer': return <>Read <a href={app.guided.help.relayerDoc} target="_blank" rel="noreferrer">scripts/RELAYER.md</a>.</>
      case 'unchecked': return <>Needs Docker and <code>dstack-mr</code>; see <a href={app.guided.help.measurementDoc} target="_blank" rel="noreferrer">agent/MEASUREMENT.md</a>.</>
    }
  }
  return <section className={`verify prototype-surface${compact ? ' verify--compact' : ''}`} aria-labelledby="verify-title">
    <div className="verify__head">
      <h2 id="verify-title">Agent verification</h2>
      {vaultId && <button type="button" className="link-button" disabled={facts.isFetching} onClick={() => { void facts.refetch() }}>{facts.isFetching ? 'Checking…' : 'Check again'}</button>}
    </div>
    <p className="screen__note">"Checked" means the check ran in this session and matched. Nothing here is shown as checked without a result.</p>
    <ol className="verify__rows">
      {rows.map(row => <li key={row.id} className={`verify__row verify__row--${row.status.replace(' ', '-').toLowerCase()}`} aria-label={TITLE[row.id]}>
        <div className="verify__line"><strong>{TITLE[row.id]}</strong><span className="verify__status" role="status">{row.status}</span></div>
        <p className="verify__result">{row.result}</p>
        <p className="verify__how">{when(row) && <><span className="verify__time">{when(row)}</span> · </>}How to check yourself: {how(row)}</p>
      </li>)}
    </ol>
  </section>
}
