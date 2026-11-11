import { createConfig, http } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// Any injected wallet (PRD S3, FR-3; Phase 8): wagmi's EIP-6963 discovery (multiInjectedProviderDiscovery, on by
// default) adds one connector per announced wallet with its name and icon; the generic `injected()` connector covers a
// `window.ethereum` that does not announce itself. The same injected connector supports mobile wallet browsers; no WalletConnect relay is configured.
export function createWagmiConfig() {
  return createConfig({
    chains: [baseSepolia],
    connectors: [injected()],
    multiInjectedProviderDiscovery: true,
    transports: { [baseSepolia.id]: http() },
  })
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>
