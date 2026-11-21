import SpaceIcon from '../personal/images/token2.svg'
import UsdtIcon from '../personal/images/USDT.svg'
import { getBuybackOverview } from '../../web3/buyback'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readContract, waitForTransactionReceipt } from '@wagmi/core'
import { erc20Abi, formatUnits, maxUint256, parseUnits } from 'viem'
import { useConnection, useWriteContract } from 'wagmi'
import { toast } from 'react-hot-toast'
import {
    getBuybackRanking,
    getBuybackDividends,
    getLoginAddress,
} from '../../api'
import { buybackPool, usdtToken, spaceToken } from '../../web3/constants'
import { appChain, appChainId, ensureAppChain, wagmiConfig } from '../../web3/config'
import { useWalletBalances } from '../../hooks/useWalletBalances'
import { useI18n } from '../../i18n'
import styles from './index.module.css'
const UNIT = 10n ** 18n
const shanghaiDate = (timestamp: number) =>
    new Date(timestamp * 1000).toLocaleDateString(undefined, {
        timeZone: 'Asia/Shanghai',
    })
const transactionDeadline = () => BigInt(Math.floor(Date.now() / 1000) + 180)
function parseAmount(value: string) {
    if (!/^\d+(\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > 18)
        return 0n
    try {
        return parseUnits(value, 18)
    } catch {
        return 0n
    }
}
const display = (value: string | bigint, digits = 4) =>
    Number(formatUnits(BigInt(value), 18)).toLocaleString(undefined, {
        maximumFractionDigits: digits,
    })
export default function BuybackPage() {
    const { t } = useI18n()
    const queryClient = useQueryClient()
    const connection = useConnection()
    const { mutateAsync: write } = useWriteContract()
    const [mode, setMode] = useState<'buy' | 'sell'>('buy')
    const [tab, setTab] = useState<'swap' | 'ranking' | 'dividends'>('swap')
    const [amount, setAmount] = useState('')
    const [busy, setBusy] = useState(false)
    const [stage, setStage] = useState('')
    const [rankPage, setRankPage] = useState(1)
    const [historyPage, setHistoryPage] = useState(1)
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState('')
    const [confirmOpen, setConfirmOpen] = useState(false)
    const overview = useQuery({
        queryKey: ['buyback', 'overview', connection.address],
        queryFn: () => getBuybackOverview(connection.address),
        refetchInterval: 15000,
    })
    const balances = useWalletBalances()
    const ranking = useQuery({
        queryKey: ['buyback', 'ranking', rankPage, filter],
        queryFn: () =>
            getBuybackRanking(rankPage, filter || undefined),
        enabled: tab === 'ranking',
        refetchInterval: 15000,
    })
    const history = useQuery({
        queryKey: ['buyback', 'dividends', connection.address, historyPage],
        queryFn: () => getBuybackDividends(historyPage),
        enabled: tab === 'dividends',
    })
    const data = overview.data
    const isBuy = mode === 'buy'
    const parsed = parseAmount(amount)
    const buyPrice = BigInt(data?.buyPrice ?? '0')
    const sellPrice = BigInt(data?.sellPrice ?? '0')
    const spaceAmount = isBuy
        ? buyPrice
            ? (parsed * UNIT) / buyPrice
            : 0n
        : parsed
    const usdtAmount = isBuy
        ? (spaceAmount * buyPrice + UNIT - 1n) / UNIT
        : (spaceAmount * sellPrice) / UNIT
    const payBalance = isBuy
        ? (balances.data?.usdt ?? 0n)
        : (balances.data?.space ?? 0n)
    const receiveBalance = isBuy
        ? (balances.data?.space ?? 0n)
        : (balances.data?.usdt ?? 0n)
    const receive = isBuy ? spaceAmount : usdtAmount
    const errorKey = !data
        ? 'swap.loadError'
        : data.paused
          ? 'swap.paused'
          : isBuy && !data.isMarketMaker
            ? 'swap.makerOnly'
            : parsed > payBalance
              ? 'common.insufficientBalance'
              : (isBuy && spaceAmount > BigInt(data.availableSpace)) ||
                  (!isBuy && usdtAmount > BigInt(data.availableUsdt))
                ? 'swap.liquidity'
                : ''
    const disabled =
        busy ||
        balances.isLoading ||
        !spaceAmount ||
        !usdtAmount ||
        Boolean(errorKey)
    function changeMode(next: 'buy' | 'sell') {
        setMode(next)
        setAmount('')
        setConfirmOpen(false)
    }
    async function submit() {
        if (disabled || !data) return
        setBusy(true)
        try {
            if (
                !connection.address ||
                connection.address.toLowerCase() !== getLoginAddress()
            )
                throw new Error(t('node.walletMismatch'))
            if (
                data.contract.toLowerCase() !==
                buybackPool.address.toLowerCase()
            )
                throw new Error(t('swap.configError'))
            await ensureAppChain(connection)
            const token = isBuy ? usdtToken : spaceToken
            const freshQuote = await readContract(wagmiConfig, {
                ...buybackPool,
                functionName: isBuy ? 'quoteBuy' : 'quoteSell',
                args: [spaceAmount],
            })
            if (
                (isBuy && freshQuote > parsed) ||
                (!isBuy && freshQuote < usdtAmount)
            )
                throw new Error(t('swap.priceChanged'))
            const pay = isBuy ? freshQuote : spaceAmount
            const allowance = await readContract(wagmiConfig, {
                address: token,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [connection.address, buybackPool.address],
            })
            if (allowance < pay) {
                setStage('swap.approving')
                const hash = await write({
                    chainId: appChainId,
                    address: token,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [buybackPool.address, maxUint256],
                })
                if (
                    (await waitForTransactionReceipt(wagmiConfig, { hash }))
                        .status !== 'success'
                )
                    throw new Error(t('common.walletActionFailed'))
            }
            setStage('swap.confirming')
            const deadline = transactionDeadline()
            const hash = isBuy
                ? await write({
                      chainId: appChainId,
                      ...buybackPool,
                      functionName: 'buy',
                      args: [spaceAmount, parsed, deadline],
                  })
                : await write({
                      chainId: appChainId,
                      ...buybackPool,
                      functionName: 'sell',
                      args: [spaceAmount, usdtAmount, deadline],
                  })
            if (
                (await waitForTransactionReceipt(wagmiConfig, { hash }))
                    .status !== 'success'
            )
                throw new Error(t('common.walletActionFailed'))
            setAmount('')
            setConfirmOpen(false)
            toast.success(t('swap.success'))
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['buyback'] }),
                queryClient.invalidateQueries({
                    queryKey: ['wallet-balances'],
                }),
                queryClient.invalidateQueries({
                    queryKey: ['fee-exempt-account'],
                }),
            ])
        } catch (e) {
            toast.error(
                e instanceof Error && !e.message.startsWith('api.')
                    ? e.message.split('\n')[0]
                    : t('common.walletActionFailed'),
            )
        } finally {
            setBusy(false)
            setStage('')
        }
    }
    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <h1>{t('swap.title')}</h1>
                <span className={styles.network}>{appChain.name}</span>
            </header>
            <nav className={styles.nav}>
                {(['swap', 'ranking', 'dividends'] as const).map((v) => (
                    <button
                        type="button"
                        key={v}
                        aria-pressed={tab === v}
                        className={tab === v ? styles.selected : ''}
                        onClick={() => setTab(v)}
                    >
                        {t(`swap.${v}`)}
                    </button>
                ))}
            </nav>
            {tab === 'swap' && (
                <>
                    <section
                        className={styles.card}
                        aria-label={t('swap.swap')}
                    >
                        <div className={styles.cardHeader}>
                            <div className={styles.modes}>
                                <button
                                    disabled={busy}
                                    aria-pressed={isBuy}
                                    className={isBuy ? styles.active : ''}
                                    onClick={() => changeMode('buy')}
                                >
                                    {t('swap.buy')}
                                </button>
                                <button
                                    disabled={busy}
                                    aria-pressed={!isBuy}
                                    className={!isBuy ? styles.active : ''}
                                    onClick={() => changeMode('sell')}
                                >
                                    {t('swap.sell')}
                                </button>
                            </div>
                            <span>{t('swap.fixed')}</span>
                        </div>
                        <div className={styles.amountCard}>
                            <label htmlFor="buyback-amount">
                                {t('swap.pay')}
                            </label>
                            <div className={styles.amountLine}>
                                <input
                                    id="buyback-amount"
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={amount}
                                    disabled={busy}
                                    onChange={(e) => {
                                        setAmount(e.target.value)
                                        setConfirmOpen(false)
                                    }}
                                />
                                <span className={styles.token}>
                                    <img src={isBuy ? UsdtIcon : SpaceIcon} alt="" />
                                    {isBuy ? 'USDT' : "SpaceXZI"}
                                </span>
                            </div>
                            <div className={styles.balanceRow}>
                                <span>
                                    {t('swap.wallet')}:{' '}
                                    {balances.isLoading
                                        ? '—'
                                        : display(payBalance)}
                                </span>
                                <button
                                    disabled={busy}
                                    onClick={() =>
                                        setAmount(formatUnits(payBalance, 18))
                                    }
                                >
                                    {t('common.max')}
                                </button>
                            </div>
                        </div>
                        <div className={styles.direction}>
                            <button
                                disabled={busy}
                                aria-label={t('swap.switch')}
                                onClick={() =>
                                    changeMode(isBuy ? 'sell' : 'buy')
                                }
                            >
                                ⇅
                            </button>
                        </div>
                        <div className={styles.amountCard}>
                            <span>{t('swap.receive')}</span>
                            <div className={styles.amountLine}>
                                <output aria-live="polite">
                                    {display(receive, 6)}
                                </output>
                                <span className={styles.token}>
                                    <img src={isBuy ? SpaceIcon : UsdtIcon} alt="" />
                                    {isBuy ? "SpaceXZI" : 'USDT'}
                                </span>
                            </div>
                            <div className={styles.balanceRow}>
                                <span>
                                    {t('swap.wallet')}:{' '}
                                    {balances.isLoading
                                        ? '—'
                                        : display(receiveBalance)}
                                </span>
                            </div>
                        </div>
                        <div className={styles.rate}>
                            <span>
                                1 SpaceXZI ={' '}
                                {data
                                    ? display(isBuy ? buyPrice : sellPrice)
                                    : '—'}{' '}
                                USDT
                            </span>
                            <span>{t('swap.fixed')}</span>
                        </div>
                        {overview.isError && (
                            <button
                                className={styles.reload}
                                onClick={() => void overview.refetch()}
                            >
                                {t('swap.reload')}
                            </button>
                        )}
                        <button
                            className={styles.primary}
                            disabled={disabled}
                            onClick={() => setConfirmOpen(true)}
                        >
                            {busy
                                ? t(stage || 'common.processing')
                                : errorKey
                                  ? t(errorKey)
                                  : !parsed
                                    ? t('swap.enter')
                                    : t(
                                          isBuy
                                              ? 'swap.previewBuy'
                                              : 'swap.previewSell',
                                      )}
                        </button>
                        {errorKey && parsed > 0n && (
                            <p className={styles.error} role="status">
                                {t(errorKey)}
                            </p>
                        )}
                    </section>
                    <details className={styles.details}>
                        <summary>{t('swap.details')}</summary>
                        <div>
                            <span>{t('swap.payActual')}</span>
                            <strong>
                                {display(isBuy ? usdtAmount : spaceAmount)}{' '}
                                {isBuy ? 'USDT' : "SpaceXZI"}
                            </strong>
                        </div>
                        <div>
                            <span>{t('swap.quota')}</span>
                            <strong>
                                {data ? display(data.feeExemptQuota) : '—'}{' '}
                                SpaceXZI
                            </strong>
                        </div>
                        {isBuy && (
                            <div>
                                <span>{t('swap.addQuota')}</span>
                                <strong>{display(spaceAmount)} SpaceXZI</strong>
                            </div>
                        )}
                    </details>
                </>
            )}
            {tab === 'ranking' && (
                <section className={styles.list}>
                    <h2>{t('swap.ranking')}</h2>
                    <p className={styles.muted}>
                        {ranking.data
                            ? `${shanghaiDate(ranking.data.startTime)} — ${shanghaiDate(ranking.data.endTime - 1)}`
                            : t('common.loading')}
                    </p>
                    <p className={styles.muted}>{t('swap.rewardEstimateHint')}</p>
                    <form
                        className={styles.search}
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (search && !/^0x[0-9a-fA-F]{40}$/.test(search)) {
                                toast.error(t('swap.address'))
                                return
                            }
                            setFilter(search)
                            setRankPage(1)
                        }}
                    >
                        <input
                            aria-label={t('swap.search')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('swap.search')}
                        />
                        <button>{t('swap.searchButton')}</button>
                    </form>
                    {ranking.error && (
                        <p className={styles.error}>{t('swap.loadError')}</p>
                    )}
                    <div className={styles.tableHeader}>
                        <span>{t('swap.trader')}</span>
                        <span>{t('swap.volume')} SpaceXZI</span>
                        <span>{t('swap.estimatedReward')} USDT</span>
                    </div>
                    {ranking.data?.items.map((item) => (
                        <div className={styles.rankRow} key={item.address}>
                            <span>
                                <b>{item.rank}</b>
                                <span title={item.address}>
                                    {item.address.slice(0, 6)}…
                                    {item.address.slice(-4)}
                                </span>
                            </span>
                            <strong>{display(item.spaceAmount)}</strong>
                            <strong>{item.rewardBp === 0 ? '0' : data ? display(BigInt(data.dividendBalance) * BigInt(item.rewardBp) / 10000n) : '—'}</strong>
                        </div>
                    ))}
                    {ranking.data?.total === 0 && (
                        <p className={styles.muted}>{t('swap.empty')}</p>
                    )}
                    <div className={styles.pagination}>
                        <button
                            disabled={rankPage === 1}
                            onClick={() => setRankPage(rankPage - 1)}
                        >
                            {t('common.previous')}
                        </button>
                        <span>{rankPage}</span>
                        <button
                            disabled={
                                rankPage * 20 >= (ranking.data?.total ?? 0)
                            }
                            onClick={() => setRankPage(rankPage + 1)}
                        >
                            {t('common.next')}
                        </button>
                    </div>
                </section>
            )}
            {tab === 'dividends' && (
                <section className={styles.list}>
                    <h2>{t('swap.dividends')}</h2>
                    <p className={styles.muted}>{t('swap.dividendHint')}</p>
                    {history.isLoading && <p>{t('common.loading')}</p>}
                    {history.error && (
                        <p className={styles.error}>{t('swap.loadError')}</p>
                    )}
                    {history.data?.list.map((item) => (
                        <div className={styles.rankRow} key={item.id}>
                            <span>
                                {new Date(
                                    item.createdAt * 1000,
                                ).toLocaleDateString()}
                            </span>
                            <strong>{display(item.amount)} USDT</strong>
                        </div>
                    ))}
                    {history.data?.total === 0 && <p>{t('swap.empty')}</p>}
                    <div className={styles.pagination}>
                        <button
                            disabled={historyPage === 1}
                            onClick={() => setHistoryPage(historyPage - 1)}
                        >
                            {t('common.previous')}
                        </button>
                        <span>{historyPage}</span>
                        <button
                            disabled={
                                historyPage * 10 >= (history.data?.total ?? 0)
                            }
                            onClick={() => setHistoryPage(historyPage + 1)}
                        >
                            {t('common.next')}
                        </button>
                    </div>
                </section>
            )}
            {confirmOpen && (
                <div className={styles.mask}>
                    <section
                        className={styles.confirm}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="buyback-confirm-title"
                    >
                        <h2 id="buyback-confirm-title">{t('swap.confirm')}</h2>
                        <p>
                            {display(isBuy ? usdtAmount : spaceAmount)}{' '}
                            {isBuy ? 'USDT' : "SpaceXZI"} → {display(receive)}{' '}
                            {isBuy ? "SpaceXZI" : 'USDT'}
                        </p>
                        <div className={styles.confirmActions}>
                            <button
                                type="button"
                                className={styles.cancel}
                                disabled={busy}
                                onClick={() => setConfirmOpen(false)}
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                className={styles.primary}
                                disabled={disabled}
                                onClick={() => void submit()}
                            >
                                {busy
                                    ? t(stage || 'common.processing')
                                    : t('common.confirm')}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </main>
    )
}
