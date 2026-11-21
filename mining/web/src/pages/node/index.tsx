import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useConnection, useWriteContract } from 'wagmi'
import { readContract, waitForTransactionReceipt } from '@wagmi/core'
import { erc20Abi, formatUnits, zeroAddress } from 'viem'
import { toast } from 'react-hot-toast'
import { getLoginAddress } from '../../api'
import {
    getNodeReferralStats,
    getPendingNodePurchase,
    getNodeNonce,
    purchaseNode,
    submitNodeNonce,
} from '../../node-api'
import { appChain, appChainId, ensureAppChain, wagmiConfig } from '../../web3/config'
import { node, usdtToken } from '../../web3/constants'
import { getNodeChainOverview } from '../../web3/node'
import { getFriendlyErrorKey, useI18n } from '../../i18n'
import logo from '../../assets/brand/spacexzi-logo-transparent.png'
import art from './node.svg'
import styles from './landing.module.css'

export default function NodePage() {
    const { t, language } = useI18n()
    const navigate = useNavigate()
    const client = useQueryClient()
    const connection = useConnection()
    const { mutateAsync: write } = useWriteContract()
    const [busy, setBusy] = useState(false)
    const [stage, setStage] = useState('')
    const [nonce, setNonce] = useState('')
    const [selectedTierIndex, setSelectedTierIndex] = useState<number | null>(
        null,
    )
    const [referralOpen, setReferralOpen] = useState(false)
    const referralDialog = useRef<HTMLDialogElement>(null)
    useEffect(() => {
        const dialog = referralDialog.current
        if (referralOpen && dialog && !dialog.open) dialog.showModal()
        if (!referralOpen && dialog?.open) dialog.close()
    }, [referralOpen])
    const address = connection.address || getLoginAddress()
    const overview = useQuery({
        queryKey: ['node', 'chain', address],
        queryFn: () => getNodeChainOverview(address as `0x${string}`),
        enabled: Boolean(address),
        refetchInterval: 15_000,
    })
    const pending = useQuery({
        queryKey: ['node', 'pending', address],
        queryFn: getPendingNodePurchase,
        enabled: Boolean(address),
        refetchInterval: 15_000,
    })
    const referral = useQuery({
        queryKey: ['node', 'referral', address],
        queryFn: getNodeReferralStats,
        enabled: referralOpen && Boolean(address),
        refetchInterval: referralOpen ? 15_000 : false,
    })
    const data = overview.data && { ...overview.data, pending: pending.data }
    const referralData = referral.data
    const pendingNonce = nonce || data?.pending?.nonce || ''
    const status = useQuery({
        queryKey: ['node', 'nonce', pendingNonce],
        enabled: Boolean(pendingNonce),
        queryFn: async () => {
            await submitNodeNonce(pendingNonce).catch(() => undefined)
            return getNodeNonce(pendingNonce)
        },
        refetchInterval: (query) =>
            !query.state.data || query.state.data.status === 'pending'
                ? 5000
                : false,
    })
    useEffect(() => {
        if (!status.data || status.data.status === 'pending') return
        void client.invalidateQueries({ queryKey: ['node'] })
        void client.invalidateQueries({ queryKey: ['profile'] })
    }, [status.data, client])
    const display = (amount: string) =>
        Number(
            formatUnits(BigInt(amount), data?.decimals ?? 18),
        ).toLocaleString(({ zh: 'zh-CN', en: 'en-US', th: 'th-TH', ko: 'ko-KR' })[language], { maximumFractionDigits: 4 })
    async function buy(index: number) {
        if (busy || !data) return
        setBusy(true)
        try {
            const buyer = connection.address
            if (!buyer || buyer.toLowerCase() !== getLoginAddress())
                throw new Error(t('node.walletMismatch'))
            if (node.address === zeroAddress)
                throw new Error(t('node.notConfigured'))
            await ensureAppChain(connection)
            const amount = BigInt(data.levels[index].price) -
                (data.level ? BigInt(data.levels[data.level - 1].price) : 0n)
            const balance = await readContract(wagmiConfig, {
                address: usdtToken,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [buyer],
            })
            if (balance < amount)
                throw new Error(t('common.insufficientBalance'))
            const allowance = await readContract(wagmiConfig, {
                address: usdtToken,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [buyer, node.address],
            })
            if (allowance < amount) {
                setStage('node.approving')
                const approval = await write({
                    chainId: appChainId,
                    address: usdtToken,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [node.address, amount],
                })
                const receipt = await waitForTransactionReceipt(wagmiConfig, {
                    hash: approval,
                })
                if (receipt.status !== 'success')
                    throw new Error(t('common.walletActionFailed'))
            }
            setStage('node.signing')
            const signature = await purchaseNode(index)
            if (signature.deadline <= Math.floor(Date.now() / 1000))
                throw new Error(t('node.expired'))
            setNonce(signature.nonce)
            const args = [
                BigInt(signature.targetLevelIndex),
                BigInt(signature.amount),
                BigInt(signature.rewardAmount),
                signature.nonce,
                BigInt(signature.deadline),
                signature.signature,
            ] as const
            setStage('node.confirming')
            const hash =
                signature.action === 'purchase'
                    ? await write({
                          chainId: appChainId,
                          ...node,
                          functionName: 'purchase',
                          args,
                      })
                    : await write({
                          chainId: appChainId,
                          ...node,
                          functionName: 'upgrade',
                          args: [BigInt(signature.fromLevel), ...args],
                      })
            const receipt = await waitForTransactionReceipt(wagmiConfig, {
                hash,
            })
            if (receipt.status !== 'success')
                throw new Error(t('common.walletActionFailed'))
            await submitNodeNonce(signature.nonce).catch(() => undefined)
            toast.success(t('node.submitted'))
        } catch (error) {
            const message = error instanceof Error ? error.message : ''
            const nodeErrors: Record<string, string> = {
                NODE_PURCHASE_PENDING: 'node.purchasePending',
                NODE_PURCHASE_PAUSED: 'node.paused',
                NODE_INVALID_LEVEL: 'node.invalidLevel',
                NODE_SIGNATURE_NOT_FOUND: 'node.signatureNotFound',
                NODE_DEPLOYMENT_MISMATCH: 'node.configMismatch',
                NODE_MINING_CONFIG_MISMATCH: 'node.configMismatch',
                NODE_USDT_CONFIG_MISMATCH: 'node.configMismatch',
            }
            const localMessages = ['node.walletMismatch', 'node.notConfigured', 'common.insufficientBalance', 'common.walletActionFailed', 'node.expired']
            const localMessage = localMessages.find((key) => t(key) === message)
            const cancelled = /user rejected|user denied|rejected the request/i.test(message)
            toast.error(t(localMessage ?? nodeErrors[message] ?? (cancelled ? 'node.cancelled' : message.startsWith('api.') ? message : getFriendlyErrorKey(message, 'node.failed'))))
        } finally {
            setBusy(false)
            setStage('')
            await client.invalidateQueries({ queryKey: ['node'] })
        }
    }
    const selectableLevels =
        data?.levels.filter(
            (level) => level.enabled && level.index + 1 > data.level,
        ) ?? []
    const activeTier = data?.pending
        ? data.levels.find(
              (level) => level.index === data.pending?.targetLevelIndex,
          )
        : (selectableLevels.find(
              (level) => level.index === selectedTierIndex,
          ) ?? selectableLevels[0])
    const currentTier = data?.levels.find(
        (level) => level.index + 1 === data.level,
    )
    const tierName = (name: string, level: number) => {
        const defaults: Record<string, string> = { Starter: 'node.tierStarter', Core: 'node.tierCore', Elite: 'node.tierElite', Prime: 'node.tierPrime' }
        return defaults[name] ? t(defaults[name]) : name || t('node.tierNumber', { level })
    }
    const currentPrice = currentTier ? BigInt(currentTier.price) : 0n
    const shortAddress = address
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : '—'
    const awaitingConfirmation = Boolean(
        data?.pending || (pendingNonce && (!status.data || status.data.status === 'pending')),
    )
    const primaryDisabled =
        busy || !data || !pending.isSuccess || data.paused || !activeTier || awaitingConfirmation
    const primaryLabel = busy
        ? t(stage || 'common.processing')
        : data?.paused
          ? t('node.paused')
          : awaitingConfirmation
            ? t('node.landing.awaiting')
            : data && !selectableLevels.length
              ? t('node.landing.highest')
              : data?.level
                ? t('node.upgrade')
                : t('node.purchase')
    const stats = referralData
        ? [
              [t('node.direct'), String(referralData.directCount)],
              [
                  t('node.directPerformance'),
                  `${display(referralData.directPerformance)} USDT`,
              ],
              [t('node.teamCount'), String(referralData.teamCount)],
              [
                  t('node.teamPerformance'),
                  `${display(referralData.teamPerformance)} USDT`,
              ],
          ]
        : []
    return (
        <main className={styles.page}>
            <header className={styles['site-header']}>
                <div className={styles['brand-lockup']}>
                    <button
                        className={styles['back-button']}
                        type="button"
                        aria-label={t('common.back')}
                        onClick={() => navigate('/index')}
                    >
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg>
                    </button>
                    <div className={styles['brand-text']}>
                        <span className={styles['brand-logo']}>
                            <img src={logo} alt="SpaceXZI" />
                        </span>
                    </div>
                </div>
                <span
                    className={styles['wallet-button']}
                    title={address || undefined}
                >
                    {shortAddress}
                </span>
            </header>

            <section className={styles['hero-shell']}>
                <div className={styles['hero-copy']}>
                    <span className={styles.eyebrow}>{t('node.landing.accessLabel')}</span>
                    <h1>{t('node.landing.heading')}</h1>
                    <p className={styles['hero-text']}>
                        {t('node.landing.description')}
                    </p>
                    <div className={styles['hero-visual']}>
                        <img src={art} alt="" />
                    </div>
                </div>
                <div className={styles['hero-module']}>
                    <div className={styles['module-head']}>
                        <span className={styles['module-label']}>
                            {t('node.current')}
                        </span>
                        <strong className={styles['module-current-tier']}>
                            {overview.isLoading
                                ? '—'
                                : data?.level
                                  ? tierName(currentTier?.name ?? '', data.level)
                                  : t('node.inactive')}
                        </strong>
                    </div>
                    {overview.isLoading && (
                        <p role="status" className={styles['module-note']}>
                            {t('common.loading')}
                        </p>
                    )}
                    {overview.isError && (
                        <div role="alert">
                            <p className={styles['module-note']}>
                                {t('node.loadFailed')}
                            </p>
                            <button
                                type="button"
                                className={styles['secondary-action']}
                                onClick={() => void overview.refetch()}
                            >
                                {t('node.refresh')}
                            </button>
                        </div>
                    )}
                    <div className={styles['tier-row']}>
                        {data?.levels.map((tier) => {
                            const owned = data.level >= tier.index + 1
                            return (
                                <button
                                    type="button"
                                    key={tier.index}
                                    className={`${styles['tier-chip']} ${activeTier?.index === tier.index ? styles['is-active'] : ''}`}
                                    aria-pressed={
                                        activeTier?.index === tier.index
                                    }
                                    disabled={
                                        owned ||
                                        !tier.enabled ||
                                        busy ||
                                        !pending.isSuccess ||
                                        awaitingConfirmation
                                    }
                                    onClick={() =>
                                        setSelectedTierIndex(tier.index)
                                    }
                                >
                                    <span>
                                        {tierName(tier.name, tier.index + 1)}
                                        {owned && (
                                            <small>{t('node.owned')}</small>
                                        )}
                                        {!tier.enabled && (
                                            <small>
                                                {t('node.unavailable')}
                                            </small>
                                        )}
                                    </span>
                                    {data.level > 0 && !owned ? (
                                        <strong
                                            className={
                                                styles['tier-price-group']
                                            }
                                        >
                                            <em
                                                className={
                                                    styles[
                                                        'tier-price-original'
                                                    ]
                                                }
                                            >
                                                {display(tier.price)} USDT
                                            </em>
                                            <b>
                                                {display(
                                                    (
                                                        BigInt(tier.price) -
                                                        currentPrice
                                                    ).toString(),
                                                )}{' '}
                                                USDT
                                            </b>
                                        </strong>
                                    ) : (
                                        <strong>
                                            {display(tier.price)} USDT
                                        </strong>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                    <p className={styles['module-note']}>
                        {t('node.landing.pricingNote')}
                    </p>
                    <div className={styles['referral-data']}>
                        <button
                            className={styles['referral-trigger']}
                            type="button"
                            disabled={!data}
                            onClick={() => setReferralOpen(true)}
                        >
                            {t('node.landing.referralData')}
                        </button>
                    </div>
                    {pending.isError && (
                        <button type="button" onClick={() => void pending.refetch()}>
                            {t('node.loadFailed')} · {t('node.refresh')}
                        </button>
                    )}
                    <div className={styles['module-actions']}>
                        <button
                            type="button"
                            className={styles['primary-action']}
                            disabled={primaryDisabled}
                            onClick={() =>
                                activeTier && void buy(activeTier.index)
                            }
                        >
                            {primaryLabel}
                        </button>
                    </div>
                </div>
            </section>

            <section className={styles['content-block']}>
                <div className={styles['section-heading']}>
                    <span className={styles.eyebrow}>{t('node.landing.valueLabel')}</span>
                    <h2>{t('node.landing.valueHeading')}</h2>
                </div>
                <div className={styles['card-stack']}>
                    {[1, 2, 3].map((item) => (
                        <article className={styles['info-card']} key={item}>
                            <span className={styles['card-number']}>
                                0{item}
                            </span>
                            <h3>{t(`node.landing.value${item}Title`)}</h3>
                            <p>{t(`node.landing.value${item}Text`)}</p>
                        </article>
                    ))}
                </div>
            </section>
            <section className={styles['content-block']}>
                <div className={styles['section-heading']}>
                    <span className={styles.eyebrow}>{t('node.landing.processLabel')}</span>
                    <h2>{t('node.landing.processHeading')}</h2>
                </div>
                <article className={styles['flow-card']}>
                    {[1, 2, 3].map((step) => (
                        <div className={styles['flow-step']} key={step}>
                            <span>0{step}</span>
                            <p>{t(`node.landing.step${step}`, { chainName: appChain.name })}</p>
                        </div>
                    ))}
                </article>
            </section>
            <section className={styles['content-block']}>
                <div className={styles['section-heading']}>
                    <span className={styles.eyebrow}>{t('node.landing.faqLabel')}</span>
                    <h2>{t('node.landing.faqHeading')}</h2>
                </div>
                <div className={styles['card-stack']}>
                    {[1, 2, 3].map((item) => (
                        <article className={styles['info-card']} key={item}>
                            <h3>{t(`node.landing.faq${item}Question`)}</h3>
                            <p>{t(`node.landing.faq${item}Answer`)}</p>
                        </article>
                    ))}
                </div>
            </section>
            <footer className={styles['site-footer']}>
                <p>{t('node.landing.copyright', { year: new Date().getFullYear() })}</p>
            </footer>

            <dialog
                ref={referralDialog}
                className={styles['referral-modal']}
                onClose={() => setReferralOpen(false)}
                aria-labelledby="node-referral-title"
            >
                <div className={styles['modal-head']}>
                    <div>
                        <span className={styles.eyebrow}>{t('node.landing.referralLabel')}</span>
                        <h2 id="node-referral-title">
                            {t('node.landing.referralData')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        className={styles['modal-close']}
                        onClick={() => setReferralOpen(false)}
                    >
                        {t('node.landing.close')}
                    </button>
                </div>
                {referral.isLoading && <p role="status">{t('common.loading')}</p>}
                {referral.isError && (
                    <div role="alert">
                        <p>{t('node.loadFailed')}</p>
                        <button type="button" onClick={() => void referral.refetch()}>{t('node.refresh')}</button>
                    </div>
                )}
                <div className={styles['modal-stats']}>
                    {[0, 2].map((offset) => (
                        <div className={styles['modal-stats-row']} key={offset}>
                            {stats
                                .slice(offset, offset + 2)
                                .map(([label, value]) => (
                                    <div
                                        className={styles['modal-stat-card']}
                                        key={label}
                                    >
                                        <span>{label}</span>
                                        <strong>{value}</strong>
                                    </div>
                                ))}
                        </div>
                    ))}
                    <div
                        className={`${styles['modal-stat-card']} ${styles['is-wide']}`}
                    >
                        <span>{t('node.totalReward')}</span>
                        <strong>
                            {referralData ? display(referralData.totalReward) : '—'} USDT
                        </strong>
                    </div>
                </div>
            </dialog>
        </main>
    )
}
