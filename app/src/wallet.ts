import { createConfig, http } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { coinbaseWallet, injected } from 'wagmi/connectors'

export const walletConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected(), coinbaseWallet({ appName: 'cmdk', preference: { options: 'eoaOnly' } })],
  transports: { [baseSepolia.id]: http() },
})
