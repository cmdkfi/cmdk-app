import { useEffect, useState, type ReactNode } from 'react'
import { useAdapters, useWalletLabel, useWallets, useWalletState } from '../adapters/AdapterProvider.tsx'
import { useAccountKind, useAppConfig, useDiscovery, useMarketQuote, useRelayerReadiness, useWalletFunding } from '../components/data.ts'
import { newRecord, resumeStep } from '../flow/onboarding.ts'
import { loadRecord, saveRecord } from '../flow/onboarding-record.ts'
import { checkDeposit, defaultDeposit } from '../flow/amount.ts'
import { fundingNeed } from '../flow/funding.ts'
import type { AddChainParams, Guided } from '../flow/config.ts'
import { connectionError, formatUnits, shortAddress } from '../flow/format.ts'
import { useNow } from '../components/use-now.ts'
import { DiscoveryBanner, Unavailable, useSessionValue, type ScreenProps } from './common.tsx'

const BASE_SEPOLIA = 84532
const eth = (wei: bigint) => `${formatUnits(wei, 18, 6)} ETH`

function NetworkHelp({ network, docs }: { network: AddChainParams; docs: string }) {
  return <details className="network-help">
    <summary className="muted small">Having trouble switching networks? Add Base Sepolia manually</summary>
    <dl className="rows small" style={{ marginTop: 8 }}>
      <div className="row"><dt className="k">Network name</dt><dd className="v">{network.chainName}</dd></div>
      <div className="row"><dt className="k">RPC URL</dt><dd className="v">{network.rpcUrls[0]}</dd></div>
      <div className="row"><dt className="k">Chain ID</dt><dd className="v">{parseInt(network.chainId, 16)}</dd></div>
      <div className="row"><dt className="k">Currency</dt><dd className="v">{network.nativeCurrency.symbol}</dd></div>
      <div className="row"><dt className="k">Explorer</dt><dd className="v">{network.blockExplorerUrls[0]}</dd></div>
    </dl>
    <a className="small" href={docs} target="_blank" rel="noreferrer">Base docs: connecting to Base</a>
  </details>
}

/** S3a: inline help panel; never blocks the rest of the screen (PRD S3a, FR-17). */
function GetEth({ address, missing, guided, checkedAt, onClose }: { address: string; missing: bigint; guided: Guided; checkedAt: number; onClose: () => void }) {
  const now = useNow()
  const [copied, setCopied] = useState(false)
  return <aside className="help" aria-labelledby="get-eth-title">
    <div className="card-head">
      <h2 id="get-eth-title">Get Base Sepolia ETH</h2>
      <span className="tag warn">{eth(missing)} missing</span>
    </div>
    <p className="muted small">Testnet ETH is free. Request it from one of these faucets, then come back. This page checks your balance every 10 seconds and continues by itself.</p>
    <div className="addr"><span>{address}</span>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined) }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <ol>
      {guided.help.ethFaucets.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a> <span className="muted small">— {link.note}</span></li>)}
    </ol>
    <p className="muted small">Limits apply, usually one request per day per faucet.</p>
    <p className="small" role="status"><span className="pulse" aria-hidden="true" />Waiting for funds… last checked {Math.max(0, Math.round(now - checkedAt / 1000))} s ago</p>
    <button type="button" className="btn ghost" style={{ justifySelf: 'start', paddingLeft: 0 }} onClick={onClose}>Close</button>
  </aside>
}

