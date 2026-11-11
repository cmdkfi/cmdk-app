// Desktop-only testnet flow (product owner, 11 Nov 2026): below 960 px a live route renders this notice instead of its
// screen, with the sandbox as its only action. Inside MetaMask Mobile's in-app browser the first signature (personal_sign
// for setup) fails with -32602 "must provide an Ethereum address" (MetaMask Mobile 8.18, per-network site permissions;
// MetaMask/metamask-mobile#39052), and the live flow is not supported on phones before the submission.
// App.tsx renders this without an AdapterProvider: no live adapter is constructed, so no wallet call (no silent
// reconnect), no relayer call and no NEAR or Base read happens at this width. The sandbox (#sandbox/…) is unaffected.
import { SANDBOX } from '../flow/build.ts'
import { Footer } from './Footer.tsx'
import { TryInSandbox } from './Sandbox.tsx'

export const PHONE_NOTICE = 'The testnet flow runs on a desktop browser with a wallet extension.'
export const PHONE_SANDBOX = 'On a phone, try the sandbox: a simulated wallet and protocol, nothing touches Base Sepolia or NEAR.'

export function PhoneNotice() {
  return <div className="shell">
    <header className="header">
      <div className="header-inner">
        <a className="brand" href="#start" aria-label="cmdk home">⌘K cmdk</a>
        <div className="header-actions"><span className="chip">Testnet · Base Sepolia · no real funds</span></div>
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="main">
      <section className="page" aria-labelledby="screen-title">
        <div className="page-head">
          <h1 id="screen-title">{PHONE_NOTICE}</h1>
          {SANDBOX && <p className="muted">{PHONE_SANDBOX}</p>}
        </div>
        {SANDBOX && <div className="page-actions"><TryInSandbox /></div>}
      </section>
    </main>
    <Footer />
  </div>
}
