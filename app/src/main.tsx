import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './components/App.tsx'
import './styles/base.css'
import './styles/prototype-controls.css'
import './styles/ltv-track.css'
import './styles/shell.css'
import './styles/screens.css'

document.documentElement.dataset.theme = 'dark'
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <App />
  </QueryClientProvider>,
)
