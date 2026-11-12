import {defineConfig,devices} from '@playwright/test'
export default defineConfig({
 testDir:'./e2e',fullyParallel:true,forbidOnly:!!process.env.CI,retries:process.env.CI?1:0,workers:process.env.CI?2:undefined,
 reporter:[['list'],['html',{open:'never'}]],timeout:30000,
 // Phase 9 screenshots: one baseline set per platform (darwin for local runs, linux for CI and the deploy workflow)
 snapshotPathTemplate:'{testDir}/__screenshots__/{platform}/{arg}{ext}',
 use:{channel:process.env.CMDK_TEST_CHROME==='1'?'chrome':undefined,baseURL:'http://localhost:5177',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'block'},
 projects:[
  {name:'desktop',testIgnore:'**/mobile.spec.ts',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}},
  // the testnet flow is desktop-only (11 Nov 2026): on a phone the live routes show one notice and the sandbox runs, so the
  // mobile project runs the notice, the sandbox end to end and its screenshots (visual.spec.ts skips the live ones there)
  {name:'mobile',testMatch:['**/mobile.spec.ts','**/sandbox.spec.ts','**/visual.spec.ts'],use:{...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1}},
 ],
 // Phase 12: a production build served once by `vite preview` instead of the dev server. The dev server is one Node process
 // transforming hundreds of unbundled modules per page load for every worker at once; with four workers the six-step
 // scenarios took 13 s each (1.7–2.4 s alone) and timed out on loaded machines (an external review run, 10 Nov).
 webServer:{command:'pnpm exec vite build --outDir dist-e2e --logLevel warn && pnpm exec vite preview --outDir dist-e2e --host localhost --port 5177 --strictPort',url:'http://localhost:5177',reuseExistingServer:false,timeout:120000},
})
