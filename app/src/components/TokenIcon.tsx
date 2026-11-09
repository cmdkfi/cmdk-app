export function TokenIcon({ asset }: { asset: 'ETH' | 'WETH' | 'USDC' }) {
  return <span className={`token-icon token-icon--${asset.toLowerCase()}`} aria-hidden="true"><img src={`/tokens/${asset.toLowerCase()}.png`} alt="" width="24" height="24" />{asset === 'WETH' && <span className="token-icon-wrap">W</span>}</span>
}
