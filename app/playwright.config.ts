import {defineConfig,devices} from '@playwright/test'
export default defineConfig({
 testDir:'./e2e',fullyParallel:true,forbidOnly:!!process.env.CI,retries:process.env.CI?1:0,workers:process.env.CI?2:undefined,
 reporter:[['list'],['html',{open:'never'}]],timeout:30000,
 // Phase 9 screenshots: one baseline set per platform (darwin for local runs, linux for CI and the deploy workflow)
 snapshotPathTemplate:'{testDir}/__screenshots__/{platform}/{arg}{ext}',
 use:{channel:process.env.CMDK_TEST_CHROME==='1'?'chrome':undefined,baseURL:'http://localhost:5177',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'block'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}}],
 webServer:{command:'pnpm exec vite --host localhost --port 5177 --strictPort',url:'http://localhost:5177',reuseExistingServer:false},
})
