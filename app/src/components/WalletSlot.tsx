import { useEffect, useRef, useState } from 'react'
import type { AdapterKind, WalletState } from '../adapters/types.ts'
import { shortAddress } from '../flow/format.ts'

const BASE_SEPOLIA = 84532

type MenuItem = { label: string; href?: string; danger?: boolean; onSelect?: () => void }

function SlotMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      root.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="wallet-slot-menu" ref={root}>
    <button type="button" className="wallet-slot" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {label}<span aria-hidden="true" className="wallet-slot__caret">▾</span>
    </button>
    {open && <div role="menu" aria-label={label} className="wallet-slot-menu__list">
      {items.map(item => item.href
        ? <a key={item.label} role="menuitem" href={item.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{item.label}</a>
        : <button key={item.label} type="button" role="menuitem" className={item.danger ? 'is-danger' : undefined} onClick={() => { setOpen(false); item.onSelect?.() }}>{item.label}</button>)}
    </div>}
  </div>
}

/**
 * Header wallet slot (PRD S0), the only navigation control. Five states:
 * not connected, connecting / checking vaults, connected, wrong network, sandbox active.
 */
export function WalletSlot({ kind, state, checkingVaults, explorer, onConnect, onSwitch, onDisconnect, onLeaveSandbox }: {
  kind: AdapterKind
  state: WalletState
  checkingVaults: boolean
  /** Explorer base URL from config.json; the BaseScan item is omitted until config is loaded. */
  explorer?: string
  onConnect: () => void
  onSwitch: () => void
  onDisconnect: () => void
  onLeaveSandbox: () => void
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (kind === 'sandbox') return <SlotMenu label="Sandbox wallet · simulated" items={[{ label: 'Leave sandbox', onSelect: onLeaveSandbox }]} />
  if (state.status === 'disconnected') return <button type="button" className="prototype-button is-primary wallet-slot wallet-slot--connect" onClick={onConnect}>Connect wallet</button>
  if (state.status === 'connecting' || checkingVaults) {
    return <span className="wallet-slot wallet-slot--busy" role="status"><span className="wallet-slot__pulse" aria-hidden="true" />{state.status === 'connecting' ? 'Connecting…' : 'Checking your vaults…'}</span>
  }
  const short = shortAddress(state.address)
  if (state.chainId !== BASE_SEPOLIA) return <button type="button" className="wallet-slot wallet-slot--warning" onClick={onSwitch}>{short} · Switch to Base Sepolia</button>
  return <SlotMenu label={`${short} · Base Sepolia`} items={[
    { label: copied ? 'Copied' : 'Copy address', onSelect: () => { void navigator.clipboard?.writeText(state.address).then(() => setCopied(true), () => undefined) } },
    ...(explorer ? [{ label: 'View on BaseScan', href: `${explorer.replace(/\/$/, '')}/address/${state.address}` }] : []),
    { label: 'Disconnect', danger: true, onSelect: onDisconnect },
  ]} />
}
