// "Show USDC in <wallet>" (Phase 7b; wallet name since Phase 8): wallet_watchAsset (EIP-747) for the USDC of
// config.json, with the symbol and decimals read from the token. Borrowed USDC is in the wallet after the withdraw step,
// but MetaMask lists a token only once it is imported (9 Nov rehearsal). The result line repeats only what the wallet
// answered.
import { useState } from 'react'
import { useAdapters, useWalletLabel, useWalletState } from '../adapters/AdapterProvider.tsx'
import { useAppConfig } from './data.ts'
import { message, rejected } from './runner.ts'

export const showUsdcLabel = (walletName: string | null) => `Show USDC in ${walletName ?? 'your wallet'}`

type Asked = { kind: 'idle' } | { kind: 'asking' } | { kind: 'accepted' } | { kind: 'declined' } | { kind: 'failed'; error: string }

export function useShowUsdc() {
  const { protocol, wallet } = useAdapters()
  const app = useAppConfig().data
  const [asked, setAsked] = useState<Asked>({ kind: 'idle' })
  const ask = async () => {
    if (!app || asked.kind === 'asking') return
    setAsked({ kind: 'asking' })
    try {
      const usdc = await protocol.readUsdcAsset(app)
      const accepted = await wallet.watchAsset({ ...usdc, image: `${window.location.origin}/tokens/usdc.png` })
      setAsked({ kind: accepted ? 'accepted' : 'declined' })
    } catch (error) {
      setAsked(rejected(error) ? { kind: 'declined' } : { kind: 'failed', error: message(error) })
    }
  }
  return { asked, ask: () => { void ask() } }
}

const result = (kind: Exclude<Asked['kind'], 'idle' | 'failed'>, wallet: string) => ({
  asking: `Waiting for ${wallet}…`,
  accepted: `${capital(wallet)} accepted USDC.`,
  declined: `${capital(wallet)} did not add USDC.`,
})[kind]
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function ShowUsdcButton() {
  const { asked, ask } = useShowUsdc()
  const state = useWalletState()
  const wallet = useWalletLabel()
  return <span className="show-usdc">
    <button type="button" className="link-button" disabled={asked.kind === 'asking'} onClick={ask}>{showUsdcLabel(state.status === 'connected' ? state.walletName : null)}</button>
    {asked.kind !== 'idle' && <span className="show-usdc__result" role="status">{asked.kind === 'failed' ? `${capital(wallet)} could not add USDC: ${asked.error}` : result(asked.kind, wallet)}</span>}
  </span>
}
