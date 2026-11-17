import { useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { waitForTransactionReceipt } from "@wagmi/core"
import { toast } from "react-hot-toast"
import { useConnection, useWriteContract } from "wagmi"
import {
    getAccountMarketTrades,
    getMyMarketOrders,
    type AccountMarketTrade,
    type MarketOrder,
    type MarketOrderStatus,
    type MarketTradeAction,
    type PageData,
} from "../../api"
import PageHeader from "../../components/page-header"
import { formatAmount } from "../../utils/format"
import { formatShortDateTime } from "../../utils/date"
import { waitForMarketOrderStatus } from "../../utils/market"
import { getApiErrorKey, getFriendlyErrorKey, useI18n } from "../../i18n"
import { market } from "../../web3/constants"
import { appChainId, wagmiConfig } from "../../web3/config"
import LoadingLabel from "../../components/loading-label"
import FetchingOverlay from "../../components/fetching-overlay"
import styles from "./index.module.css"

const PAGE_SIZE = 8
const SPACE_AMOUNT_FRACTION_DIGITS = 2

type OrderView = 'orders' | 'trades'
type StatusFilter = MarketOrderStatus
type ActionFilter = 'all' | MarketTradeAction

const statusText: Record<MarketOrderStatus, string> = {
    open: 'marketOrders.open',
    filled: 'marketOrders.filled',
    cancelled: 'marketOrders.cancelled',
}

const actionText: Record<MarketTradeAction, string> = {
    active_buy: 'marketOrders.activeBuy',
    passive_buy: 'marketOrders.passiveBuy',
    active_sell: 'marketOrders.activeSell',
    passive_sell: 'marketOrders.passiveSell',
}

function getTradeFeeLabelKey(action: MarketTradeAction) {
    return action === 'active_sell' || action === 'passive_sell'
        ? 'marketOrders.myFee'
        : 'marketOrders.counterpartyFee'
}

function formatTokenAmount(value: string, fractionDigits = SPACE_AMOUNT_FRACTION_DIGITS) {
    return formatAmount(value || '0', { display: true, fractionDigits })
}

function formatOrderId(id?: string) {
    if (!id) {
        return '--'
    }

    if (id.length <= 14) {
        return id
    }

    return `${id.slice(0, 8)}...${id.slice(-6)}`
}

function getOrderFilledUsdtAmount(order: MarketOrder) {
    const spaceAmount = BigInt(order.spaceAmount || '0')
    const remainingSpaceAmount = BigInt(order.remainingSpaceAmount || '0')
    const filledSpaceAmount = spaceAmount > remainingSpaceAmount ? spaceAmount - remainingSpaceAmount : 0n

    return (filledSpaceAmount * BigInt(order.price || '0') / 10n ** 18n).toString()
}

function MarketOrdersPage() {
    const queryClient = useQueryClient()
    const { t } = useI18n()
    const { address } = useConnection()
    const { mutateAsync: writeContract } = useWriteContract()
    const [view, setView] = useState<OrderView>('orders')
    const [status, setStatus] = useState<StatusFilter>('open')
    const [action, setAction] = useState<ActionFilter>('all')
    const [page, setPage] = useState(1)
    const [cancellingOrderId, setCancellingOrderId] = useState('')
    const actionParam = action === 'all' ? undefined : action
    const {
        data: ordersData,
        isLoading: loading,
        isFetching,
        isError,
        error,
    } = useQuery<PageData<MarketOrder> | PageData<AccountMarketTrade>>({
        queryKey: ['market', 'my-orders', address, view, status, actionParam ?? 'all', page, PAGE_SIZE],
        queryFn: () => {
            if (!address) {
                return { list: [], total: 0, page, pageSize: PAGE_SIZE }
            }

            if (view === 'trades') {
                return getAccountMarketTrades(address, page, PAGE_SIZE, actionParam)
            }

            return getMyMarketOrders(address, page, PAGE_SIZE, undefined, status)
        },
        placeholderData: keepPreviousData,
        staleTime: 10_000,
    })
    const orders = ordersData?.list ?? []
    const total = ordersData?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const refreshing = isFetching && !loading

    const resetPage = () => setPage(1)

    const refreshMarketData = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['market', 'orders'] }),
            queryClient.invalidateQueries({ queryKey: ['market', 'my-orders'] }),
            queryClient.invalidateQueries({ queryKey: ['market', 'stats'] }),
            queryClient.invalidateQueries({ queryKey: ['market', 'latest-price'] }),
            queryClient.invalidateQueries({ queryKey: ['wallet-balances'] }),
        ])
    }

    const handleCancelOrder = async (order: MarketOrder) => {
        try {
            setCancellingOrderId(order.id)
            const hash = await writeContract({
                chainId: appChainId,
                address: market.address,
                abi: market.abi,
                functionName: 'cancelOrder',
                args: [order.id as `0x${string}`],
            })

            await waitForTransactionReceipt(wagmiConfig, {
                hash,
            })
            await waitForMarketOrderStatus(order.id as `0x${string}`, 'cancelled')
            await refreshMarketData()
            toast.success(t('marketOrders.cancelSuccess'))
        } catch (error) {
            toast.error(error instanceof Error ? t(getFriendlyErrorKey(error.message, 'common.walletActionFailed')) : t('marketOrders.cancelFailed'))
        } finally {
            setCancellingOrderId('')
        }
    }

    return (
        <div className={styles.page}>
            <PageHeader title="pages.marketOrders" backTo="/market" />

            <div className={styles.tabs}>
                <button
                    className={view === 'orders' ? styles.active_tab : ''}
                    type="button"
                    disabled={refreshing}
                    onClick={() => {
                        setView('orders')
                        resetPage()
                    }}
                >
                    {t('marketOrders.orders')}
                </button>
                <button
                    className={view === 'trades' ? styles.active_tab : ''}
                    type="button"
                    disabled={refreshing}
                    onClick={() => {
                        setView('trades')
                        resetPage()
                    }}
                >
                    {t('marketOrders.trades')}
                </button>
            </div>

            {view === 'orders' && (
                <div className={styles.filters}>
                    <button className={status === 'open' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setStatus('open'); resetPage() }}>{t('marketOrders.open')}</button>
                    <button className={status === 'filled' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setStatus('filled'); resetPage() }}>{t('marketOrders.filled')}</button>
                    <button className={status === 'cancelled' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setStatus('cancelled'); resetPage() }}>{t('marketOrders.cancelled')}</button>
                </div>
            )}
            {view === 'trades' && (
                <div className={styles.filters}>
                    <button className={action === 'all' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setAction('all'); resetPage() }}>{t('marketOrders.all')}</button>
                    <button className={action === 'active_buy' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setAction('active_buy'); resetPage() }}>{t('marketOrders.activeBuy')}</button>
                    <button className={action === 'passive_buy' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setAction('passive_buy'); resetPage() }}>{t('marketOrders.passiveBuy')}</button>
                    <button className={action === 'active_sell' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setAction('active_sell'); resetPage() }}>{t('marketOrders.activeSell')}</button>
                    <button className={action === 'passive_sell' ? styles.active_filter : ''} type="button" disabled={refreshing} onClick={() => { setAction('passive_sell'); resetPage() }}>{t('marketOrders.passiveSell')}</button>
                </div>
            )}
            <div className={styles.order_list}>
                <FetchingOverlay loading={refreshing} />
                {loading && <div className={styles.empty}>{t('market.loadingOrders')}</div>}
                {!loading && isError && <div className={styles.empty}>{error instanceof Error ? t(getApiErrorKey(error.message)) : t('market.loadOrdersFailed')}</div>}
                {!loading && !isError && orders.length === 0 && <div className={styles.empty}>{view === 'trades' ? t('marketOrders.noTrades') : t('market.noOrders')}</div>}
                {!loading && !isError && view === 'orders' && (orders as MarketOrder[]).map((order) => (
                    <div className={styles.order_card} key={order.id}>
                        <div className={styles.order_top}>
                            <span>{order.side === 'buy' ? t('marketOrders.buyOrder') : t('marketOrders.sellOrder')}</span>
                            <div>
                                {order.status === 'open' && (
                                    <button
                                        className={styles.cancel_btn}
                                        type="button"
                                        disabled={cancellingOrderId === order.id}
                                        onClick={() => handleCancelOrder(order)}
                                    >
                                        {cancellingOrderId === order.id ? <LoadingLabel text={t('marketOrders.cancelling')} /> : t('marketOrders.cancelOrder')}
                                    </button>
                                )}
                                <em className={styles[`status_${order.status}`]}>{t(statusText[order.status])}</em>
                            </div>
                        </div>
                        <div className={styles.order_id}>
                            <span>{formatOrderId(order.id)}</span>
                            <span>{formatShortDateTime(order.createdAt)}</span>
                        </div>
                        <div className={styles.order_grid}>
                            <div>
                                <span>{t('marketOrders.remainingAmount')}</span>
                                <strong>{formatTokenAmount(order.remainingSpaceAmount)} SPACE</strong>
                            </div>
                            <div>
                                <span>{t('marketOrders.orderAmount')}</span>
                                <strong>{formatTokenAmount(order.spaceAmount)} SPACE</strong>
                            </div>
                            <div>
                                <span>{t('common.price')}</span>
                                <strong>{formatAmount(order.price, { display: true, fractionDigits: 3 })} USDT</strong>
                            </div>
                            <div>
                                <span>{t('marketOrders.total')}</span>
                                <strong>{formatAmount(getOrderFilledUsdtAmount(order), { display: true, fractionDigits: 3 })} USDT</strong>
                            </div>
                        </div>
                    </div>
                ))}
                {!loading && !isError && view === 'trades' && (orders as AccountMarketTrade[]).map((trade) => (
                    <div className={styles.order_card} key={trade.id}>
                        <div className={styles.order_top}>
                            <span>{t(actionText[trade.action])}</span>
                            <div>
                                <em className={styles.status_filled}>{t('marketOrders.filled')}</em>
                            </div>
                        </div>
                        <div className={styles.order_id}>
                            <span>{t('marketOrders.orderPrefix')} {formatOrderId(trade.orderId)}</span>
                            <span>{formatShortDateTime(trade.filledAt)}</span>
                        </div>
                        <div className={styles.order_grid}>
                            <div>
                                <span>{t('marketOrders.tradeAmount')}</span>
                                <strong>{formatTokenAmount(trade.spaceAmount)} SPACE</strong>
                            </div>
                            <div>
                                <span>{t('marketOrders.tradePrice')}</span>
                                <strong>{formatAmount(trade.price, { display: true, fractionDigits: 3 })} USDT</strong>
                            </div>
                            <div>
                                <span>{t('marketOrders.tradeTotal')}</span>
                                <strong>{formatAmount(trade.usdtAmount, { display: true, fractionDigits: 3 })} USDT</strong>
                            </div>
                            <div>
                                <span>{t(getTradeFeeLabelKey(trade.action))}</span>
                                <strong>{formatAmount((BigInt(trade.nodeFee || '0') + BigInt(trade.markerFee || '0')).toString(), { display: true, fractionDigits: 3 })} USDT</strong>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className={styles.pagination}>
                <button type="button" disabled={refreshing || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>{t('common.previous')}</button>
                <span>{page} / {totalPages}</span>
                <button type="button" disabled={refreshing || page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>{t('common.next')}</button>
            </div>
        </div>
    )
}

export default MarketOrdersPage
