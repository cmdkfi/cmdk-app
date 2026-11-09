import { useEffect, useState, type ReactNode } from 'react'
import { useAdapters, useWalletState } from '../adapters/AdapterProvider.tsx'
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
    <summary>Having trouble switching networks? Add Base Sepolia manually</summary>
    <dl>
      <div><dt>Network name</dt><dd>{network.chainName}</dd></div>
      <div><dt>RPC URL</dt><dd>{network.rpcUrls[0]}</dd></div>
      <div><dt>Chain ID</dt><dd>{parseInt(network.chainId, 16)}</dd></div>
      <div><dt>Currency</dt><dd>{network.nativeCurrency.symbol}</dd></div>
      <div><dt>Explorer</dt><dd>{network.blockExplorerUrls[0]}</dd></div>
    </dl>
    <a href={docs} target="_blank" rel="noreferrer">Base docs: connecting to Base</a>
  </details>
}

/** S3a: inline help panel; never blocks the rest of the screen (PRD S3a, FR-17). */
function GetEth({ address, missing, guided, checkedAt, onClose }: { address: string; missing: bigint; guided: Guided; checkedAt: number; onClose: () => void }) {
  const now = useNow()
  const [copied, setCopied] = useState(false)
  return <section className="help-panel prototype-surface" aria-labelledby="get-eth-title">
    <div className="help-panel__head">
      <h2 id="get-eth-title">Get Base Sepolia ETH</h2>
      <span className="help-panel__missing">{eth(missing)} missing</span>
      <button type="button" className="prototype-button help-panel__close" onClick={onClose}>Close</button>
    </div>
    <p>Testnet ETH is free. Request it from one of these faucets, then come back. This page checks your balance every 10 seconds and continues by itself.</p>
    <div className="help-panel__address"><code>{address}</code>
      <button type="button" className="prototype-button" onClick={() => { void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined) }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <ul className="help-panel__links">
      {guided.help.ethFaucets.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a> <span>— {link.note}</span></li>)}
    </ul>
    <p className="help-panel__small">Limits apply, usually one request per day per faucet.</p>
    <p className="help-panel__small" role="status">Waiting for funds… last checked {Math.max(0, Math.round(now - checkedAt / 1000))} s ago</p>
  </section>
}

export function Connect({ mode, href, banner, discovery }: ScreenProps & { discovery: ReturnType<typeof useDiscovery> }) {
  const { wallet, protocol } = useAdapters()
  const quote = useMarketQuote()
  const state = useWalletState()
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
  } else if (state.status === 'disconnected' && !wallet.hasMetaMask()) {
    body = <div className="connect-state">
      <p>MetaMask is not installed in this browser. This testnet app works with the MetaMask extension on desktop only.</p>
      <a className="prototype-button is-primary" href={guided.help.metamaskInstall} target="_blank" rel="noreferrer">Install MetaMask</a>
    </div>
  } else if (state.status === 'disconnected') {
    body = <div className="connect-state">
      <button type="button" className="prototype-button is-primary" disabled={busy} onClick={act(() => wallet.connect())}>Connect MetaMask</button>
    </div>
  } else if (state.status === 'connecting') {
    body = <p className="notice" role="status">Waiting for MetaMask…</p>
  } else if (!onBase) {
    body = <div className="connect-state">
      <p>MetaMask is on another network. Switch to Base Sepolia; if MetaMask does not know it yet, it asks you to add it with the values below.</p>
      <button type="button" className="prototype-button is-primary" disabled={busy} onClick={act(() => wallet.switchToBaseSepolia(guided.network))}>Switch to Base Sepolia</button>
      <NetworkHelp network={guided.network} docs={guided.help.connectingToBase} />
    </div>
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

    body = <>
      <dl className="facts prototype-surface">
        <div><dt>Wallet</dt><dd>MetaMask · {shortAddress(address)}</dd></div>
        <div><dt>Network</dt><dd>Base Sepolia</dd></div>
        <div><dt>Account type</dt><dd>{kindText ?? <Unavailable />}</dd></div>
        {blocked && <div className="facts__alert" role="alert"><dt>Not supported</dt><dd>This address is a contract wallet. Vault owner messages are verified with ecrecover, which only an externally owned key can satisfy. Connect a regular MetaMask account.</dd></div>}
        {!blocked && <>
          <div><dt>Base Sepolia ETH</dt><dd>{funding.data ? eth(funding.data.eth) : amount === null ? '—' : funding.isError ? <Unavailable /> : 'reading…'}</dd></div>
          {funding.data && funding.data.weth > 0n && <div><dt>WETH in wallet</dt><dd>{eth(funding.data.weth).replace('ETH', 'WETH')}</dd></div>}
          {amount === null
            ? <div><dt>Deposit</dt><dd><a href={href('start')}>Choose an amount first</a></dd></div>
            : <div><dt>Needed for {eth(amount)} deposit</dt><dd>{need
              ? <>{need.wrap > 0n ? `${eth(need.wrap)} to wrap` : 'WETH already in wallet'} + ~{eth(need.gas)} gas ({need.transactions} {need.transactions === 1 ? 'transaction' : 'transactions'}) = <strong>{eth(need.required)}</strong> <span className={need.enough ? 'tag tag--good' : 'tag tag--warn'}>{need.enough ? 'Enough' : `${eth(need.missing)} missing`}</span></>
              : funding.isError ? <><Unavailable /> <button type="button" className="link-button" onClick={() => { void funding.refetch() }}>Retry</button></> : 'reading…'}</dd></div>}
        </>}
        <div><dt>Existing position</dt><dd>{positionText}</dd></div>
        {creationNeeded && relayer.data && relayer.data.kind !== 'ready' && <div className="facts__alert" role="alert"><dt>Creation temporarily unavailable</dt><dd>{relayer.data.message}</dd></div>}
        {creationNeeded && relayer.isError && <div className="facts__alert" role="alert"><dt>Creation temporarily unavailable</dt><dd>The relayer could not be reached.</dd></div>}
      </dl>
      {need && !need.enough && !panelClosed && <GetEth address={address} missing={need.missing} guided={guided} checkedAt={funding.dataUpdatedAt} onClose={() => setPanelClosed(true)} />}
      <div className="create-action">
        <button type="button" className="prototype-button is-primary" disabled={!resume && createReason !== null} aria-describedby="create-reason" onClick={create}>{resume ? 'Continue where you left off' : status === 'ready' ? 'Deposit' : 'Create position'}</button>
        {resume ? <p id="create-reason">Your position is being set up on vault {paused!.vault!.accountId}; continue on the progress screen.</p> : createReason && <p id="create-reason">{createReason}</p>}
        <p className="create-action__small">This is the only click: every signature and transaction after it is requested automatically, and you only act inside MetaMask.</p>
      </div>
      <NetworkHelp network={guided.network} docs={guided.help.connectingToBase} />
    </>
  }

  return <section className="screen screen--wide" aria-labelledby="screen-title">
    <DiscoveryBanner banner={banner} />
    <h1 id="screen-title">Connect MetaMask</h1>
    <p className="screen__lead">Desktop MetaMask on Base Sepolia. The app switches the network for you, or adds it, with MetaMask's own confirmation.</p>
    {body}
    {error && <p className="notice notice--warning" role="alert">{error}</p>}
    <div className="screen__actions"><a className="prototype-button" href={href('settings')}>Back</a></div>
  </section>
}
