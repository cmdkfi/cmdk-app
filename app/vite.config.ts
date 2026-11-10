import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// __SANDBOX__ (flow/build.ts): the sandbox ships in every build since Phase 6b (PRD §8a); VITE_SANDBOX=0 leaves it out.
export default defineConfig({ plugins: [react()], define: { __SANDBOX__: JSON.stringify(process.env.VITE_SANDBOX !== '0') } })
