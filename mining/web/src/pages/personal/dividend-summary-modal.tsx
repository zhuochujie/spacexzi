import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDividendSummary } from '../../api'
import SkeletonText from '../../components/skeleton-text'
import { getApiErrorKey, useI18n } from '../../i18n'
import { formatAmount } from '../../utils/format'
import styles from './dividend-summary-modal.module.css'
import SpaceIcon from './images/token2.svg'
import UsdtIcon from './images/USDT.svg'
import VipPlanet from './images/dividend/vip.webp'
import NodeSpacePlanet from './images/dividend/node-space.webp'
import NodeUsdtPlanet from './images/dividend/node-usdt.webp'

type DividendSummaryModalProps = {
    open: boolean
    onClose: () => void
}

type DividendTab = 'vip' | 'node'

function DividendAmount({ loading, value, token }: { loading: boolean; value?: string; token: 'SPACE' | 'USDT' }) {
    return (
        <div className={styles.amount}>
            {loading ? <span className={styles.amount_skeleton}><SkeletonText width={58} height={14} /></span> : <strong>{formatAmount(value, { display: true })}</strong>}
            <em>{token}</em>
        </div>
    )
}

function DividendSummaryModal({ open, onClose }: DividendSummaryModalProps) {
    const { t } = useI18n()
    const [tab, setTab] = useState<DividendTab>('vip')
    const {
        data,
        isLoading,
        isError,
        error,
    } = useQuery({
        queryKey: ['account', 'dividend-summary'],
        queryFn: getDividendSummary,
        enabled: open,
        staleTime: 60 * 60 * 1000,
    })

    if (!open) {
        return null
    }

    return (
        <div className={styles.mask} onClick={onClose}>
            <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
                <button className={styles.close} type="button" aria-label={t('common.close')} onClick={onClose}>×</button>

                <div className={styles.header}>
                    <svg className={styles.logo} viewBox="0 0 44 44" aria-hidden="true">
                        <defs>
                            <linearGradient id="dividend-logo-main" x1="8" y1="36" x2="36" y2="8" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#5D35FF" />
                                <stop offset="0.58" stopColor="#7E4DFF" />
                                <stop offset="1" stopColor="#B25CFF" />
                            </linearGradient>
                            <linearGradient id="dividend-logo-slice" x1="20" y1="8" x2="36" y2="30" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#C7B8FF" />
                                <stop offset="1" stopColor="#8E6BFF" />
                            </linearGradient>
                            <filter id="dividend-logo-glow" x="-40%" y="-40%" width="180%" height="180%">
                                <feGaussianBlur stdDeviation="2.2" result="blur" />
                                <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.56 0 0 0 0 0.32 0 0 0 0 1 0 0 0 0.7 0" />
                                <feBlend in="SourceGraphic" />
                            </filter>
                        </defs>
                        <circle cx="20" cy="24" r="15" fill="url(#dividend-logo-main)" filter="url(#dividend-logo-glow)" />
                        <path d="M20 9a15 15 0 0 1 14.55 18.65L20 24V9Z" fill="url(#dividend-logo-slice)" opacity="0.95" />
                        <path d="M20 24h15" stroke="#1B1641" strokeWidth="2.2" strokeLinecap="round" opacity="0.72" />
                        <path d="M20 24 30.8 34.8" stroke="#1B1641" strokeWidth="2.2" strokeLinecap="round" opacity="0.72" />
                    </svg>
                    <div>
                        <h2>{t('dividendSummary.title')}</h2>
                        <p>{t('dividendSummary.desc')}</p>
                    </div>
                </div>

                <div className={styles.tabs}>
                    <button className={tab === 'vip' ? styles.active : ''} type="button" onClick={() => setTab('vip')}>
                        {t('dividendSummary.vipTab')}
                    </button>
                    <button className={tab === 'node' ? styles.active : ''} type="button" onClick={() => setTab('node')}>
                        {t('dividendSummary.nodeTab')}
                    </button>
                </div>

                {isError ? (
                    <div className={styles.status}>
                        {error instanceof Error ? t(getApiErrorKey(error.message)) : t('dividendSummary.loadFailed')}
                    </div>
                ) : tab === 'vip' ? (
                    <div className={`${styles.card} ${styles.vip_card}`}>
                        <div className={`${styles.icon} ${styles.vip_icon}`} aria-hidden="true">
                            <img src={SpaceIcon} alt="" />
                        </div>
                        <div className={styles.card_content}>
                            <h3>{t('dividendSummary.vipDividend')}</h3>
                            <span>{t('dividendSummary.totalReceived')}</span>
                            <DividendAmount loading={isLoading} value={data?.vipSpaceAmount} token="SPACE" />
                        </div>
                        <img className={styles.planet} src={VipPlanet} alt="" />
                    </div>
                ) : (
                    <div className={styles.node_list}>
                        <div className={`${styles.card} ${styles.node_space_card}`}>
                            <div className={`${styles.icon} ${styles.node_icon}`} aria-hidden="true">
                                <img src={SpaceIcon} alt="" />
                            </div>
                            <div className={styles.card_content}>
                                <h3>{t('dividendSummary.nodeSpaceDividend')}</h3>
                                <span>{t('dividendSummary.totalReceived')}</span>
                                <DividendAmount loading={isLoading} value={data?.nodeSpaceAmount} token="SPACE" />
                            </div>
                            <img className={styles.planet} src={NodeSpacePlanet} alt="" />
                        </div>
                        <div className={`${styles.card} ${styles.node_usdt_card}`}>
                            <div className={`${styles.icon} ${styles.usdt_icon}`} aria-hidden="true">
                                <img src={UsdtIcon} alt="" />
                            </div>
                            <div className={styles.card_content}>
                                <h3>{t('dividendSummary.nodeUsdtDividend')}</h3>
                                <span>{t('dividendSummary.totalReceived')}</span>
                                <DividendAmount loading={isLoading} value={data?.nodeUsdtAmount} token="USDT" />
                            </div>
                            <img className={styles.planet} src={NodeUsdtPlanet} alt="" />
                        </div>
                    </div>
                )}

                <div className={styles.tip}>
                    <span aria-hidden="true">ⓘ</span>
                    {t('dividendSummary.updateTip')}
                </div>
            </div>
        </div>
    )
}

export default DividendSummaryModal
