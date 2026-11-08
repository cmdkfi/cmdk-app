import {defineConfig,devices} from '@playwright/test'
export default defineConfig({
 testDir:'./e2e',fullyParallel:true,forbidOnly:!!process.env.CI,retries:process.env.CI?1:0,workers:process.env.CI?2:undefined,
 reporter:[['list'],['html',{open:'never'}]],timeout:30000,
 use:{baseURL:'http://localhost:5177',trace:'retain-on-failure',screenshot:'only-on-failure',serviceWorkers:'block'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}},{name:'mobile',use:{...devices['Pixel 5']}}],
 webServer:{command:'pnpm exec vite --host localhost --port 5177 --strictPort',url:'http://localhost:5177',reuseExistingServer:false},
})
