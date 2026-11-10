// "Show USDC in MetaMask" (Phase 7b): wallet_watchAsset (EIP-747) for the USDC of config.json, with the symbol and
// decimals read from the token. Borrowed USDC is in the wallet after the withdraw step, but MetaMask lists a token only
// once it is imported (9 Nov rehearsal). The result line repeats only what the wallet answered.
import { useState } from 'react'
import { useAdapters } from '../adapters/AdapterProvider.tsx'
import { useAppConfig } from './data.ts'
import { message, rejected } from './runner.ts'

export const SHOW_USDC = 'Show USDC in MetaMask'

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

const RESULT: Record<Exclude<Asked['kind'], 'idle' | 'failed'>, string> = {
  asking: 'Waiting for MetaMask…',
  accepted: 'MetaMask accepted USDC.',
  declined: 'MetaMask did not add USDC.',
}

export function ShowUsdcButton() {
  const { asked, ask } = useShowUsdc()
  return <span className="show-usdc">
    <button type="button" className="link-button" disabled={asked.kind === 'asking'} onClick={ask}>{SHOW_USDC}</button>
    {asked.kind !== 'idle' && <span className="show-usdc__result" role="status">{asked.kind === 'failed' ? `MetaMask could not add USDC: ${asked.error}` : RESULT[asked.kind]}</span>}
  </span>
}
