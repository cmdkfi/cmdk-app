// Types for guided-values.mjs (used by the e2e fixture; the generator and unit tests are plain JS).
type Link = { label: string; url: string; note: string }
export function guidedValues(appValues: unknown, deployment: unknown): {
  guided: { corridor: { floor: number; target: number; act: number; budget: number; migrate: boolean; exit: boolean }; minDepositEth: string; messageExpirySecs: number; walletTxGasLimit: number; usdcDust: string; firstVaultNumber: number }
  network: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }
  help: { metamaskInstall: string; connectingToBase: string; nearblocks: string; ethFaucets: Link[]; usdcFaucets: Link[] }
  base: { morpho: string; weth: string; usdc: string; gasPriceOracle: string; executorDeployBlock: number }
}
