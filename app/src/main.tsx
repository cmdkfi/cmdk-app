import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { WalletConnect, WalletStatus } from './WalletConnect.tsx'
import { RelayerReadiness } from './RelayerReadiness.tsx'
import { walletConfig } from './wallet.ts'
import { DemoProvider, useDemo } from './DemoContext.tsx'
import { validRules } from './demo.ts'
import { LoanDashboard } from './LoanDashboard.tsx'
import { VaultSelectionProvider } from './VaultSelectionContext.tsx'
import './styles.css'

type Page = 'connect' | 'create' | 'agent' | 'deposit' | 'take' | 'dashboard' | 'change' | 'leave' | 'verify' | 'scenes'
type Theme = 'dark' | 'light'

const pages: { id: Page; name: string; group: string }[] = [
  { id: 'connect', name: 'Connect', group: 'Start' },
  { id: 'create', name: 'Create vault', group: 'Start' },
  { id: 'agent', name: 'Agent version', group: 'Start' },
  { id: 'deposit', name: 'Deposit & open', group: 'Start' },
  { id: 'take', name: 'Take the USDC', group: 'Start' },
  { id: 'dashboard', name: 'My loan', group: 'Manage' },
  { id: 'change', name: 'Change rules', group: 'Manage' },
  { id: 'leave', name: 'Repay & leave', group: 'Manage' },
  { id: 'verify', name: 'Verify', group: 'Explore' },
  { id: 'scenes', name: 'Demo scenes', group: 'Explore' },
]
const pageIds = new Set(pages.map(page => page.id))

function readPage(): Page {
  const hash = window.location.hash.slice(1)
  return pageIds.has(hash as Page) ? hash as Page : 'connect'
}

function navigate(page: Page) {
  window.location.hash = page
}

function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'good' | 'warn' }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}

function ButtonLink({ to, children, secondary = false, disabled = false }: { to: Page; children: React.ReactNode; secondary?: boolean; disabled?: boolean }) {
  return <button className={`button ${secondary ? 'button--secondary' : ''}`} disabled={disabled} onClick={() => navigate(to)}>{children}<span aria-hidden="true">→</span></button>
}

function Card({ title, subtitle, children, className = '' }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return <section className={`card ${className}`}>
    {(title || subtitle) && <div className="card__header"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div></div>}
    {children}
  </section>
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return <div className="row"><div><span>{label}</span>{note && <small>{note}</small>}</div><strong>{value}</strong></div>
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <div className="placeholder" role="status">{children}</div>
}

function Band({ value = 50, floor = 30, target = 50, act = 70 }: { value?: number; floor?: number; target?: number; act?: number }) {
  return <div className="band" role="meter" aria-label="Loan-to-value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <div className="band__track" style={{ background: `linear-gradient(to right, var(--green) 0 ${act}%, var(--yellow) ${act}% 86%, var(--red) 86% 100%)` }}><span className="band__marker" style={{ left: `${value}%` }} /></div>
    <div className="band__legend"><span>Floor {floor}%</span><span>Target {target}%</span><span>Agent acts {act}%</span><span>Liquidation 86%</span></div>
  </div>
}

