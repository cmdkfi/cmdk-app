import { createConfig, http } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// MetaMask only (PRD §3, §8). EIP-6963 discovery stays on so MetaMask's announced
// provider (rdns io.metamask) is preferred over window.ethereum when both exist.
export function createWagmiConfig() {
  return createConfig({
    chains: [baseSepolia],
    connectors: [injected({ target: 'metaMask' })],
    transports: { [baseSepolia.id]: http() },
  })
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>
