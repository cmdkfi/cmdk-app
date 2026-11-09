// Every Base ABI fragment the app uses, copied from cmdkfi/app at 47fd4fb. Each line names its source:
// Solidity (executor/src/*.sol, executor/test/TestToken.sol), the agent's selector list (agent/src/chain.rs),
// or, for WETH.deposit only, the team's script (scripts/rebalance_pool.py). Selectors that the protocol pins are
// cross-checked in abi.test.mjs.
import { parseAbi } from 'viem'

export const morphoAbi = parseAbi([
  // executor/src/Interfaces.sol l.15-18 (IMorpho.position)
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  // executor/src/Interfaces.sol l.19-29 (IMorpho.market)
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  // executor/src/Interfaces.sol l.30 (IMorpho.isAuthorized)
  'function isAuthorized(address authorizer, address authorized) view returns (bool)',
  // agent/src/chain.rs l.350 selector idToMarketParams(bytes32); return tuple = MarketParams, Interfaces.sol l.6-12
  // (also typed so in scripts/liquidate.py l.57)
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
])

// executor/src/Interfaces.sol l.51-54 (IOracle.price: collateral in loan units, scaled 1e36)
export const oracleAbi = parseAbi(['function price() view returns (uint256)'])

// agent/src/chain.rs l.481 selector borrowRateView((address,address,address,address,uint256),(uint128,…×6));
// returns the per-second WAD rate (scripts/SCENES.md l.236)
export const irmAbi = parseAbi([
  'function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)',
])

// executor/src/Interfaces.sol l.56-61 (IChainlinkFeed.latestRoundData)
export const chainlinkAbi = parseAbi(['function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'])

export const executorAbi = parseAbi([
  // executor/src/Interfaces.sol l.6-12
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  // executor/src/Executor.sol l.15-20
  'struct MarketConfig { MarketParams params; address pool; address[2] feeds; uint32[2] maxAges; }',
  // executor/src/Executor.sol l.22-32
  'struct Corridor { uint64 target; uint64 act; uint64 floor; uint64 sellBudget; bool migrateAllowed; bool exitAllowed; bool set; }',
  // executor/src/Executor.sol l.438 (selector cc718f76 pinned in agent/src/chain.rs l.1003)
  'function config(bytes32 id) view returns (MarketConfig)',
  // executor/src/Executor.sol l.65 public mapping getter (selector 2e18e9e7 pinned in agent/src/chain.rs l.1002)
  'function corridors(address user, bytes32 id) view returns (uint64 target, uint64 act, uint64 floor, uint64 sellBudget, bool migrateAllowed, bool exitAllowed, bool set)',
  // executor/src/Executor.sol l.80-97 (events)
  'event CorridorSet(address indexed caller, bytes32 indexed market, Corridor corridor)',
  'event Opened(address indexed caller, bytes32 indexed market, uint256 collateralIn, uint256 borrowed, uint256 ltv)',
  'event Reduced(address indexed caller, bytes32 indexed market, uint256 repaid, uint256 collateralSold, uint256 ltvBefore, uint256 ltvAfter, bool protective)',
  'event Migrated(address indexed caller, bytes32 indexed from, bytes32 indexed to, uint256 fraction, uint256 debtMoved, uint256 collateralMoved)',
  'event Exited(address indexed caller, bytes32 indexed market, uint256 repaid, uint256 fromIdle, uint256 collateralSold, uint256 collateralOut)',
  'event SessionEnded(address indexed caller, bytes32 indexed market, uint256 ltv)',
  'event Repaid(address indexed caller, bytes32 indexed market, uint256 repaid)',
  'event Closed(address indexed caller, bytes32 indexed market, uint256 repaid, uint256 collateralOut)',
])

export const erc20Abi = parseAbi([
  // executor/src/Interfaces.sol l.83-86 (IERC20)
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  // executor/test/TestToken.sol l.8 (`uint8 public constant decimals`); scripts/VERIFY.md §2 step 2 reads token decimals
  'function decimals() view returns (uint8)',
  // executor/test/TestToken.sol l.13
  'event Transfer(address indexed from, address indexed to, uint256 amount)',
])

// scripts/rebalance_pool.py l.349 (`send('wrap ETH', WETH, 'deposit()', value=amt)`). Base's WETH at
// 0x4200000000000000000000000000000000000006 is the standard WETH9 predeploy; no Solidity in cmdkfi/app declares it.
export const wethAbi = parseAbi(['function deposit() payable'])

// agent/src/chain.rs l.22, l.824-834 (`getL1Fee(bytes)` of the unsigned RLP transaction; selector 49948e0e pinned l.1012)
export const gasPriceOracleAbi = parseAbi(['function getL1Fee(bytes) view returns (uint256)'])
