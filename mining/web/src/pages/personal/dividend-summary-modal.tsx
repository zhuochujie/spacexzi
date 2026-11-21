import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDividendSummary } from '../../api'
import SkeletonText from '../../components/skeleton-text'
import { useI18n } from '../../i18n'
import { formatAmount } from '../../utils/format'
import { formatTokenSymbol } from '../../utils/token'
import styles from './dividend-summary-modal.module.css'
import SpaceIcon from './images/token2.svg'
import UsdtIcon from './images/USDT.svg'

type DividendSummaryModalProps = {
    open: boolean
    onClose: () => void
}

function DividendAmount({ loading, value, token }: { loading: boolean; value?: string; token: 'SPACE' | 'USDT' }) {
    return (
        <div className={styles.amount}>
            {loading ? <SkeletonText width={58} height={14} /> : <strong>{formatAmount(value, { display: true })}</strong>}
            <span>{formatTokenSymbol(token)}</span>
        </div>
    )
}

function SourceIcon({ kind }: { kind: 'vip' | 'node' | 'buyback' }) {
    const paths = {
        vip: 'm3 6 5 4 4-7 4 7 5-4-3 13H6L3 6Zm4 16h10',
        node: 'm12 3 8 5v8l-8 5-8-5V8l8-5ZM4 8l8 5 8-5m-8 5v8',
        buyback: 'M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4',
    }
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[kind]} /></svg>
}

function DividendSummaryModal({ open, onClose }: DividendSummaryModalProps) {
    const { t } = useI18n()
    const modalRef = useRef<HTMLDivElement>(null)
    const { data, isLoading, isError, refetch, isFetching } = useQuery({
        queryKey: ['account', 'dividend-summary'],
        queryFn: getDividendSummary,
        enabled: open,
        staleTime: 60 * 60 * 1000,
    })

    useEffect(() => {
        const modal = modalRef.current
        if (!open || !modal) return
        const previousOverflow = document.body.style.overflow
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        document.body.style.overflow = 'hidden'
        modal.querySelector<HTMLButtonElement>('button')?.focus()
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
            }
            if (event.key === 'Tab') {
                const buttons = [...modal.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
                const first = buttons[0]
                const last = buttons[buttons.length - 1]
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault()
                    last?.focus()
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault()
                    first?.focus()
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            document.body.style.overflow = previousOverflow
            if (previousFocus?.isConnected) previousFocus.focus()
        }
    }, [open, onClose])

    if (!open) return null

    const totalSpace = (BigInt(data?.vipSpaceAmount ?? '0') + BigInt(data?.nodeSpaceAmount ?? '0')).toString()
    const totalUsdt = (BigInt(data?.nodeUsdtAmount ?? '0') + BigInt(data?.buybackUsdtAmount ?? '0')).toString()
    const loading = isLoading || !data

    return (
        <div className={styles.mask} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
            <div
                ref={modalRef}
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dividend-summary-title"
                aria-describedby="dividend-summary-description"
            >
                <header className={styles.header}>
                    <div>
                        <h2 id="dividend-summary-title">{t('dividendSummary.title')}</h2>
                        <p id="dividend-summary-description">{t('dividendSummary.desc')}</p>
                    </div>
                    <button className={styles.close} type="button" aria-label={t('common.close')} onClick={onClose}>
                        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg>
                    </button>
                </header>

                {isError ? (
                    <div className={styles.status} role="alert">
                        <p>{t('dividendSummary.loadFailed')}</p>
                        <button type="button" disabled={isFetching} onClick={() => void refetch()}>{t('common.retry')}</button>
                    </div>
                ) : (
                    <>
                        <section className={styles.totals} aria-label={t('dividendSummary.totalReceived')}>
                            {[
                                { token: 'SPACE', icon: SpaceIcon, amount: totalSpace },
                                { token: 'USDT', icon: UsdtIcon, amount: totalUsdt },
                            ].map((item) => (
                                <div className={styles.token_card} key={item.token}>
                                    <div><img src={item.icon} alt="" /><span>{formatTokenSymbol(item.token)}</span></div>
                                    {loading ? <SkeletonText width={80} height={25} /> : <strong>{formatAmount(item.amount, { display: true })}</strong>}
                                </div>
                            ))}
                        </section>
                        <h3 className={styles.section_title}>{t('dividendSummary.sources')}</h3>
                        <dl className={styles.sources}>
                            <div className={styles.source_row}>
                                <dt><span className={styles.source_icon}><SourceIcon kind="vip" /></span>{t('dividendSummary.vipDividend')}</dt>
                                <dd><DividendAmount loading={loading} value={data?.vipSpaceAmount} token="SPACE" /></dd>
                            </div>
                            <div className={styles.source_row}>
                                <dt><span className={styles.source_icon}><SourceIcon kind="node" /></span>{t('dividendSummary.nodeTab')}</dt>
                                <dd>
                                    <DividendAmount loading={loading} value={data?.nodeSpaceAmount} token="SPACE" />
                                    <DividendAmount loading={loading} value={data?.nodeUsdtAmount} token="USDT" />
                                </dd>
                            </div>
                            <div className={styles.source_row}>
                                <dt><span className={styles.source_icon}><SourceIcon kind="buyback" /></span>{t('dividendSummary.buybackDividend')}</dt>
                                <dd><DividendAmount loading={loading} value={data?.buybackUsdtAmount} token="USDT" /></dd>
                            </div>
                        </dl>
                    </>
                )}
            </div>
        </div>
    )
}

export default DividendSummaryModal
