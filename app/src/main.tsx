import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { WalletConnect, WalletStatus } from './WalletConnect.tsx'
import { walletConfig } from './wallet.ts'
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
  return <>
    <Intro eyebrow="01 / Start" title="Your loan, under your rules">Connect the wallet that will own your vault. You can explore the interface without connecting; no action is signed in this stage.</Intro>
    <WalletConnect />
    <div className="feature-grid">
      <Card title="Your money stays yours"><p>The agent can act only within the limits stored in your vault. Only an owner-signed message can send assets out.</p></Card>
      <Card title="Your rules are on-chain"><p>Set a target and an action line before opening a loan. Check the stored values on Base Sepolia.</p></Card>
      <Card title="See what happened"><p>Review the loan, agent status and recorded evidence in one place.</p></Card>
    </div>
    <div className="page-actions"><ButtonLink to="create">Preview vault setup</ButtonLink><ButtonLink to="scenes" secondary>Explore demo scenes</ButtonLink></div>
    <Placeholder>Vault discovery and signing will be added in separate steps. The remaining screens still show example values and cannot submit transactions.</Placeholder>
  </>
}

function Create() {
  const [floor, setFloor] = useState(30)
  const [target, setTarget] = useState(50)
  const [act, setAct] = useState(70)
  const [budget, setBudget] = useState(20)
  const [migrate, setMigrate] = useState(true)
  const [exit, setExit] = useState(true)
  const valid = floor < target && target + 0.1 < act && act < 86 && budget >= 0 && budget <= 100
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
    <div className="page-actions"><ButtonLink to="agent" disabled={!valid}>Review agent version</ButtonLink></div>
    <Placeholder>Creating a vault will be enabled after wallet, config and relayer integration. This form currently previews the rules only.</Placeholder>
  </>
}

function Agent() {
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
    <div className="page-actions"><ButtonLink to="deposit">Preview deposit & open</ButtonLink></div>
  </>
}

function Deposit() {
  const [collateral, setCollateral] = useState(2)
  const [ltv, setLtv] = useState(50)
  const debt = collateral * 2500 * ltv / 100
  const liquidationPrice = collateral > 0 ? debt / (collateral * .86) : 0
  return <>
    <Intro eyebrow="04 / Open a position" title="Deposit & open loan">Send WETH to your position address, then choose the loan size. Example values below use ETH at $2,500; the connected app will use the market oracle and available liquidity.</Intro>
    <div className="two-col"><Card title="1 · Send WETH" subtitle="The deposit is an ordinary wallet transfer on Base Sepolia.">
      <Row label="Your position address" value="Not created" />
      <label className="field"><span>WETH to deposit</span><input type="number" min="0" step="0.001" value={collateral} onChange={event => setCollateral(Math.max(0, Number(event.target.value)))} /><span>WETH</span></label>
      <Placeholder>Waiting for a connected wallet and a created vault. No deposit is being watched yet.</Placeholder>
    </Card><Card title="2 · Choose the loan" subtitle="Preview the debt before signing Open.">
      <label className="range-field"><span>Starting LTV <strong>{ltv}%</strong></span><input type="range" min="1" max="50" value={ltv} onChange={event => setLtv(Number(event.target.value))} /></label>
      <Row label="Borrow" value={`${debt.toLocaleString('en-US')} USDC`} />
      <Row label="Liquidation price" value={`$${liquidationPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })} / ETH`} />
      <Row label="Market liquidity" value={<Pill>Feed not connected</Pill>} />
      <p className="explain">The actual borrow is capped by available market liquidity. Opening above that cap will be blocked before signing.</p>
    </Card></div>
    <div className="page-actions"><ButtonLink to="take">Preview withdrawal</ButtonLink></div>
  </>
}

function Take() {
  return <>
    <Intro eyebrow="05 / Receive the loan" title="Take the USDC">Borrowed USDC first arrives at your position address. Only your owner-signed message can move it to your wallet.</Intro>
    <Card title="Withdraw USDC"><Row label="Available at position" value="Not connected" /><Row label="Destination" value="Connected wallet" /><Placeholder>Wallet address and token balance will appear here after opening a real testnet loan. The withdraw action is not enabled in this preview.</Placeholder></Card>
    <div className="page-actions"><ButtonLink to="dashboard">View example loan</ButtonLink></div>
  </>
}

