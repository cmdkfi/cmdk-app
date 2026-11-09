// One step of a guided chain (S4 onboarding, S6 close): status, note, transaction and job links, the paused line with the
// verbatim error and an explicit Retry label (PRD FR-5, Phase 3 Retry wording).
import { formatUnits, shortAddress } from '../flow/format.ts'
import type { RetryKind, StepState, StepStatus } from '../flow/onboarding.ts'

const STATUS: Record<StepStatus, string> = {
  waiting: 'Waiting', prompting: 'Waiting for MetaMask…', submitted: 'Submitted', confirming: 'Confirming…', checking: 'Checking…',
  stale: 'Waiting for a fresh price', funding: 'Waiting for test USDC', done: 'Done', skipped: 'Not needed', paused: 'Paused',
}

function retryLabel(kind: RetryKind, step: StepState): string {
  switch (kind) {
    case 'prompt': return 'Try again'
    case 'post': return 'Ask the relayer again'
    case 'resend': return 'Send the same signed message again'
    case 'resign': return 'Sign a new message'
    case 'topUp': return `Send ${step.topUp ? formatUnits(BigInt(step.topUp.amountWei), 18, 6) : ''} ETH for gas`
    case 'accept': return 'Open at the lower LTV'
    case 'check': return 'Check again'
  }
}

export function StepRow({ title, why, index, step, explorer, onAct, now }: { title: string; why: string; index: number; step: StepState; explorer?: string; onAct: (kind: RetryKind) => void; now: number }) {
  const p = step.pause
  const wait = p?.retryAfter && p.since ? Math.max(0, Math.ceil(p.retryAfter - (now - p.since / 1000))) : 0
  return <li className={`step step--${step.status}`} aria-label={title}>
    <span className="step__index" aria-hidden="true">{index}</span>
    <div className="step__body">
      <div className="step__head"><strong>{title}</strong><span className="step__status" role="status">{STATUS[step.status]}</span></div>
      {step.note && <p className="step__note">{step.note}</p>}
      {step.topUp && step.topUp.status !== 'needed' && <p className="step__note">Gas top-up: {formatUnits(BigInt(step.topUp.amountWei), 18, 6)} ETH · {step.topUp.status === 'done' ? 'confirmed' : step.topUp.status === 'confirming' ? 'confirming…' : 'waiting for MetaMask…'}</p>}
      {step.txHash && explorer && <p className="step__note"><a href={`${explorer}/tx/${step.txHash}`} target="_blank" rel="noreferrer">Transaction {shortAddress(step.txHash)}</a></p>}
      {step.job && <p className="step__note">Relayer job <code>{step.job}</code></p>}
      {p && <div className="step__pause" role="alert">
        <p>{p.line}</p>
        {p.text && <pre className="step__error">{p.text}</pre>}
        {p.job && <p>Job <code>{p.job}</code></p>}
        {p.retry && <button type="button" className="prototype-button" disabled={wait > 0} onClick={() => onAct(p.retry!)}>{wait > 0 ? `Try again in ${wait} s` : retryLabel(p.retry, step)}</button>}
      </div>}
      <details className="step__why"><summary>Why</summary><p>{why}</p></details>
    </div>
  </li>
}
