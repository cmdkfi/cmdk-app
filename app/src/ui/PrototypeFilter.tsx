import { useEffect, useRef, useState } from 'react'
import { TokenIcon } from './TokenIcon.tsx'
import { PrototypeButton } from './PrototypeControls.tsx'

export function FilterIcon({ kind = 'filter' }: { kind?: string }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{kind === 'check' ? <path d="m5 12 4 4L19 6"/> : kind === 'asset' ? <><path d="m12 3 6 9-6 4-6-4 6-9Zm-6 12 6 6 6-6"/></> : kind === 'status' ? <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/></> : <path d="M3 6h18M6 12h12M10 18h4"/>}</svg>
}

export function PrototypeFilter({ label, value, options, onChange, icon = 'filter' }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; icon?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const selected = options.find(option => option.value === value)
  return <div className="prototype-filter" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }}>
    <button ref={trigger} className="prototype-filter-trigger" aria-expanded={open} aria-label={`${label}: ${selected?.label}`} onClick={() => setOpen(!open)}><FilterIcon/><span>{label}</span>{value !== 'all' && <span className="prototype-filter-value">{selected?.label}</span>}</button>
    {open && <div className="prototype-filter-panel" role="group" aria-label={`${label} options`}>
      {options.map(option => <button className="prototype-filter-option" key={option.value} aria-pressed={value === option.value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }}>{icon === 'asset' && option.value !== 'all' ? <TokenIcon asset={option.value.startsWith('WETH') ? 'WETH' : 'ETH'} /> : <FilterIcon kind={icon}/>}<span>{option.label}</span><span className="prototype-filter-check">{value === option.value && <FilterIcon kind="check"/>}</span></button>)}
      <div className="prototype-filter-footer"><span>{label}</span><PrototypeButton onClick={() => { onChange('all'); setOpen(false); trigger.current?.focus() }}>Clear</PrototypeButton></div>
    </div>}
  </div>
}
