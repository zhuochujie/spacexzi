import { getMinerPresentation, freeMinerImage, fallbackMinerImage } from '../../utils/miner-presentation'
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router"
import { toast } from "react-hot-toast"
import { useConnection, useWriteContract } from "wagmi"
import { readContract, waitForTransactionReceipt } from "@wagmi/core"
import { type Address } from "viem"
import {
    getLatestNotice,
    getMinerInitialCycle,
    getFreeMinerConfig,
    getMiners,
    claimFeeExempt,
    syncMarketMaker,
    submitFreeMinerHash,
    type Miner,
    type Notice,
} from "../../api"
import { formatAmount } from "../../utils/format"
import { waitForFreeMinerHash } from "../../utils/miner"
import { getLocalizedNotice } from "../../utils/notice"
import { market, mining } from "../../web3/constants"
import { appChainId, wagmiConfig } from "../../web3/config"
import FetchingOverlay from "../../components/fetching-overlay"
import LoadingLabel from "../../components/loading-label"
import MinerPaymentModal from "../../components/miner-payment-modal"
import { useMinerPurchase } from "../../hooks/useMinerPurchase"
import { getFriendlyErrorKey, useI18n } from "../../i18n"
import styles from "./index.module.css"
import Logo from '../../assets/images/logo.webp'
import Arrow from './images/arrow.webp'
import Safety from '../../assets/images/safety_bb.webp'
import Transparent from '../../assets/images/transparent_bb.webp'
import Efficient from '../../assets/images/efficient_bb.webp'

const NOTICE_SCROLL_SPEED_PX_PER_SECOND = 20
const MIN_NOTICE_SCROLL_DURATION_SECONDS = 20

function getApiErrorMessage(error: unknown, fallbackKey = '') {
    if (!(error instanceof Error) || !error.message) {
        return fallbackKey
    }

    return getFriendlyErrorKey(error.message, fallbackKey)
}

function IndexPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { language, t } = useI18n()
    const [
        latestNoticeQuery,
        minersQuery,
        minerCycleQuery,
    ] = useQueries({
        queries: [
            { queryKey: ['notice', 'latest'], queryFn: getLatestNotice, staleTime: 60_000 },
            { queryKey: ['miners'], queryFn: getMiners, staleTime: 30_000 },
            { queryKey: ['miners', 'initial-cycle'], queryFn: getMinerInitialCycle, staleTime: 60_000 },
        ],
    })
    const freeMinerConfigQuery = useQuery({ queryKey: ['miners', 'free-config'], queryFn: getFreeMinerConfig, staleTime: 30000, refetchInterval: 30000 })
    const freeMinerAmountQuery = useQuery({
        queryKey: ['mining', 'free-miner-space-amount'],
        queryFn: () => readContract(wagmiConfig, { ...mining, functionName: 'freeMinerSpaceAmount' }),
        staleTime: 30000,
    })
    const latestNotice = (latestNoticeQuery.data ?? null) as Notice | null
    const latestNoticeText = latestNotice ? getLocalizedNotice(latestNotice, language) : null
    const noticeLoading = latestNoticeQuery.isLoading
    const noticeText = latestNoticeText ? `${latestNoticeText.title} ${latestNoticeText.content}` : t('home.noNotice')
    const noticeTextRef = useRef<HTMLSpanElement>(null)
    const noticeViewportRef = useRef<HTMLDivElement>(null)
    const [noticeRepeatCount, setNoticeRepeatCount] = useState(2)
    const [noticeDistance, setNoticeDistance] = useState(0)
    const [claimingFeeExempt, setClaimingFeeExempt] = useState(false)
    const [claimingFreeMiner, setClaimingFreeMiner] = useState(false)
    const { address } = useConnection()
    const { mutateAsync: writeContract } = useWriteContract()
    const minerPurchase = useMinerPurchase()
    const { buyingMinerId, openPaymentModal } = minerPurchase
    const miners = (minersQuery.data ?? []) as Miner[]
    const minerCycle = (minerCycleQuery.data ?? null) as number | null
    const walletAddress = address
    const {
        data: freeMinerClaimEnabled,
        isLoading: freeMinerClaimEnabledLoading,
    } = useQuery({
        queryKey: ['mining', 'free-miner-claim-enabled'],
        queryFn: () => readContract(wagmiConfig, {
            address: mining.address,
            abi: mining.abi,
            functionName: 'freeMinerClaimEnabled',
        }),
        staleTime: 30_000,
    })
    const { data: freeMinerClaimed } = useQuery({
        queryKey: ['mining', 'claimed-free-miners', walletAddress],
        queryFn: () => readContract(wagmiConfig, {
            address: mining.address,
            abi: mining.abi,
            functionName: 'claimedFreeMiners',
            args: [walletAddress as Address],
        }),
        enabled: Boolean(walletAddress),
        staleTime: 30_000,
    })
    const { data: isFeeExemptAccount } = useQuery({
        queryKey: ['fee-exempt-account', walletAddress],
        queryFn: () => readContract(wagmiConfig, {
            address: market.address,
            abi: market.abi,
            functionName: 'feeExemptAccounts',
            args: [walletAddress as Address],
        }),
        enabled: Boolean(walletAddress),
        staleTime: 60_000,
    })
    useEffect(() => {
        function updateNoticeAnimation() {
            const viewportWidth = noticeViewportRef.current?.clientWidth || 0
            const itemWidth = noticeTextRef.current?.getBoundingClientRect().width || 0

            if (!viewportWidth || !itemWidth) {
                return
            }

            setNoticeDistance(itemWidth)
            setNoticeRepeatCount(Math.max(2, Math.ceil(viewportWidth / itemWidth) + 2))
        }

        updateNoticeAnimation()

        const observer = new ResizeObserver(updateNoticeAnimation)

        if (noticeViewportRef.current) {
            observer.observe(noticeViewportRef.current)
        }
        if (noticeTextRef.current) {
            observer.observe(noticeTextRef.current)
        }

        window.addEventListener('resize', updateNoticeAnimation)

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', updateNoticeAnimation)
        }
    }, [noticeText])

    const handleClaimFeeExempt = async () => {
        if (claimingFeeExempt) {
            return
        }

        try {
            if (!address) {
                toast.error(t('common.connectWalletFirst'))
                return
            }

            setClaimingFeeExempt(true)
            if (isFeeExemptAccount) {
                toast.success(t('home.alreadyMarketMaker'))
                return
            }

            const claim = await claimFeeExempt()
            const hash = await writeContract({
                chainId: appChainId,
                address: market.address,
                abi: market.abi,
                functionName: 'setFeeExempt',
                args: [claim.account, claim.exempt, claim.signature],
            })

            await waitForTransactionReceipt(wagmiConfig, {
                hash,
            })
            try {
                await syncMarketMaker()
            } catch {
                // 市场页面会再次对比链上状态并补充同步。
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['profile'] }),
                queryClient.invalidateQueries({ queryKey: ['fee-exempt-account', address] }),
                queryClient.invalidateQueries({ queryKey: ['market', 'orders'] }),
            ])
            toast.success(t('home.applySuccess'))
        } catch (error) {
            toast.error(
                error instanceof Error && error.message === 'api.MARKET_MAKER_REQUIREMENTS_NOT_MET'
                    ? t(error.message)
                    : t('home.applyFailed'),
            )
        } finally {
            setClaimingFeeExempt(false)
        }
    }

    const handleClaimFreeMiner = async () => {
        if (claimingFreeMiner) {
            return
        }

        try {
            if (!address) {
                toast.error(t('common.connectWalletFirst'))
                return
            }

            if (freeMinerClaimed) {
                toast.success(t('home.freeMinerClaimed'))
                return
            }

            setClaimingFreeMiner(true)
            const hash = await writeContract({
                chainId: appChainId,
                address: mining.address,
                abi: mining.abi,
                functionName: 'claimFreeMiner',
            })

            await waitForTransactionReceipt(wagmiConfig, {
                hash,
            })
            await submitFreeMinerHash(hash)
            await waitForFreeMinerHash(hash)
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['miners', 'free', 'my'] }),
                queryClient.invalidateQueries({ queryKey: ['miners', 'my'] }),
                queryClient.invalidateQueries({ queryKey: ['mining', 'claimed-free-miners'] }),
                queryClient.invalidateQueries({ queryKey: ['profile'] }),
            ])
            toast.success(t('home.claimFreeMinerSuccess'))
        } catch (error) {
            toast.error(t(getApiErrorMessage(error, 'common.walletActionFailed') || 'home.claimFreeMinerFailed'))
        } finally {
            setClaimingFreeMiner(false)
        }
    }

    const noticeDuration = Math.max(
        MIN_NOTICE_SCROLL_DURATION_SECONDS,
        noticeDistance / NOTICE_SCROLL_SPEED_PX_PER_SECOND,
    )
    const noticeTrackStyle = {
        '--notice-distance': `${noticeDistance}px`,
        '--notice-duration': `${noticeDuration}s`,
    } as CSSProperties
    const minersInitialLoading = minersQuery.isLoading || freeMinerClaimEnabledLoading
    const minersRefreshing = minersQuery.isFetching && !minersInitialLoading

    return (
        <div>
            <div className={styles.top}>
                <img className={styles.logo} src={Logo} alt="Logo" />
                <div className={styles.text_con}>
                    <span>{t('home.title')}</span>
                    <span>{t('home.subtitle')}</span>
                    <span>{t('home.desc')}</span>
                </div>

                <div className={styles.notice_con}>
                    <div className={styles.left}>
                        <span>{t('home.notice')}</span>
                        <div className={styles.notice_text} ref={noticeViewportRef}>
                            {noticeLoading
                                ? <span className={styles.notice_skeleton} />
                                : (
                                    <div className={styles.notice_track} style={noticeTrackStyle}>
                                        {Array.from({ length: noticeRepeatCount }).map((_, index) => (
                                            <span ref={index === 0 ? noticeTextRef : undefined} key={index}>{noticeText}</span>
                                        ))}
                                    </div>
                                )}
                        </div>
                    </div>
                    <div className={styles.right} onClick={() => navigate('/notice')}>
                        <span>{t('home.details')}</span>
                        <img src={Arrow} alt="Notice" />
                    </div>
                </div>
            </div>

            <div className={styles.activity}>
                <button type="button" className={styles.card} onClick={handleClaimFeeExempt}>
                    <span>{claimingFeeExempt ? t('home.applying') : t('home.applyMarketMaker')}</span>
                    <span>{t('home.becomeMarketMaker')}</span>
                    <span>{t('home.earnMore')}</span>
                </button>
                <button type="button" className={styles.card} onClick={() => navigate('/node')}>
                    <span>{t('home.nodeTitle')}</span>
                    <span>{t('home.nodeDescription')}</span>
                    <span>{t('home.nodeAction')}</span>
                </button>
            </div>

            <div className={styles.miners}>
                <p>{t('home.allMiners')}</p>
                <div className={styles.miner_list}>
                    <FetchingOverlay loading={minersRefreshing} />
                    {minersInitialLoading
                        ? Array.from({ length: 3 }).map((_, index) => (
                            <div className={`${styles.miner} ${styles.miner_skeleton}`} key={index}>
                                <div />
                                <div>
                                    <span />
                                    <span />
                                    <span />
                                </div>
                                <div>
                                    <span />
                                    <span />
                                </div>
                            </div>
                        ))
                        : (
                            <>
                                {freeMinerClaimEnabled && (
                                    <div className={styles.miner}>
                                        <img
                                            src={freeMinerImage}
                                            alt={t('home.claimFreeMiner', { value: freeMinerConfigQuery.data ? formatAmount(freeMinerConfigQuery.data.price, { display: true }) : '—' })}
                                            onError={(event) => {
                                                if (!event.currentTarget.src.endsWith(fallbackMinerImage)) {
                                                    event.currentTarget.src = fallbackMinerImage
                                                }
                                            }}
                                        />
                                        <div className={styles.info}>
                                            <span className={styles.miner_title}>
                                                {t('home.claimFreeMiner', { value: freeMinerConfigQuery.data ? formatAmount(freeMinerConfigQuery.data.price, { display: true }) : '—' })}
                                                <em>{t('common.free')}</em>
                                            </span>
                                            <span>{t('home.claimFreeMinerDesc')}</span>
                                            {(freeMinerConfigQuery.isError || freeMinerAmountQuery.isError) && <span role="alert">{t('miner.loadFailed')}</span>}
                                            <div className={styles.data}>
                                                <div>
                                                    <span>{t('home.output')}</span>
                                                    <span>{freeMinerAmountQuery.data !== undefined ? formatAmount(freeMinerAmountQuery.data, { display: true }) : '—'} SPACE</span>
                                                </div>
                                                <div>
                                                    <span>{t('home.cycle')}</span>
                                                    <span>{freeMinerConfigQuery.data?.initialCycleDays ?? '—'} {t('common.days')}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className={styles.right}>
                                            <span className={styles.free_price}>
                                                <s>{freeMinerConfigQuery.data ? formatAmount(freeMinerConfigQuery.data.price, { display: true }) : '—'} <span>SPACE</span></s>
                                                <span>0 <span>SPACE</span></span>
                                            </span>
                                            <button
                                                className={styles.buy}
                                                disabled={!freeMinerConfigQuery.data || freeMinerAmountQuery.data === undefined || claimingFreeMiner || Boolean(freeMinerClaimed)}
                                                onClick={handleClaimFreeMiner}
                                            >
                                                {claimingFreeMiner
                                                    ? <LoadingLabel text={t('home.claimingFreeMiner')} />
                                                    : freeMinerClaimed ? t('home.owned') : t('home.claimNow')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {miners.map((miner) => (
                                    <div className={styles.miner} key={miner.id}>
                                        <img
                                            src={getMinerPresentation(miner.id, miner.desc).image}
                                            alt={miner.name}
                                            onError={(event) => {
                                                if (!event.currentTarget.src.endsWith(fallbackMinerImage)) {
                                                    event.currentTarget.src = fallbackMinerImage
                                                }
                                            }}
                                        />
                                        <div className={styles.info}>
                                            <span>{miner.name}</span>
                                            <span>{t(getMinerPresentation(miner.id, miner.desc).description)}</span>
                                            <div className={styles.data}>
                                                <div>
                                                    <span>{t('home.output')}</span>
                                                    <span>{formatAmount(miner.expectedReward, { display: true })} SPACE</span>
                                                </div>
                                                <div>
                                                    <span>{t('home.cycle')}</span>
                                                    <span>{minerCycle ?? '--'} {t('common.days')}</span>
                                                </div>
                                                <div>
                                                    <span>{t('home.saleStatus')}</span>
                                                    <span>{miner.isPurchasable ? t('home.onSale') : t('home.notOnSale')}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className={styles.right}>
                                            <span>{formatAmount(miner.price, { display: true, fractionDigits: 3 })} <span>SPACE</span></span>
                                            <button
                                                className={styles.buy}
                                                disabled={miner.isOwned || !miner.isPurchasable || Boolean(buyingMinerId)}
                                                onClick={() => openPaymentModal(miner)}
                                            >
                                                {miner.isOwned
                                                    ? t('home.owned')
                                                    : buyingMinerId === miner.id
                                                        ? <LoadingLabel text={t('common.processing')} />
                                                        : t('home.buy')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}
                </div>
            </div>

            <div className={styles.bottom}>
                <div>
                    <img src={Safety} alt="Safety" />
                    <div>
                        <span>{t('home.secure')}</span>
                        <span>{t('home.secureDesc')}</span>
                    </div>
                </div>
                <div>
                    <img src={Transparent} alt="Transparent" />
                    <div>
                        <span>{t('home.transparent')}</span>
                        <span>{t('home.transparentDesc')}</span>
                    </div>
                </div>
                <div>
                    <img src={Efficient} alt="Efficient" />
                    <div>
                        <span>{t('home.efficient')}</span>
                        <span>{t('home.efficientDesc')}</span>
                    </div>
                </div>
            </div>
            <MinerPaymentModal purchase={minerPurchase} />
        </div>
    );
}

export default IndexPage;
