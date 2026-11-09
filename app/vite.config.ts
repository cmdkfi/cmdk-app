import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// __SANDBOX__ (flow/build.ts): the sandbox is left out of every build until Phase 6b re-enables it with VITE_SANDBOX=1.
export default defineConfig({ plugins: [react()], define: { __SANDBOX__: JSON.stringify(process.env.VITE_SANDBOX === '1') } })