function Intro({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <div className="intro"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{children}</p></div>
}

function Connect() {
  const { state, dispatch } = useDemo()
  return <>
    <Intro eyebrow="01 / Start" title="Your loan, under your rules">Connect the wallet that will own your vault. You can explore the interface without connecting; no action is signed in this stage.</Intro>
    <WalletConnect />
    <RelayerReadiness />
    <div className="feature-grid">
      <Card title="Your money stays yours"><p>The agent can act only within the limits stored in your vault. Only an owner-signed message can send assets out.</p></Card>
      <Card title="Your rules are on-chain"><p>Set a target and an action line before opening a loan. Check the stored values on Base Sepolia.</p></Card>
      <Card title="See what happened"><p>Review the loan, agent status and recorded evidence in one place.</p></Card>
    </div>
    <div className="page-actions"><ButtonLink to="create">{state.phase === 'empty' ? 'Start local demo' : 'Continue local demo'}</ButtonLink><ButtonLink to="scenes" secondary>Explore demo scenes</ButtonLink>{state.phase !== 'empty' && <button className="button button--secondary" onClick={() => dispatch({ type: 'reset' })}>Reset local demo</button>}</div>
    <Placeholder>The local demo runs without a wallet or transactions. Vault search starts after wallet connection; live actions remain unavailable.</Placeholder>
  </>
}

function Create() {
  const { state, dispatch } = useDemo()
  const [floor, setFloor] = useState(state.rules.floor)
  const [target, setTarget] = useState(state.rules.target)
  const [act, setAct] = useState(state.rules.act)
  const [budget, setBudget] = useState(state.rules.budget)
  const [migrate, setMigrate] = useState(state.rules.migrate)
  const [exit, setExit] = useState(state.rules.exit)
  const rules = { floor, target, act, budget, migrate, exit }
  const valid = validRules(rules)
  return <>
    <Intro eyebrow="02 / Set limits" title="Create your vault">Choose the limits the agent must follow. The 86% liquidation threshold belongs to the Morpho market and cannot be changed here.</Intro>
    <div className="two-col"><Card title="Your LTV corridor" subtitle="Move each line to preview the rules. No values are being saved yet.">
      <Band value={target} floor={floor} target={target} act={act} />
      <div className="form-list">
        <label className="field"><span>Floor <small>Agent sales cannot go below this LTV.</small></span><input type="number" min="0" max="85" step="0.1" value={floor} onChange={event => setFloor(Number(event.target.value))} /><span>%</span></label>
        <label className="field"><span>Target <small>Protective sales aim to return here.</small></span><input type="number" min="0" max="85" step="0.1" value={target} onChange={event => setTarget(Number(event.target.value))} /><span>%</span></label>
        <label className="field"><span>Agent acts <small>Above this LTV, Reduce may begin.</small></span><input type="number" min="0" max="85.9" step="0.1" value={act} onChange={event => setAct(Number(event.target.value))} /><span>%</span></label>
        <Row label="Morpho liquidation" value="86%" note="Market setting" />
      </div>
      {!valid && <p className="inline-error" role="alert">Use Floor &lt; Target, Agent acts more than 0.1 points above Target, and Agent acts below 86%.</p>}
    </Card><Card title="Agent limits" subtitle="What the agent may do after the vault approves its version.">
      <label className="field"><span>Daily sell budget <small>Share of collateral in 24 hours.</small></span><input type="number" min="0" max="100" step="1" value={budget} onChange={event => setBudget(Number(event.target.value))} /><span>%</span></label>
      <label className="switch-row"><span>Move to the backup market <small>At most two moves in 24 hours.</small></span><input type="checkbox" checked={migrate} onChange={event => setMigrate(event.target.checked)} /></label>
      <label className="switch-row"><span>Exit when needed <small>The agent tries a move first.</small></span><input type="checkbox" checked={exit} onChange={event => setExit(event.target.checked)} /></label>
      <p className="explain">Above the action line, a sale back to Target can exceed the daily sell budget. An exit repays the entire loan and can sell much more collateral.</p>
    </Card></div>
    <div className="page-actions"><button className="button" disabled={!valid} onClick={() => { dispatch({ type: 'create', rules }); navigate('agent') }}>Create demo vault <span aria-hidden="true">→</span></button></div>
    <Placeholder>Creates a local example only. A real vault requires the published factory and relayer setup.</Placeholder>
  </>
}

function Agent() {
  const { state } = useDemo()
  return <>
    <Intro eyebrow="03 / Review the agent" title="Approve the code that may act">Only an agent build with the approved fingerprint can register the limited key. A new version needs your approval again.</Intro>
    <Card title="Agent version" subtitle="The approved measurement and source commit have not been published to this app yet.">
      <Row label="Version" value={<Pill>Awaiting config</Pill>} />
      <Row label="Measurement" value="Not available" />
      <Row label="Source commit" value="Not available" />
      <Row label="Key permissions" value="Reduce · Migrate · Exit" />
      <Row label="Registration" value={<Pill>Not connected</Pill>} />
      <p className="explain">During onboarding, the agent approval is included in the vault setup message. There is no separate approval signature here.</p>
    </Card>
    <div className="page-actions"><ButtonLink to={state.phase === 'empty' ? 'create' : 'deposit'}>{state.phase === 'empty' ? 'Create demo vault first' : 'Continue to deposit'}</ButtonLink></div>
  </>
}

function Deposit() {
  const { state, dispatch } = useDemo()
  const [collateral, setCollateral] = useState(2)
  const [ltv, setLtv] = useState(Math.min(50, state.rules.target))
  const maxLtv = Math.min(50, state.rules.act)
  const debt = collateral * 2500 * ltv / 100
  const liquidationPrice = collateral > 0 ? debt / (collateral * .86) : 0
  return <>
    <Intro eyebrow="04 / Open a position" title="Deposit & open loan">Choose collateral and a starting loan size for this local demo. A real position will use the market oracle and available liquidity.</Intro>
    <div className="two-col"><Card title="1 · Supply WETH" subtitle="Local example; no wallet transfer is sent.">
      <Row label="Demo vault" value={state.phase === 'vault' ? 'Ready to open' : 'Create vault first'} />
      <label className="field"><span>WETH to deposit</span><input type="number" min="0" step="0.001" value={collateral} onChange={event => setCollateral(Math.max(0, Number(event.target.value)))} /><span>WETH</span></label>
      <Placeholder>Opening a demo loan updates the local position. No deposit is watched on-chain.</Placeholder>
    </Card><Card title="2 · Choose the loan" subtitle="Preview the debt before signing Open.">
      <label className="range-field"><span>Starting LTV <strong>{ltv}%</strong></span><input type="range" min="1" max={maxLtv} value={ltv} onChange={event => setLtv(Number(event.target.value))} /></label>
      <Row label="Borrow" value={`${debt.toLocaleString('en-US')} USDC`} />
      <Row label="Liquidation price" value={`$${liquidationPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })} / ETH`} />
      <Row label="Market liquidity" value={<Pill>Feed not connected</Pill>} />
      <p className="explain">The actual borrow is capped by available market liquidity. Opening above that cap will be blocked before signing.</p>
    </Card></div>
    <div className="page-actions"><button className="button" disabled={state.phase !== 'vault' || collateral <= 0 || debt <= 0 || ltv > maxLtv} onClick={() => { dispatch({ type: 'open', collateral, ltv }); navigate('take') }}>Open demo loan <span aria-hidden="true">→</span></button>{state.phase !== 'vault' && <ButtonLink to="create" secondary>Create demo vault first</ButtonLink>}</div>
  </>
}

function Take() {
  const { state, dispatch } = useDemo()
  return <>
    <Intro eyebrow="05 / Receive the loan" title="Take the USDC">Borrowed USDC arrives at the position first. In the live app, moving it to your wallet requires your signature.</Intro>
    <Card title="Withdraw demo USDC"><Row label="Available at demo position" value={`${state.positionUsdc.toLocaleString('en-US')} USDC`} /><Row label="Demo wallet balance" value={`${state.walletUsdc.toLocaleString('en-US')} USDC`} /><Placeholder>This local action moves example balances only. No wallet message or transaction is sent.</Placeholder></Card>
    <div className="page-actions">{state.phase === 'opened' && <button className="button" onClick={() => { dispatch({ type: 'withdraw' }); navigate('dashboard') }}>Withdraw demo USDC <span aria-hidden="true">→</span></button>}{state.phase === 'empty' || state.phase === 'vault' ? <ButtonLink to="deposit">Open a demo loan first</ButtonLink> : <ButtonLink to="dashboard" secondary>View my loan</ButtonLink>}</div>
  </>
}

function Change() {
  const { state } = useDemo()
  return <><Intro eyebrow="07 / Manage" title="Change your rules">Review your corridor, agent version and access before signing a change.</Intro>
    <Card title="Corridor"><Row label="Floor · Target · Agent acts" value={`${state.rules.floor}% · ${state.rules.target}% · ${state.rules.act}%`} /><Row label="Daily sell budget" value={`${state.rules.budget}%`} /><Row label="Migrate · Exit" value={`${state.rules.migrate ? 'Allowed' : 'Off'} · ${state.rules.exit ? 'Allowed' : 'Off'}`} /><Placeholder>These are local demo rules. Editing and signing a live change requires a connected vault.</Placeholder></Card>
    <Card title="Agent access"><Row label="Approved version" value={<Pill>Not connected</Pill>} /><Row label="Watching" value="Unknown" /><p className="explain">Revoking access deletes the agent key. Previously signed calls may remain valid for up to 10 minutes. Your loan stays open.</p></Card>
    <div className="page-actions"><ButtonLink to="verify" secondary>Review verification</ButtonLink></div>
  </>
}

function Leave() {
  const { state, dispatch } = useDemo()
  const canRepay = ['withdrawn', 'risk', 'protected'].includes(state.phase) && state.walletUsdc >= state.debt
  return <><Intro eyebrow="08 / Leave" title="Repay and leave">Repay debt in each market, then withdraw the remaining WETH and USDC to your wallet.</Intro>
    <Card title="1 · Repay"><Row label="Remaining demo debt" value={`${Math.round(state.debt).toLocaleString('en-US')} USDC`} /><Row label="Available in demo wallet" value={`${Math.round(state.walletUsdc).toLocaleString('en-US')} USDC`} /><p className="explain">A live repayment also needs gas and may include accrued interest. This local calculation excludes both.</p>{canRepay && <div className="card-actions"><button className="button" onClick={() => dispatch({ type: 'repay' })}>Repay remaining demo debt</button></div>}{state.debt > state.walletUsdc && <Placeholder>Not enough demo USDC to repay. A live app would show the amount to transfer from your wallet.</Placeholder>}</Card>
    <Card title="2 · Withdraw collateral"><Row label="Remaining WETH" value={`${state.collateral.toFixed(3)} WETH`} /><Row label="Returned to demo wallet" value={`${state.returnedWeth.toFixed(3)} WETH`} /><Placeholder>{state.phase === 'closed' ? 'The local loan is closed. No signature or transaction was sent.' : 'Repay the full demo debt before withdrawing WETH.'}</Placeholder>{state.phase === 'repaid' && <div className="card-actions"><button className="button" onClick={() => dispatch({ type: 'close' })}>Withdraw remaining demo WETH</button></div>}</Card>
    <div className="page-actions"><ButtonLink to={state.phase === 'empty' || state.phase === 'vault' ? 'create' : 'dashboard'} secondary>{state.phase === 'closed' ? 'View result' : 'Back to my loan'}</ButtonLink></div>
  </>
}

const checks = [
  ['Agent key', 'One limited key; Reduce, Migrate and Exit only'],
  ['Vault code', 'Hash matches the published immutable version'],
  ['Stored corridor', 'On-chain rules match both markets'],
  ['Loan-to-value', 'Morpho oracle and market math agree'],
  ['Executor authorization', 'Only the approved executor can act'],
  ['Agent version', 'Measurement and registration match'],
]

function Verify() {
  return <><Intro eyebrow="09 / Inspect" title="Verify your vault">Each check needs a matching independent record. This preview has no connected vault, so no item is marked verified.</Intro>
    <Card title="Vault checks" subtitle="0 of 6 verified">{checks.map(([name, expected], index) => <div className="check" key={name}><span className="check__index">{index + 1}</span><div><h3>{name}</h3><p>Expected: {expected}</p></div><Pill>Not connected</Pill></div>)}</Card>
    <Card title="Recorded evidence" subtitle="External records and proof links belong here."><Placeholder>Evidence links will be shown only when their records are available and can be checked.</Placeholder></Card>
  </>
}

const scenes = [
  ['Gradual crash', '−45% over hours', 'Compare the unprotected position, a numeric rule and the agent.'],
  ['One-block gap', '−25%, then −45%', 'Show when protection cannot win the race.'],
  ['Whipsaw', '−32%, then recovery', 'Show the cost of selling before a rebound.'],
  ['Venue stress', 'Utilization reaches 99%', 'Compare moving to a backup market with exiting.'],
  ['Early warning', 'Two labelled demo feeds', 'Show a market move before the numeric indicators change.'],
]

function Scenes() {
  return <><Intro eyebrow="10 / Demo" title="Demo scenes">The full local loan journey works in this React app. The scenario comparisons below are still planned and have no testnet receipts.</Intro>
    <Placeholder>The existing interactive prototype remains available. Its values are local examples, with no testnet transactions.</Placeholder>
    <div className="scene-list">{scenes.map(([title, signal, description], index) => <Card key={title} className="scene"><div className="scene__number">0{index + 1}</div><div><h2>{title}</h2><strong>{signal}</strong><p>{description}</p></div><Pill>Planned</Pill></Card>)}</div>
    <div className="page-actions"><ButtonLink to="dashboard">Open local loan demo</ButtonLink><a className="button button--secondary" href="/prototype/index.html?demo=markets">Open earlier prototype <span aria-hidden="true">↗</span></a></div>
  </>
}

const screen: Record<Page, React.ComponentType> = {
  connect: Connect, create: Create, agent: Agent, deposit: Deposit, take: Take,
  dashboard: LoanDashboard, change: Change, leave: Leave, verify: Verify, scenes: Scenes,
}

function App() {
  const [page, setPage] = useState<Page>(readPage)
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('cmdk-theme') === 'light' ? 'light' : 'dark')
  useEffect(() => {
    const onHash = () => { setPage(readPage()); window.scrollTo({ top: 0, behavior: 'instant' }) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('cmdk-theme', theme) }, [theme])
  const Screen = screen[page]
  return <div className="layout">
    <aside className="sidebar"><a className="brand" href="#connect" aria-label="cmdk home">⌘ K</a><nav aria-label="App preview navigation">{['Start', 'Manage', 'Explore'].map(group => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{pages.filter(item => item.group === group).map(item => <a key={item.id} href={`#${item.id}`} aria-current={page === item.id ? 'page' : undefined}>{item.name}</a>)}</div>)}</nav><div className="sidebar__bottom"><button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼ Light appearance' : '☾ Dark appearance'}</button><span>App foundation · preview</span></div></aside>
    <div className="workspace"><header className="topbar"><span>{pages.find(item => item.id === page)?.name}</span><WalletStatus /></header><main id="main" className="content" key={page}><Screen /></main><footer className="footer"><span>Runs on NEAR testnet and Base Sepolia. Unaudited. No real money.</span><span>Interface preview · no live actions</span></footer></div>
  </div>
}

const queryClient = new QueryClient()
createRoot(document.getElementById('root')!).render(<WagmiProvider config={walletConfig}><QueryClientProvider client={queryClient}><VaultSelectionProvider><DemoProvider><App /></DemoProvider></VaultSelectionProvider></QueryClientProvider></WagmiProvider>)
