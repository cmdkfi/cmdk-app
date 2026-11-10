// Sandbox UI (PRD §8a, Phase 6b; docs/mockups S8 entry sheet, S11 leave sheet, the banner of S8–S11): the entry
// points, the explainer, the persistent banner and Leave sandbox. Activating and leaving only change the hash and
// sessionStorage; App.tsx mounts the matching adapter set (never both).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAdapters } from '../adapters/AdapterProvider.tsx'
import { writeSession } from '../flow/session.ts'

/** Every sandbox key lives in sessionStorage under this prefix (flow/session.ts, onboarding-record.ts, the engine). */
const SANDBOX_PREFIX = 'cmdk.sandbox.'

export function clearSandboxSession() {
  try {
    const s = window.sessionStorage
    for (const key of Object.keys(s)) if (key.startsWith(SANDBOX_PREFIX)) s.removeItem(key)
  } catch { /* storage unavailable: nothing kept */ }
}

function Sheet({ label, children, onClose }: { label: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal() }, [])
  return <dialog ref={ref} className="sheet" aria-label={label} onCancel={event => { event.preventDefault(); onClose() }}>{children}</dialog>
}

/** S8: the explainer with one Activate sandbox button; activation starts a fresh sandbox at #sandbox/start with 0.5 ETH. */
export function SandboxSheet({ onClose }: { onClose: () => void }) {
  const activate = () => {
    clearSandboxSession()
    writeSession('sandbox', 'amount', '0.5')
    window.location.hash = '#sandbox/start'
  }
  return <Sheet label="Try in sandbox" onClose={onClose}>
    <h2>Try in sandbox</h2>
    <p className="muted">Simulated wallet and simulated protocol. Nothing touches Base Sepolia or NEAR. Numbers are illustrative.</p>
    <dl className="rows" style={{ margin: 0 }}>
      <div className="row"><dt className="k">Wallet</dt><dd className="v">Simulated, 10 ETH · 5,000 USDC</dd></div>
      <div className="row"><dt className="k">Protocol</dt><dd className="v">Simulated in your browser</dd></div>
      <div className="row"><dt className="k">Network calls</dt><dd className="v">None</dd></div>
      <div className="row"><dt className="k">Agent</dt><dd className="v">Scripted: one price drop, one reduce</dd></div>
    </dl>
    <button type="button" className="btn primary" onClick={activate}>Activate sandbox</button>
    <button type="button" className="btn ghost" style={{ justifySelf: 'start', paddingLeft: 0 }} onClick={onClose}>Back</button>
  </Sheet>
}

/** "Try in sandbox": on S3 beside the wallet list and in the no-wallet state, and in the header while no wallet is connected. */
export function TryInSandbox({ variant = 'button' }: { variant?: 'button' | 'link' }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={variant === 'link' ? 'link-button small header-sandbox' : 'btn'} onClick={() => setOpen(true)}>Try in sandbox</button>
    {open && <SandboxSheet onClose={() => setOpen(false)} />}
  </>
}

/** S11: Leave the sandbox? Leave clears every sandbox key and lands on #start with no wallet connected. */
export function LeaveSandboxSheet({ onStay }: { onStay: () => void }) {
  const leave = () => {
    clearSandboxSession()
    window.location.hash = '#start'
  }
  return <Sheet label="Leave the sandbox?" onClose={onStay}>
    <h2>Leave the sandbox?</h2>
    <p className="muted">Simulated data is discarded.</p>
    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
      <button type="button" className="btn" onClick={onStay}>Stay</button>
      <button type="button" className="btn primary" onClick={leave}>Leave</button>
    </div>
  </Sheet>
}

/** The persistent banner above the header while the sandbox is active (PRD §8a "Sandbox · simulated data"). */
export function SandboxBanner({ onLeave }: { onLeave: () => void }) {
  return <div className="banner" role="status">Sandbox · simulated data · <button type="button" className="link-button" style={{ color: '#0a0a0a' }} onClick={onLeave}>Leave sandbox</button></div>
}

/**
 * A link to an explorer (a hash or an address): in the sandbox it is disabled and tagged "simulated" (PRD §8a);
 * live it opens in a new tab.
 */
export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  const { kind } = useAdapters()
  if (kind === 'sandbox') return <span className="simulated-link">{children} <span className="tag">simulated</span></span>
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>
}
