/** The footer of every screen (honesty rules: testnet, unaudited, not insurance), shared by the shell and the phone notice. */
export function Footer() {
  return <footer className="footer">
    <span>Runs on NEAR testnet and Base Sepolia. Unaudited. No real money.<br />Agent protection is risk management, not insurance.</span>
    <a href="https://github.com/cmdkfi/app" target="_blank" rel="noreferrer">Protocol source</a>
  </footer>
}
