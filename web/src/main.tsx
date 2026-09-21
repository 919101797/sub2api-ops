import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App'
import { AppearanceProvider, initializeAppearance } from './components/Appearance'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
})
const initialAppearance = initializeAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider initialPreference={initialAppearance}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppearanceProvider>
  </StrictMode>,
)
