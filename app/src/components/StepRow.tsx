// One step of a guided chain (S4 onboarding, S6 close): status, note, transaction and job links, the paused line with the
// verbatim error and an explicit Retry label (PRD FR-5, Phase 3 Retry wording).
import { ExtLink } from './Sandbox.tsx'
import type { ReactNode } from 'react'
import { useAdapters, useWalletLabel } from '../adapters/AdapterProvider.tsx'
import { formatUnits, shortAddress } from '../flow/format.ts'
import type { RetryKind, StepState, StepStatus } from '../flow/onboarding.ts'

const STATUS: Record<StepStatus, string> = {
  waiting: 'Waiting', prompting: 'Waiting for your wallet…', submitted: 'Submitted', confirming: 'Confirming…', checking: 'Checking…',
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
    case 'switch': return 'Switch to Base Sepolia'
  }
}

/** m:ss */
function countdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * "Checking…" says why and until when (Phase 7b). The expiry is NEAR time; once a NEAR time was read the countdown
 * runs on NEAR's clock (last read + browser time since), before that on the browser clock.
 */
function CheckLine({ check, now }: { check: NonNullable<StepState['check']>; now: number }) {
  const left = check.nearNow !== undefined && check.readAt !== undefined ? check.expiry - (check.nearNow + (now - check.readAt / 1000)) : check.expiry - now
  const at = new Date((now + left) * 1000).toLocaleTimeString()
  return <p className="note">{check.reason} Waiting for the signed message to expire at {at} ({countdown(left)} left) unless the vault shows it ran.</p>
}

/**
 * docs/mockups/S4-Progress .step: number (✓ when done), body, status on the right. `active` marks the step the chain is
 * on. The Why line stays an expandable <details> (PRD S4 "an expandable Why line"; the artboard prints it inline).
 */
export function StepRow({ title, why, index, step, explorer, onAct, now, extra, active, prompt = 'signature' }: { title: string; why: string; index: number; step: StepState; explorer?: string; onAct: (kind: RetryKind) => void; now: number; extra?: ReactNode; active?: boolean; prompt?: 'signature' | 'transaction' }) {
  const p = step.pause
  const wallet = useWalletLabel()
  // PRD §8a: in the sandbox "Waiting for MetaMask…" reads "Simulated signature" / "Simulated transaction"
  const { kind } = useAdapters()
  const prompting = kind === 'sandbox' ? `Simulated ${prompt}` : `Waiting for ${wallet}…`
  const wait = p?.retryAfter && p.since ? Math.max(0, Math.ceil(p.retryAfter - (now - p.since / 1000))) : 0
  const done = step.status === 'done' || step.status === 'skipped'
  return <li className={`step ${step.status}${done ? ' done' : ''}${active && !done ? ' active' : ''}`} aria-label={title}>
    <span className="n" aria-hidden="true">{done ? '✓' : index}</span>
    <div className="body">
      <strong>{title}</strong>
      {kind === 'live' && step.status === 'prompting' && <p className="mobile-wallet-hint">Confirm this {prompt} in {wallet}. If you switch apps, return to this page afterwards. A submitted request still needs confirmation.</p>}
      {step.note && <p className="note">{step.note}</p>}
      {step.status === 'checking' && step.check && <CheckLine check={step.check} now={now} />}
      {step.topUp && step.topUp.status !== 'needed' && <p className="note">Gas top-up: {formatUnits(BigInt(step.topUp.amountWei), 18, 6)} ETH · {step.topUp.status === 'done' ? 'confirmed' : step.topUp.status === 'confirming' ? 'confirming…' : `waiting for ${wallet}…`}</p>}
      {step.txHash && explorer && <p className="note"><ExtLink href={`${explorer}/tx/${step.txHash}`}>Transaction {shortAddress(step.txHash)}</ExtLink></p>}
      {step.job && <p className="note">Relayer job <code>{step.job}</code></p>}
      {extra}
      {p && <div className="pause" role="alert">
        <p>{p.line}</p>
        {p.text && <pre>{p.text}</pre>}
        {p.job && <p>Job <code>{p.job}</code></p>}
        {p.retry && <button type="button" className="btn" disabled={wait > 0} onClick={() => onAct(p.retry!)}>{wait > 0 ? `Try again in ${wait} s` : retryLabel(p.retry, step)}</button>}
      </div>}
      <details className="why"><summary>Why</summary><p>{why}</p></details>
    </div>
    <span className="st" role="status">{step.status === 'checking' || step.status === 'confirming' || step.status === 'prompting' || step.status === 'funding' ? <span className="pulse" aria-hidden="true" /> : null}{step.status === 'prompting' ? prompting : STATUS[step.status]}</span>
  </li>
}
