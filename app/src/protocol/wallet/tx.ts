// Wallet transactions the owner sends from the connected wallet (PRD Appendix B). Calldata from ../base/abi.ts.
import { encodeFunctionData } from 'viem'
import { erc20Abi, wethAbi } from '../base/abi.ts'

type Hex = `0x${string}`
export type WalletTx = { to: Hex; data: Hex; value: bigint }

/** WETH.deposit() with `amount` of ETH (scripts/rebalance_pool.py l.349; WETH9 predeploy on Base). */
export function wrapEth(weth: Hex, amount: bigint): WalletTx {
  if (amount <= 0n) throw new Error('Wrap an amount above zero.')
  return { to: weth, data: encodeFunctionData({ abi: wethAbi, functionName: 'deposit' }), value: amount }
}

/** ERC-20 transfer (executor/src/Interfaces.sol l.86; selector a9059cbb, vault/src/evm.rs l.22). */
export function transferToken(token: Hex, to: Hex, amount: bigint): WalletTx {
  if (amount <= 0n) throw new Error('Transfer an amount above zero.')
  return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }), value: 0n }
}

/** Plain ETH transfer (gas top-up to the position address, PRD D7). */
export function sendEth(to: Hex, amount: bigint): WalletTx {
  if (amount <= 0n) throw new Error('Send an amount above zero.')
  return { to, data: '0x', value: amount }
}
