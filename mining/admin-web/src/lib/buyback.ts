import { readContracts } from './read-contracts';
import { createPublicClient, erc20Abi, http, type Address } from 'viem'
import { appChain } from './chain'
import { buybackAbi } from '../buyback-abi'

export const buybackClient = createPublicClient({
    chain: appChain,
    transport: http(),
})

export async function getOnchainBuybackAdminOverview() {
    const configured = import.meta.env.VITE_BUYBACK_POOL_ADDRESS?.trim()
    if (!configured || !/^0x[0-9a-fA-F]{40}$/.test(configured))
        throw new Error('请配置 VITE_BUYBACK_POOL_ADDRESS。')
    const contract = configured as Address
    const [
        buyPrice,
        sellPrice,
        paused,
        owner,
        spaceToken,
        usdtToken,
        dividendVault,
    ] = await readContracts(buybackClient, {
        allowFailure: false,
        contracts: [
            { address: contract, abi: buybackAbi, functionName: 'buyPrice' },
            { address: contract, abi: buybackAbi, functionName: 'sellPrice' },
            { address: contract, abi: buybackAbi, functionName: 'paused' },
            { address: contract, abi: buybackAbi, functionName: 'owner' },
            { address: contract, abi: buybackAbi, functionName: 'SPACE' },
            { address: contract, abi: buybackAbi, functionName: 'USDT' },
            {
                address: contract,
                abi: buybackAbi,
                functionName: 'dividendVault',
            },
        ],
    })
    const [availableSpace, availableUsdt, dividendBalance] =
        await readContracts(buybackClient, {
            allowFailure: false,
            contracts: [
                {
                    address: spaceToken,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [contract],
                },
                {
                    address: usdtToken,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [contract],
                },
                {
                    address: usdtToken,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [dividendVault],
                },
            ],
        })
    return {
        contract,
        dividendVault,
        spaceToken,
        usdtToken,
        owner,
        buyPrice: buyPrice.toString(),
        sellPrice: sellPrice.toString(),
        paused,
        availableSpace: availableSpace.toString(),
        availableUsdt: availableUsdt.toString(),
        dividendBalance: dividendBalance.toString(),
    }
}
