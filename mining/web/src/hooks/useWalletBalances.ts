import { useQuery } from '@tanstack/react-query'
import { readContracts } from '@wagmi/core'
import { erc20Abi, type Address } from 'viem'
import { useConnection } from 'wagmi'
import { wagmiConfig } from '../web3/config'
import { spaceToken, usdtToken } from '../web3/constants'

export function useWalletBalances(enabled = true) {
    const { address } = useConnection()

    return useQuery({
        queryKey: ['wallet-balances', address],
        queryFn: async () => {
            if (!address) {
                return { usdt: 0n, space: 0n }
            }

            const [usdt, space] = await readContracts(wagmiConfig, {
                allowFailure: false,
                contracts: [
                    {
                        address: usdtToken as Address,
                        abi: erc20Abi,
                        functionName: 'balanceOf',
                        args: [address],
                    },
                    {
                        address: spaceToken as Address,
                        abi: erc20Abi,
                        functionName: 'balanceOf',
                        args: [address],
                    },
                ],
            })

            return { usdt, space }
        },
        enabled: enabled && Boolean(address),
        staleTime: 30_000,
    })
}
