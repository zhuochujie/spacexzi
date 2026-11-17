import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useNavigate } from 'react-router'
import { readContract, waitForTransactionReceipt } from '@wagmi/core'
import { erc20Abi, maxUint256, type Address, type Hash } from 'viem'
import {
    useConnection,
    useWaitForTransactionReceipt,
    useWriteContract,
} from 'wagmi'
import {
    getProfile,
    purchaseMiner,
    submitMinerNonce,
    type Miner,
    type PurchaseMinerMethod,
} from '../api'
import { getFriendlyErrorKey, useI18n } from '../i18n'
import { waitForMinerNonceUsed } from '../utils/miner'
import { appChainId, wagmiConfig } from '../web3/config'
import { mining, spaceToken } from '../web3/constants'
import { useWalletBalances } from './useWalletBalances'

function getApiErrorMessage(error: unknown, fallbackKey = '') {
    if (!(error instanceof Error) || !error.message) {
        return fallbackKey
    }

    return getFriendlyErrorKey(error.message, fallbackKey)
}

type UseMinerPurchaseOptions = {
    includeBalanceLogs?: boolean
}

type MinerPurchaseMode = 'purchase' | 'reinvest'

export function useMinerPurchase(options: UseMinerPurchaseOptions = {}) {
    const { includeBalanceLogs = false } = options
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { t } = useI18n()
    const { address } = useConnection()
    const { mutateAsync: writeContract } = useWriteContract()
    const [selectedMiner, setSelectedMiner] = useState<Miner | null>(null)
    const [pendingMiner, setPendingMiner] = useState<Miner | null>(null)
    const [successMiner, setSuccessMiner] = useState<Miner | null>(null)
    const [purchaseMode, setPurchaseMode] =
        useState<MinerPurchaseMode>('purchase')
    const [pendingMode, setPendingMode] =
        useState<MinerPurchaseMode>('purchase')
    const [successMode, setSuccessMode] =
        useState<MinerPurchaseMode>('purchase')
    const [paymentMethod, setPaymentMethod] =
        useState<PurchaseMinerMethod>('wallet_balance')
    const [buyingMinerId, setBuyingMinerId] = useState<string | null>(null)
    const [pendingNonce, setPendingNonce] = useState('')
    const [pendingHash, setPendingHash] = useState<Hash>()
    const [pendingToastId, setPendingToastId] = useState<string | undefined>()
    const { isSuccess: isPurchaseConfirmed, isError: isPurchaseFailed } =
        useWaitForTransactionReceipt({
            hash: pendingHash,
            query: {
                enabled: Boolean(pendingHash),
            },
        })
    const { data: profile, isLoading: profileLoading } = useQuery({
        queryKey: ['profile'],
        queryFn: getProfile,
        enabled: Boolean(selectedMiner && address),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    })
    const { data: walletBalances, isLoading: walletBalancesLoading } =
        useWalletBalances(Boolean(selectedMiner))
    const internalBalance = BigInt(profile?.balance ?? '0')
    const walletSpaceBalance = walletBalances?.space ?? 0n
    const balanceLoading = profileLoading || walletBalancesLoading
    const activePaymentMethod = paymentMethod

    useEffect(() => {
        if (!isPurchaseConfirmed || !pendingNonce) {
            return
        }

        async function confirmPurchase() {
            try {
                await submitMinerNonce(pendingNonce)
                await waitForMinerNonceUsed(pendingNonce)
                const invalidations = [
                    queryClient.invalidateQueries({
                        queryKey: ['miners'],
                        exact: true,
                    }),
                    queryClient.invalidateQueries({
                        queryKey: ['miners', 'my'],
                    }),
                    queryClient.invalidateQueries({
                        queryKey: ['wallet-balances'],
                    }),
                    queryClient.invalidateQueries({ queryKey: ['profile'] }),
                ]

                if (includeBalanceLogs) {
                    invalidations.push(
                        queryClient.invalidateQueries({
                            queryKey: ['balance-logs'],
                        }),
                    )
                }

                await Promise.all(invalidations)
                if (pendingToastId) {
                    toast.dismiss(pendingToastId)
                }
                setSuccessMiner(pendingMiner)
                setSuccessMode(pendingMode)
            } catch (error) {
                if (pendingToastId) {
                    toast.dismiss(pendingToastId)
                }
                toast.error(
                    t(getApiErrorMessage(error) || 'home.purchaseSyncFailed'),
                )
            } finally {
                setBuyingMinerId(null)
                setPendingHash(undefined)
                setPendingNonce('')
                setPendingMiner(null)
                setPendingMode('purchase')
                setPendingToastId(undefined)
            }
        }

        confirmPurchase()
    }, [
        includeBalanceLogs,
        isPurchaseConfirmed,
        pendingMiner,
        pendingMode,
        pendingNonce,
        pendingToastId,
        queryClient,
        t,
    ])

    useEffect(() => {
        if (!isPurchaseFailed) {
            return
        }

        async function handlePurchaseFailed() {
            await Promise.resolve()
            if (pendingToastId) {
                toast.dismiss(pendingToastId)
            }
            toast.error(t('home.purchaseFailed'))
            setBuyingMinerId(null)
            setPendingHash(undefined)
            setPendingNonce('')
            setPendingMiner(null)
            setPendingMode('purchase')
            setPendingToastId(undefined)
        }

        handlePurchaseFailed()
    }, [isPurchaseFailed, pendingToastId, t])

    const getAvailableBalance = (method: PurchaseMinerMethod) => {
        if (method === 'internal_balance') {
            return internalBalance
        }

        if (method === 'wallet_balance') {
            return walletSpaceBalance
        }

        return internalBalance + walletSpaceBalance
    }

    const isBalanceEnough = (method: PurchaseMinerMethod, miner: Miner) => {
        return getAvailableBalance(method) >= BigInt(miner.price)
    }

    const closePaymentModal = () => {
        if (buyingMinerId) {
            return
        }

        setSelectedMiner(null)
    }

    const openPaymentModal = (
        miner: Miner,
        mode: MinerPurchaseMode = 'purchase',
    ) => {
        setSelectedMiner(miner)
        setPurchaseMode(mode)
        setPaymentMethod('wallet_balance')
    }

    const executePurchase = async (
        miner: Miner,
        method: PurchaseMinerMethod,
    ) => {
        try {
            if (!address) {
                toast.error(t('common.connectWalletFirst'))
                throw new Error('wallet_not_connected')
            }

            if (!isBalanceEnough(method, miner)) {
                toast.error(t('common.insufficientBalance'))
                throw new Error('insufficient_balance')
            }

            setBuyingMinerId(miner.id)
            const purchase = await purchaseMiner(miner.id, method)
            const payValue = BigInt(purchase.payValue)

            if (payValue > 0n) {
                const allowance = await readContract(wagmiConfig, {
                    address: spaceToken as Address,
                    abi: erc20Abi,
                    functionName: 'allowance',
                    args: [address, mining.address],
                })

                if (allowance < payValue) {
                    const approveHash = await writeContract({
                        chainId: appChainId,
                        address: spaceToken as Address,
                        abi: erc20Abi,
                        functionName: 'approve',
                        args: [mining.address, maxUint256],
                    })

                    await waitForTransactionReceipt(wagmiConfig, {
                        hash: approveHash,
                    })
                }
            }

            const hash = await writeContract({
                chainId: appChainId,
                address: mining.address,
                abi: mining.abi,
                functionName: 'purchaseMiner',
                args: [
                    purchase.minerId,
                    BigInt(purchase.price),
                    payValue,
                    BigInt(purchase.expectedReward),
                    purchase.nonce,
                    BigInt(purchase.deadline),
                    purchase.signature,
                ],
            })

            setPendingNonce(purchase.nonce)
            setPendingHash(hash)
            setPendingMiner(miner)
            setPendingMode(purchaseMode)
            setSelectedMiner(null)
            setPendingToastId(toast.loading(t('home.purchaseSubmitted')))
        } catch (error) {
            if (
                error instanceof Error &&
                (error.message === 'wallet_not_connected' ||
                    error.message === 'insufficient_balance')
            ) {
                setBuyingMinerId(null)
                setPendingHash(undefined)
                setPendingNonce('')
                setPendingMiner(null)
                setPendingMode('purchase')
                setPendingToastId(undefined)
                return
            }

            setBuyingMinerId(null)
            setPendingHash(undefined)
            setPendingNonce('')
            setPendingMiner(null)
            setPendingMode('purchase')
            setPendingToastId(undefined)
            toast.error(
                t(
                    getApiErrorMessage(error, 'common.walletActionFailed') ||
                        'home.purchaseFailed',
                ),
            )
        }
    }

    const handleConfirmPayment = () => {
        if (!selectedMiner) {
            return
        }

        executePurchase(selectedMiner, activePaymentMethod)
    }

    const closeSuccessModal = () => {
        setSuccessMiner(null)
    }

    const goToMyMiners = () => {
        setSuccessMiner(null)
        navigate('/miner')
    }

    return {
        activePaymentMethod,
        balanceLoading,
        buyingMinerId,
        closePaymentModal,
        closeSuccessModal,
        goToMyMiners,
        handleConfirmPayment,
        internalBalance,
        isBalanceEnough,
        openPaymentModal,
        paymentMethod,
        purchaseMode,
        selectedMiner,
        setPaymentMethod,
        successMiner,
        successMode,
        walletSpaceBalance,
    }
}

export type MinerPurchaseState = ReturnType<typeof useMinerPurchase>
