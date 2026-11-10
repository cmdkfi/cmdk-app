// FR-16 / D9: below 960px the app is replaced by this notice (CSS media query in shell.css).
export function DesktopGate() {
  return <section className="desktop-gate" aria-labelledby="desktop-gate-title">
    <span className="shell-brand" aria-hidden="true">⌘K</span>
    <h1 id="desktop-gate-title">Open cmdk on a desktop browser</h1>
    <p>This testnet app is built for screens at least 960 px wide with a browser wallet extension. Smaller screens are not supported.</p>
  </section>
}