export function Connect({ mode, href, banner, discovery }: ScreenProps & { discovery: ReturnType<typeof useDiscovery> }) {
  const { wallet, protocol } = useAdapters()
  const quote = useMarketQuote()
  const state = useWalletState()
  const wallets = useWallets()
  const label = useWalletLabel()
  const app = useAppConfig()
  const guided = app.data?.guided
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [panelClosed, setPanelClosed] = useState(false)
  const [text] = useSessionValue(mode, 'amount', defaultDeposit(mode))
  const check = guided ? checkDeposit(text, guided.minDepositWei) : { kind: 'empty' as const }
  const amount = check.kind === 'ok' ? check.wei : null
  const onBase = state.status === 'connected' && state.chainId === BASE_SEPOLIA
  const owner = onBase ? state.address : undefined
  const account = useAccountKind(owner)
  const funding = useWalletFunding(account.data && account.data !== 'contract' ? owner : undefined, amount, data => amount !== null && fundingNeed(amount, data).enough)
  const need = funding.data && amount !== null ? fundingNeed(amount, funding.data) : null
  const creationNeeded = discovery.entry.kind === 'found' && discovery.entry.status === null
  const relayer = useRelayerReadiness(onBase && creationNeeded)
  useEffect(() => { if (need?.enough) setPanelClosed(false) }, [need?.enough])

  const act = (action: () => Promise<void>) => async () => {
    setError(null); setBusy(true)
    try { await action() } catch (cause) { setError(connectionError(cause instanceof Error ? cause : new Error(String(cause)))) } finally { setBusy(false) }
  }

  let body
  if (!guided) {
    body = <p className="notice" role={app.isError ? 'alert' : 'status'}>{app.isError ? 'The app configuration could not be loaded.' : 'Loading…'}</p>
  } else if (state.status === 'disconnected' && wallets.length === 0) {
    body = <section className="surface stack-20" style={{ maxWidth: 640 }}>
      <p>No browser wallet was found. This testnet app works with a wallet extension on desktop, such as MetaMask, Rabby, Coinbase Wallet, Brave or OKX.</p>
      <a className="btn primary" style={{ justifySelf: 'start' }} href={guided.help.metamaskInstall} target="_blank" rel="noreferrer">Install a wallet</a>
    </section>
  } else if (state.status === 'disconnected') {
    // PRD S3 (10 Nov): every injected wallet announced through EIP-6963, plus window.ethereum when not announced
    // the list in the catalogue's tile style (docs/mockups/Main.dc.html .tile); S3 has no artboard for this state
    body = <section className="surface stack" style={{ maxWidth: 640 }}>
      <ul className="plain-list" aria-label="Wallets in this browser">
        {wallets.map(option => <li key={option.id}><button type="button" className="tile wallet-option" disabled={busy} onClick={act(() => wallet.connect(option.id))}>
          {option.icon ? <img src={option.icon} alt="" width={28} height={28} /> : <span className="token venue" aria-hidden="true" />}<span className="label">{option.name}</span>
        </button></li>)}
      </ul>
    </section>
  } else if (state.status === 'connecting') {
    body = <p className="notice" role="status"><span className="pulse" aria-hidden="true" />Waiting for your wallet…</p>
  } else if (!onBase) {
    body = <section className="surface stack-20" style={{ maxWidth: 640 }}>
      <p>Your wallet is on another network. Switch to Base Sepolia; if the wallet does not know it yet, it asks you to add it with the values below.</p>
      <button type="button" className="btn primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={act(() => wallet.switchToBaseSepolia(guided.network))}>Switch to Base Sepolia</button>
      <NetworkHelp network={guided.network} docs={guided.help.connectingToBase} />
    </section>
  } else {
    const address = state.address
    const kindText = account.data === 'plain' ? 'Plain account (supported)' : account.data === 'delegated' ? 'EIP-7702 delegated account (supported)' : account.data === 'contract' ? 'Contract wallet (not supported)' : account.isError ? null : 'checking…'
    let positionText: ReactNode
    const d = discovery.entry
    if (d.kind === 'checking' || d.kind === 'not-checked') positionText = 'Checking your vaults…'
    else if (d.kind === 'failed') positionText = <Unavailable>could not be read</Unavailable>
    else if (d.status === null) positionText = 'None for this wallet'
    else positionText = `${discovery.result?.summary?.vault.accountId ?? 'Found'}${d.status === 'ready' ? ' · ready for a deposit' : ''}`

    const blocked = account.data === 'contract'
    const status = d.kind === 'found' ? d.status : undefined
    const summary = discovery.result?.summary
    // Create position needs every precondition known and true; each blocking reason is stated (PRD S3).
    let createReason: string | null = null
    if (d.kind === 'failed') createReason = 'Your vaults could not be read, so a position cannot be created. Retry above.'
    else if (d.kind !== 'found') createReason = 'Checking your vaults…'
    else if (blocked) createReason = 'Contract wallets are not supported.'
    else if (amount === null) createReason = 'Choose how much ETH to deposit first.'
    else if (!need) createReason = 'Reading your balances…'
    else if (!need.enough) createReason = 'Your wallet needs more Base Sepolia ETH (see above).'
    else if (status !== null && status !== 'setup' && status !== 'ready' && status !== 'deposited') createReason = 'This wallet already has a position.'
    else if (status !== null && !summary) createReason = 'Checking your vault…'
    else if (creationNeeded && relayer.data?.kind !== 'ready') createReason = relayer.isError || relayer.data ? 'Creation is temporarily unavailable.' : 'Checking the relayer…'
    // An onboarding record that already names a vault is never overwritten: S3 returns to S4 where it stopped.
    const paused = app.data ? loadRecord(mode, app.data.config.near.factory, address) : null
    const resume = !!paused?.vault
    const create = () => {
      if (resume) { window.location.hash = href('progress'); return }
      if (createReason !== null || amount === null || !app.data) return
      const estimate = quote.data ? protocol.estimateDeposit(app.data, quote.data, amount) : null
      const shownLtv = estimate ? (estimate.limited ? estimate.resultingLtv : BigInt(guided.corridor.target) * 10n ** 16n) : null
      saveRecord(mode, newRecord({
        factory: app.data.config.near.factory, owner: address, amountWei: amount, shownLtv, now: Date.now(), autostart: true,
        vault: summary ? { accountId: summary.vault.accountId, number: summary.vault.number, baseAddress: summary.vault.baseAddress } : undefined,
        resumeAt: resumeStep(status ?? null),
      }))
      window.location.hash = href('progress')
    }

    const row = (k: ReactNode, v: ReactNode, alert = false) => <div className={`row${alert ? ' row--alert' : ''}`} role={alert ? 'alert' : undefined}><dt className="k">{k}</dt><dd className="v">{v}</dd></div>
    // docs/mockups/S3-Connect: wallet facts, the one click and Back in a surface; the S3a panel beside it
    body = <div className="split-11">
      <section className="surface stack-20" aria-label="Wallet">
        <dl className="rows facts" style={{ margin: 0 }}>
          {row('Wallet', `${state.walletName ?? 'Browser wallet'} · ${shortAddress(address)}`)}
          {row('Network', <span className="tag ok">Base Sepolia</span>)}
          {row('Account type', kindText ?? <Unavailable />)}
          {blocked && row('Not supported', 'This address is a contract wallet. Vault owner messages are verified with ecrecover, which only an externally owned key can satisfy. Connect a regular account (an externally owned key).', true)}
          {!blocked && <>
            {row('Base Sepolia ETH', funding.data ? eth(funding.data.eth) : amount === null ? '—' : funding.isError ? <Unavailable /> : 'reading…')}
            {funding.data && funding.data.weth > 0n && row('WETH in wallet', eth(funding.data.weth).replace('ETH', 'WETH'))}
            {amount === null
              ? row('Deposit', <a href={href('start')}>Choose an amount first</a>)
              : row(`Needed for ${eth(amount)} deposit`, need
                ? <>{need.wrap > 0n ? `${eth(need.wrap)} to wrap` : 'WETH already in wallet'} + ~{eth(need.gas)} gas ({need.transactions} {need.transactions === 1 ? 'transaction' : 'transactions'}) = <strong>{eth(need.required)}</strong> <span className={need.enough ? 'tag ok' : 'tag warn'}>{need.enough ? 'Enough' : `${eth(need.missing)} missing`}</span></>
                : funding.isError ? <><Unavailable /> <button type="button" className="link-button" onClick={() => { void funding.refetch() }}>Retry</button></> : 'reading…')}
          </>}
          {row('Existing position', positionText)}
          {creationNeeded && relayer.data && relayer.data.kind !== 'ready' && row('Creation temporarily unavailable', relayer.data.message, true)}
          {creationNeeded && relayer.isError && row('Creation temporarily unavailable', 'The relayer could not be reached.', true)}
        </dl>
        <div className="stack-10 create-action">
          <button type="button" className="btn primary" disabled={!resume && createReason !== null} aria-describedby="create-reason" onClick={create}>{resume ? 'Continue where you left off' : status === 'ready' ? 'Deposit' : 'Create position'}</button>
          {resume ? <p id="create-reason" className="small">Your position is being set up on vault {paused!.vault!.accountId}; continue on the progress screen.</p> : createReason && <p id="create-reason" className="small">{createReason}</p>}
          <p className="muted small create-action__small">This is the only click: every signature and transaction after it is requested automatically, and you only act inside {label}.</p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><a className="btn ghost" href={href('settings')}>Back</a></div>
        <NetworkHelp network={guided.network} docs={guided.help.connectingToBase} />
      </section>
      {need && !need.enough && !panelClosed && <GetEth address={address} missing={need.missing} guided={guided} checkedAt={funding.dataUpdatedAt} onClose={() => setPanelClosed(true)} />}
    </div>
  }

  const connected = state.status === 'connected' && onBase && !!guided
  return <section className="page" aria-labelledby="screen-title">
    <DiscoveryBanner banner={banner} />
    <div className="page-head">
      <h1 id="screen-title">Connect wallet</h1>
      <p className="muted">A desktop browser wallet on Base Sepolia. The app switches the network for you, or adds it, with your wallet's own confirmation.</p>
    </div>
    {body}
    {error && <p className="notice notice--warning" role="alert">{error}</p>}
    {!connected && <div className="page-actions"><a className="btn ghost" href={href('settings')}>Back</a></div>}
  </section>
}
