import { formatTokenSymbol } from '../../utils/token'
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { getBalanceLogs } from "../../api"
import PageHeader from "../../components/page-header"
import FetchingOverlay from "../../components/fetching-overlay"
import { formatAmount } from "../../utils/format"
import { formatDateTime } from "../../utils/date"
import { balanceLogText } from "../../utils/balance-log"
import { getApiErrorKey, useI18n } from "../../i18n"
import styles from "./index.module.css"

const PAGE_SIZE = 12

function BalanceLogsPage() {
    const { t } = useI18n()
    const [page, setPage] = useState(1)
    const {
        data,
        isLoading: loading,
        isFetching,
        isError,
        error,
    } = useQuery({
        queryKey: ['balance-logs', 'all', page, PAGE_SIZE],
        queryFn: () => getBalanceLogs(page, PAGE_SIZE),
        placeholderData: keepPreviousData,
        staleTime: 20_000,
    })
    const logs = data?.list ?? []
    const total = data?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const refreshing = isFetching && !loading

    return (
        <div className={styles.page}>
            <PageHeader title="pages.balanceLogs" backTo="/personal" />

            <div className={styles.list}>
                <FetchingOverlay loading={refreshing} />
                {loading && <div className={styles.status}>{t('common.loading')}</div>}
                {!loading && isError && <div className={styles.status}>{error instanceof Error ? t(getApiErrorKey(error.message)) : t('minerRewards.loadFailed')}</div>}
                {!loading && !isError && logs.length === 0 && <div className={styles.status}>{t('personal.noBalanceLogs')}</div>}
                {!loading && !isError && logs.map((log) => {
                    const isOutgoing = BigInt(log.amount || '0') < 0n

                    return (
                    <div className={`${styles.item} ${isOutgoing ? styles.outgoing : styles.incoming}`} key={log.id}>
                        <span className={styles.item_marker} aria-hidden="true" />
                        <div className={styles.item_top}>
                            <div className={styles.item_meta}>
                                <span>{t(balanceLogText[log.type])}</span>
                                <em>{formatDateTime(log.createdAt)}</em>
                            </div>
                            <div className={styles.amount}>
                                <strong>{formatAmount(log.amount, { signed: true, display: true })}</strong>
                                <em>{formatTokenSymbol(log.token)}</em>
                            </div>
                        </div>
                    </div>
                    )
                })}
            </div>

            <div className={styles.pagination}>
                <button type="button" disabled={refreshing || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>{t('common.previous')}</button>
                <span>{page} / {totalPages}</span>
                <button type="button" disabled={refreshing || page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>{t('common.next')}</button>
            </div>
        </div>
    )
}

export default BalanceLogsPage
