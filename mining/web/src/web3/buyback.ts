import { readContracts } from '@wagmi/core'
import { erc20Abi, type Address } from 'viem'
import { wagmiConfig } from './config'
import {
    buybackPool,
    buybackDividendVault,
    market,
    spaceToken,
    usdtToken,
} from './constants'

export async function getBuybackOverview(address?: Address) {
    const [
        buyPrice,
        sellPrice,
        paused,
        availableSpace,
        availableUsdt,
        dividendBalance,
    ] = await readContracts(wagmiConfig, {
        allowFailure: false,
        contracts: [
            { ...buybackPool, functionName: 'buyPrice' },
            { ...buybackPool, functionName: 'sellPrice' },
            { ...buybackPool, functionName: 'paused' },
            {
                address: spaceToken,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [buybackPool.address],
            },
            {
                address: usdtToken,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [buybackPool.address],
            },
            {
                address: usdtToken,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [buybackDividendVault],
            },
        ],
    })
    const [isMarketMaker, feeExemptQuota] = address
        ? await readContracts(wagmiConfig, {
              allowFailure: false,
              contracts: [
                  {
                      ...market,
                      functionName: 'feeExemptAccounts',
                      args: [address],
                  },
                  {
                      ...market,
                      functionName: 'feeExemptSpaceQuotas',
                      args: [address],
                  },
              ],
          })
        : ([false, 0n] as const)
    return {
        buyPrice: buyPrice.toString(),
        sellPrice: sellPrice.toString(),
        paused,
        availableSpace: availableSpace.toString(),
        availableUsdt: availableUsdt.toString(),
        dividendBalance: dividendBalance.toString(),
        isMarketMaker,
        feeExemptQuota: feeExemptQuota.toString(),
        contract: buybackPool.address,
        dividendVault: buybackDividendVault,
        spaceToken,
        usdtToken,
    }
}
