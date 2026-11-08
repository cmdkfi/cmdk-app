import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { walletConfig } from './wallet.ts'
import { VaultSelectionProvider } from './VaultSelectionContext.tsx'
import { VaultHome } from './VaultHome.tsx'
import './styles.css'
function App() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark'
    const url = new URL(window.location.href)
    url.searchParams.delete('demo')
    window.history.replaceState(null, '', url)
    const changed = () => setHash(window.location.hash)
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const page = hash.slice(1).split(/[/?]/)[0]
  return <VaultHome activity={page === 'activity'} detail={page === 'vault'} create={page === 'create'} />
}
createRoot(document.getElementById('root')!).render(<WagmiProvider config={walletConfig}><QueryClientProvider client={new QueryClient()}><VaultSelectionProvider><App /></VaultSelectionProvider></QueryClientProvider></WagmiProvider>)
