import { useId, useState, type CSSProperties } from 'react'
import { formatUnits } from 'viem'
import type { MarketPosition } from './positions.ts'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'
import './ltv-simulation.css'

export function LtvSimulation({ market }: { market: MarketPosition }) {
  const id = useId()
  const initial = market.ltv === null ? 0 : Math.round(Number(market.ltv) / 1e14)
  const max = Math.max(10000, initial)
  const [basisPoints, setBasisPoints] = useState(initial)
  const [keyboard, setKeyboard] = useState(false)
  const unavailable = market.collateralValue <= 0n
  const simulatedLtv = BigInt(basisPoints) * 10n ** 14n
  const projectedDebt = market.collateralValue * BigInt(basisPoints) / 10000n
  const number = (value: bigint) => Number(formatUnits(value, market.loanDecimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })
  const percent = (value: bigint) => `${(Number(value) / 1e16).toFixed(1)}%`
  const zone = simulatedLtv >= market.liquidationLtv ? 'Liquidation threshold reached' : market.agentTrigger !== null && simulatedLtv > market.agentTrigger ? 'Above Act' : market.agentTarget !== null && simulatedLtv > market.agentTarget ? 'Above Target' : 'Below configured thresholds'
  const stops = [{ label: 'Target', value: market.agentTarget }, { label: 'Act', value: market.agentTrigger }, { label: 'Liquidation', value: market.liquidationLtv }]
  const style = { '--sim-position': `${basisPoints / max * 100}%`, '--sim-current': `${initial / max * 100}%` } as CSSProperties
  return <PrototypeSurface className="ltv-simulation">
    <div className="vault-detail-heading"><div><span className="ltv-sim-badge">Simulation only</span><h3 id={`${id}-title`}>Explore LTV</h3></div><PrototypeButton disabled={unavailable || basisPoints === initial} onClick={() => setBasisPoints(initial)}>Reset</PrototypeButton></div>
    <p id={`${id}-help`}>Drag ⌘ to explore a different debt level. Collateral and oracle price stay fixed. No transaction is sent.</p>
    {unavailable ? <p role="status">Add collateral before exploring LTV. There is no collateral value to calculate against.</p> : <>
      <div className="ltv-sim-values"><span>Current LTV <strong>{market.ltv === null ? '—' : percent(market.ltv)}</strong></span><span>Simulated LTV <strong>{(basisPoints / 100).toFixed(1)}%</strong></span></div>
      <div className={`ltv-sim-control ${keyboard ? 'is-keyboard' : ''}`} style={style}>
        <div className="ltv-sim-rail" aria-hidden="true"><span className="ltv-sim-fill"/>{stops.map(stop => stop.value !== null && <i key={stop.label} className={`ltv-sim-stop is-${stop.label.toLowerCase()}`} style={{left: `${Math.min(100, Number(stop.value) / 1e14 / max * 100)}%`}} />)}<span className="ltv-sim-original" title="Current LTV"/></div>
        <span className="ltv-sim-thumb" aria-hidden="true"><span>⌘</span></span>
        <span className="ltv-sim-tooltip" aria-hidden="true">{(basisPoints / 100).toFixed(1)}% · Simulation</span>
        <input id={`${id}-range`} type="range" min="0" max={max} step="10" value={basisPoints}
          aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} aria-valuetext={`${(basisPoints / 100).toFixed(1)} percent simulated LTV. ${zone}`}
          onKeyDown={() => setKeyboard(true)} onPointerDown={() => setKeyboard(false)} onChange={event => setBasisPoints(Number(event.target.value))}/>
      </div>
      <div className="ltv-sim-zones">{stops.map(stop => <span key={stop.label} className={stop.value !== null && simulatedLtv >= stop.value ? 'is-reached' : ''}>{stop.label}<strong>{stop.value === null ? 'Not set' : percent(stop.value)}</strong></span>)}</div>
      <p className={`ltv-sim-status ${simulatedLtv >= market.liquidationLtv ? 'is-danger' : ''}`}>{zone}</p>
      <div className="ltv-sim-debt"><span>Debt at simulated LTV</span><strong>{number(market.debt)} → {number(projectedDebt)} {market.loanSymbol}</strong></div>
      <p className="ltv-sim-note">Illustrative calculation, not a borrowing quote. Liquidity, fees, pending interest and execution limits are not included. The current position above stays unchanged.</p>
    </>}
  </PrototypeSurface>
}