function Dashboard() {
  return <>
    <Intro eyebrow="06 / Position" title="My loan">A sample WETH / USDC position. Live values will come from Morpho, the executor and the market oracle.</Intro>
    <div className="hero-grid"><Card title="Loan balance" subtitle="Morpho · WETH / USDC · Base Sepolia"><div className="hero-number">2,500 <span>USDC</span></div><Row label="Collateral" value="2.000 WETH · $5,000" /><Row label="Liquidation price" value="$1,453 / ETH" /></Card><Card title="Position health" subtitle="At $2,500 per ETH"><div className="hero-number">50.0<span>% LTV</span></div><Band /><p className="explain">Agent acts at 70% LTV. Morpho can liquidate at 86% LTV. These are example values.</p></Card></div>
    <Card title="Autopilot" subtitle="Registration and watching are separate states."><Row label="Agent key" value={<Pill>Not connected</Pill>} /><Row label="Last check" value="No live check" /><Row label="Today's budget" value="Sold 0% of 20% · Moves 0 of 2" /><div className="card-actions"><ButtonLink to="change" secondary>View rules</ButtonLink></div></Card>
    <Card title="Decision feed" subtitle="Newest actions will appear first."><Placeholder>No chain events connected. The interactive demo shows an example price drop and Reduce action.</Placeholder><div className="card-actions"><a className="button button--secondary" href="/prototype/index.html?demo=markets">Open interactive prototype <span aria-hidden="true">↗</span></a></div></Card>
  </>
}

function Change() {
  return <><Intro eyebrow="07 / Manage" title="Change your rules">Review your corridor, agent version and access before signing a change.</Intro>
    <Card title="Corridor"><Row label="Floor · Target · Agent acts" value="30% · 50% · 70%" /><Row label="Markets" value="Live and backup" /><Placeholder>Editing and signing a corridor change will be enabled after the live vault is connected.</Placeholder></Card>
    <Card title="Agent access"><Row label="Approved version" value={<Pill>Not connected</Pill>} /><Row label="Watching" value="Unknown" /><p className="explain">Revoking access deletes the agent key. Previously signed calls may remain valid for up to 10 minutes. Your loan stays open.</p></Card>
    <div className="page-actions"><ButtonLink to="verify" secondary>Review verification</ButtonLink></div>
  </>
}

function Leave() {
  return <><Intro eyebrow="08 / Leave" title="Repay and leave">Repay debt in each market, then withdraw the remaining WETH and USDC to your wallet.</Intro>
    <Card title="1 · Repay"><Row label="Market" value="Choose the market with higher LTV first" /><Row label="USDC needed" value="Debt plus 1% headroom" /><p className="explain">If your position address has too little USDC, transfer the missing amount from your wallet first. A split position needs one owner message per market.</p></Card>
    <Card title="2 · Withdraw"><Row label="WETH" value="Returned to your position address" /><Row label="Unused USDC" value="Withdraw separately" /><Placeholder>No live balances or signatures are connected in this preview.</Placeholder></Card>
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
  return <><Intro eyebrow="10 / Demo" title="Demo scenes">The planned scenes compare outcomes on the same price path. Scene data and testnet receipts are not connected to this React app yet.</Intro>
    <Placeholder>The existing interactive prototype remains available. Its values are local examples, with no testnet transactions.</Placeholder>
    <div className="scene-list">{scenes.map(([title, signal, description], index) => <Card key={title} className="scene"><div className="scene__number">0{index + 1}</div><div><h2>{title}</h2><strong>{signal}</strong><p>{description}</p></div><Pill>Planned</Pill></Card>)}</div>
    <div className="page-actions"><a className="button" href="/prototype/index.html?demo=markets">Open interactive prototype <span aria-hidden="true">↗</span></a></div>
  </>
}

const screen: Record<Page, React.ComponentType> = {
  connect: Connect, create: Create, agent: Agent, deposit: Deposit, take: Take,
  dashboard: Dashboard, change: Change, leave: Leave, verify: Verify, scenes: Scenes,
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
createRoot(document.getElementById('root')!).render(<WagmiProvider config={walletConfig}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></WagmiProvider>)
