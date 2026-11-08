import type {MarketPosition} from '../src/positions.ts'
export const OWNER='0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'
export const BASE='0x1563915e194D8CfBA1943570603F7606A3115508'
export const OTHER='0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB'
export const EXECUTOR='0x4444444444444444444444444444444444444444'
export const MORPHO='0x5555555555555555555555555555555555555555'
export const WETH='0x4200000000000000000000000000000000000006'
export const USDC='0x036CbD53842c5426634e7929541eC2318f3dCF7e'
export const LIVE=('0x'+'aa'.repeat(32)) as `0x${string}`,BACKUP=('0x'+'bb'.repeat(32)) as `0x${string}`
export const VAULT='v1.fixture.testnet',KEY=`cmdk-live-action:${VAULT}:${OWNER}`,NOW=2000000000
export const vault={accountId:VAULT,number:1,owner:OWNER,baseAddress:BASE,marketCount:2}
export const market:MarketPosition={id:LIVE,label:'live',executor:EXECUTOR,morpho:MORPHO,collateral:10n**18n,debt:1000000000n,collateralValue:3200000000n,ltv:312500000000000000n,liquidationLtv:860000000000000000n,oraclePrice:3200n*10n**24n,autopilot:'Active',agentTarget:500000000000000000n,agentTrigger:700000000000000000n,dailyBudget:200000000000000000n,floor:300000000000000000n,loanToken:USDC,collateralToken:WETH,loanSymbol:'USDC',collateralSymbol:'WETH',loanDecimals:6,collateralDecimals:18,liquidity:10000000000n,borrowShares:1000000000n}
export const backup:MarketPosition={...market,id:BACKUP,label:'backup',floor:250000000000000000n,agentTarget:450000000000000000n,agentTrigger:650000000000000000n,dailyBudget:150000000000000000n,migrateAllowed:false,exitAllowed:false}
export const config={baseChainId:84532,nearNetwork:'testnet',baseRpcUrl:'https://base.fixture.test',nearRpcUrl:'https://near.fixture.test',relayerUrl:'https://relayer.fixture.test',relayerUrlFallback:'https://fallback.fixture.test',near:{factory:'fixture.testnet'},agent:{measurement:null,version:null,sourceCommit:null},createVault:{cooldownSecs:120,depositNear:'2',markets:[LIVE,BACKUP].map(id=>({id,loan_token:USDC,collateral_token:WETH,executor:EXECUTOR,slice_max:'1000000000'}))}}
