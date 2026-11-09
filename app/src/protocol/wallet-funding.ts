// S3 funding check reads (PRD S3, FR-7, FR-17): wallet ETH and WETH, account code, and the cost of the
// wallet transactions the deposit step sends (WETH.deposit, WETH.transfer). Cost = gas limit × live
// maxFeePerGas + Base L1 data fee from GasPriceOracle.getL1Fee(unsigned tx), the same oracle call the
// agent uses (cmdkfi/app agent/src/chain.rs). New module (Phase 2).
import { createPublicClient, encodeFunctionData, http, parseAbi, serializeTransaction, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import type { AppConfig } from './near.ts'
import { accountKind } from './wallet-utils.ts'

const wethAbi = parseAbi(['function deposit() payable', 'function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'])
const gasOracleAbi = parseAbi(['function getL1Fee(bytes) view returns (uint256)'])

export type WalletFunding = {
  blockNumber: bigint
  eth: bigint
  weth: bigint
  /** Upper-bound cost in wei of one WETH.deposit and one WETH.transfer sent from this wallet. */
  wrapCost: bigint
  transferCost: bigint
}

export async function readWalletFunding(config: AppConfig, owner: Address, tokens: { weth: Address; gasPriceOracle: Address }, gasLimit: bigint, amount: bigint): Promise<WalletFunding> {
  const client = createPublicClient({ chain: baseSepolia, transport: http(config.baseRpcUrl) })
  if (await client.getChainId() !== 84532) throw new Error('RPC is not Base Sepolia.')
  const blockNumber = await client.getBlockNumber()
  const [eth, weth, nonce, fees] = await Promise.all([
    client.getBalance({ address: owner, blockNumber }),
    client.readContract({ address: tokens.weth, abi: wethAbi, functionName: 'balanceOf', args: [owner], blockNumber }),
    client.getTransactionCount({ address: owner, blockNumber }),
    client.estimateFeesPerGas(),
  ])
  const unsigned = (data: `0x${string}`, value: bigint) => serializeTransaction({
    chainId: baseSepolia.id, type: 'eip1559', nonce, gas: gasLimit, to: tokens.weth, data, value,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  const l1Fee = (tx: `0x${string}`) => client.readContract({ address: tokens.gasPriceOracle, abi: gasOracleAbi, functionName: 'getL1Fee', args: [tx], blockNumber })
  const [wrapL1, transferL1] = await Promise.all([
    l1Fee(unsigned(encodeFunctionData({ abi: wethAbi, functionName: 'deposit' }), amount)),
    // The position address is not known yet; any 20-byte recipient gives the same serialized size.
    l1Fee(unsigned(encodeFunctionData({ abi: wethAbi, functionName: 'transfer', args: [owner, amount] }), 0n)),
  ])
  const l2 = gasLimit * fees.maxFeePerGas
  return { blockNumber, eth, weth, wrapCost: l2 + wrapL1, transferCost: l2 + transferL1 }
}

export async function readAccountKind(config: AppConfig, address: Address) {
  const client = createPublicClient({ chain: baseSepolia, transport: http(config.baseRpcUrl) })
  return accountKind(await client.getCode({ address }))
}
