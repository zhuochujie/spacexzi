import LedgerIcon from '../../components/icons/ledger-icon'
import { formatTokenSymbol } from '../../utils/token'
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router"
import { useConnection, useWriteContract } from "wagmi"
import { readContract, waitForTransactionReceipt } from "@wagmi/core"
import AvatarImage from "./images/avatar.svg"
import { toast } from "react-hot-toast"
import { clearAccessToken, getLoginAddress, getMarketLatestPrice, getProfile, getWithdrawFeeBps, withdraw, withdrawUsdt, type WithdrawToken } from "../../api"
import Modal from "../../components/modal"
import SkeletonText from "../../components/skeleton-text"
import { getFriendlyErrorKey, useI18n } from "../../i18n"
import { formatAmount, parseTokenAmount } from "../../utils/format"
import { formatAddress } from "../../utils/address"
import { market, mining } from "../../web3/constants"
import { appChainId, wagmiConfig } from "../../web3/config"
import styles from "./index.module.css"
import SpaceIcon from "./images/token2.svg"
import UsdtIcon from "./images/USDT.svg"
import VisibleIcon from "./images/visible.svg"
import InvisibleIcon from "./images/invisible.svg"
import DividendSummaryModal from "./dividend-summary-modal"

function getWithdrawFee(amount: bigint, totalFeeBp: string | undefined) {
    if (amount <= 0n) {
        return 0n
    }

    const feeBp = BigInt(totalFeeBp || '0')

    if (feeBp <= 0n) {
        return 0n
    }

    return amount * feeBp / 10_000n
}

type PersonalIconKind = 'dividend' | 'withdraw' | 'language' | 'team' | 'ecosystem' | 'about' | 'logout'

function PersonalIcon({ kind }: { kind: PersonalIconKind }) {
    const paths: Record<PersonalIconKind, string> = {
        dividend: 'M12 3v9h9a9 9 0 1 1-9-9Zm3 .5A9 9 0 0 1 20.5 9H15V3.5Z',
        withdraw: 'M12 18V4m-6 6 6-6 6 6M4 20h16',
        language: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
        team: 'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 21v-2a7 7 0 0 1 14 0v2M18 5a3 3 0 0 1 0 6m3 9v-2a5 5 0 0 0-3-4',
        ecosystem: 'm12 3 8 5v8l-8 5-8-5V8l8-5ZM4 8l8 5 8-5m-8 5v8',
        about: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10h.01',
        logout: 'M10 4H4v16h6m4-12 4 4-4 4m-6-4h10',
    }
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[kind]} /></svg>
}

function PersonalPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { t, language, setLanguage } = useI18n()
    const { address } = useConnection()
    const { mutateAsync: writeContract } = useWriteContract()
    const [assetVisible, setAssetVisible] = useState(true)
    const [withdrawOpen, setWithdrawOpen] = useState(false)
    const [languageOpen, setLanguageOpen] = useState(false)
    const [dividendSummaryOpen, setDividendSummaryOpen] = useState(false)
    const [withdrawToken, setWithdrawToken] = useState<WithdrawToken>('SPACE')
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [withdrawing, setWithdrawing] = useState(false)
    const { data: profile, isLoading: profileLoading } = useQuery({
        queryKey: ['profile'],
        queryFn: getProfile,
        staleTime: 30_000,
    })
    const { data: latestPrice, isLoading: latestPriceLoading } = useQuery({
        queryKey: ['market', 'latest-price'],
        queryFn: getMarketLatestPrice,
        staleTime: 20_000,
    })
    const { data: isFeeExemptAccount } = useQuery({
        queryKey: ['fee-exempt-account', address],
        queryFn: () => {
            if (!address) {
                return false
            }

            return readContract(wagmiConfig, {
                address: market.address,
                abi: market.abi,
                functionName: 'feeExemptAccounts',
                args: [address],
            })
        },
        enabled: Boolean(address),
        staleTime: 60_000,
    })
    const { data: withdrawFeeBps } = useQuery({
        queryKey: ['withdraw-fee-bps'],
        queryFn: getWithdrawFeeBps,
        enabled: withdrawOpen && withdrawToken === 'SPACE',
        staleTime: 60_000,
    })
    const displayAddress = profile?.address || getLoginAddress() || address
    const spaceBalance = formatAmount(profile?.balance, { display: true })
    const usdtBalance = formatAmount(profile?.usdtBalance, { display: true })
    const totalAssetValue = BigInt(profile?.usdtBalance || '0') + BigInt(profile?.balance || '0') * BigInt(latestPrice?.price || '0') / 10n ** 18n
    const assetValueLoading = profileLoading || latestPriceLoading
    const withdrawAmountWei = parseTokenAmount(withdrawAmount)
    const withdrawBalanceWei = BigInt(withdrawToken === 'SPACE' ? profile?.withdrawableBalance || '0' : profile?.usdtBalance || '0')
    const withdrawFeeWei = withdrawToken === 'SPACE' ? getWithdrawFee(withdrawAmountWei, withdrawFeeBps?.totalFeeBp) : 0n
    const withdrawReceiveWei = withdrawAmountWei > withdrawFeeWei ? withdrawAmountWei - withdrawFeeWei : 0n
    const isWithdrawAmountValid = withdrawAmountWei > 0n && withdrawAmountWei <= withdrawBalanceWei && (withdrawToken !== 'SPACE' || profile?.canWithdrawSpace === true)
    const maxWithdrawAmount = formatAmount(withdrawBalanceWei, { fractionDigits: 18 })

    const handleLogout = () => {
        clearAccessToken()
        queryClient.clear()
    }

    const closeWithdrawModal = () => {
        if (withdrawing) {
            return
        }

        setWithdrawOpen(false)
        setWithdrawAmount('')
        setWithdrawToken('SPACE')
    }

    const handleWithdraw = async () => {
        try {
            if (!address) {
                toast.error(t('common.connectWalletFirst'))
                return
            }

            if (!isWithdrawAmountValid) {
                toast.error(t('personal.invalidWithdrawAmount'))
                return
            }

            setWithdrawing(true)
            const signature = withdrawToken === 'SPACE'
                ? await withdraw(withdrawAmountWei.toString())
                : await withdrawUsdt(withdrawAmountWei.toString())
            const hash = await writeContract({
                chainId: appChainId,
                address: mining.address,
                abi: mining.abi,
                functionName: withdrawToken === 'SPACE' ? 'claim' : 'withdrawUsdt',
                args: withdrawToken === 'SPACE'
                    ? [
                        BigInt(signature.amount),
                        BigInt(signature.vipFee || '0'),
                        BigInt(signature.nodeFee || '0'),
                        signature.nonce,
                        BigInt(signature.deadline),
                        signature.signature,
                    ]
                    : [
                        BigInt(signature.amount),
                        signature.nonce,
                        BigInt(signature.deadline),
                        signature.signature,
                    ],
            })

            await waitForTransactionReceipt(wagmiConfig, {
                hash,
            })
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['profile'] }),
                queryClient.invalidateQueries({ queryKey: ['balance-logs'] }),
                queryClient.invalidateQueries({ queryKey: ['wallet-balances'] }),
            ])
            toast.success(t('personal.withdrawSuccess'))
            setWithdrawOpen(false)
            setWithdrawAmount('')
        } catch (error) {
            toast.error(error instanceof Error ? t(getFriendlyErrorKey(error.message, 'common.walletActionFailed')) : t('personal.withdrawFailed'))
        } finally {
            setWithdrawing(false)
        }
    }

    return (
        <div className={styles.page}>
            <h1 className={styles.profile_caption}>{t('personal.accountLabel')}</h1>
            <div className={styles.profile_card}>
                <div className={styles.avatar} aria-hidden="true"><img src={AvatarImage} alt="" /></div>
                <div className={styles.profile_info}>
                    <span className={styles.address_btn}>
                        {formatAddress(displayAddress)}
                    </span>
                    <div className={styles.profile_badges}>
                        {profileLoading
                            ? (
                                <>
                                    <SkeletonText width={58} height={20} />
                                    <SkeletonText width={70} height={20} />
                                </>
                            )
                            : (
                                <>
                                    <span>VIP {profile?.vipLevel ?? 0}</span>
                                    <span>{t('personal.nodeBadge', { level: profile?.nodeLevel ?? 0 })}</span>
                                </>
                            )}
                        {isFeeExemptAccount && <span>Maker</span>}
                    </div>
                </div>
            </div>

            <div className={styles.balance_card}>
                <div className={styles.asset_total}>
                    <div>
                        <span>{t('personal.totalAssetValue')}</span>
                        <button
                            type="button"
                            aria-label={assetVisible ? t('personal.hideAssets') : t('personal.showAssets')}
                            onClick={() => setAssetVisible((visible) => !visible)}
                        >
                            <img src={assetVisible ? VisibleIcon : InvisibleIcon} alt="" />
                        </button>
                    </div>
                    <strong>
                        {assetVisible && assetValueLoading ? <SkeletonText width={132} height={32} /> : (
                            <><span className={styles.approx}>≈</span><span className={styles.asset_number}>{assetVisible ? formatAmount(totalAssetValue, { display: true }) : '••••••'}</span><small>USDT</small></>
                        )}
                    </strong>
                </div>
                <div className={styles.token_grid}>
                    <div>
                        <img src={SpaceIcon} alt="" />
                        <div>
                            <span>SpaceXZI</span>
                            <strong>{assetVisible ? profileLoading ? <SkeletonText width={64} height={15} /> : spaceBalance : '***'}</strong>
                        </div>
                    </div>
                    <div>
                        <img src={UsdtIcon} alt="" />
                        <div>
                            <span>USDT</span>
                            <strong>{assetVisible ? profileLoading ? <SkeletonText width={64} height={15} /> : usdtBalance : '***'}</strong>
                        </div>
                    </div>
                </div>
                <div className={styles.asset_action}>
                    <button className={styles.withdraw_btn} type="button" onClick={() => setWithdrawOpen(true)}><PersonalIcon kind="withdraw" />{t('personal.withdraw')}</button>
                    <button className={styles.history_btn} type="button" onClick={() => navigate('/personal/balance-logs')}><LedgerIcon />{t('personal.balanceDetails')}</button>
                </div>
            </div>

            <div className={styles.section_heading}><h2>{t('personal.services')}</h2></div>
            <div className={styles.menu_card}>
                <button type="button" onClick={() => setLanguageOpen(true)}>
                    <span className={styles.menu_label}><i className={styles.menu_icon}><PersonalIcon kind="language" /></i>{t('login.language')}</span>
                    <em className={styles.language_current}><small>{t(`login.${language}`)}</small>›</em>
                </button>
                <button type="button" onClick={() => setDividendSummaryOpen(true)}>
                    <span className={styles.menu_label}><i className={styles.menu_icon}><PersonalIcon kind="dividend" /></i>{t('dividendSummary.title')}</span>
                    <em>›</em>
                </button>
                <button type="button" onClick={() => navigate('/personal/team')}>
                    <span className={styles.menu_label}><i className={styles.menu_icon}><PersonalIcon kind="team" /></i>{t('personal.myTeam')}</span>
                    <em>›</em>
                </button>
                <button type="button" onClick={() => toast(t('common.comingSoon'))}>
                    <span className={styles.menu_label}><i className={styles.menu_icon}><PersonalIcon kind="ecosystem" /></i>{t('personal.subEcosystem')}</span>
                    <em>›</em>
                </button>
                <button type="button" onClick={() => navigate('/personal/about')}>
                    <span className={styles.menu_label}><i className={styles.menu_icon}><PersonalIcon kind="about" /></i>{t('personal.aboutUs')}</span>
                    <em>›</em>
                </button>
            </div>

            <button className={styles.logout_btn} type="button" onClick={handleLogout}>
                <PersonalIcon kind="logout" />{t('personal.logout')}
            </button>

            <Modal
                open={languageOpen}
                title="login.language"
                confirmText="common.cancel"
                showCancel={false}
                onConfirm={() => setLanguageOpen(false)}
                onCancel={() => setLanguageOpen(false)}
            >
                <div className={styles.language_options} role="group" aria-label={t('login.language')}>
                    {(['en', 'th', 'ko', 'zh'] as const).map((item) => (
                        <button
                            type="button"
                            key={item}
                            aria-pressed={language === item}
                            onClick={() => {
                                void setLanguage(item)
                                setLanguageOpen(false)
                            }}
                        >
                            <span>{t(`login.${item}`)}</span>
                            {language === item && <span aria-hidden="true">✓</span>}
                        </button>
                    ))}
                </div>
            </Modal>

            <DividendSummaryModal
                open={dividendSummaryOpen}
                onClose={() => setDividendSummaryOpen(false)}
            />

            <Modal
                open={withdrawOpen}
                title="personal.withdraw"
                confirmText={withdrawing ? 'personal.withdrawing' : 'personal.confirmWithdraw'}
                confirmLoading={withdrawing}
                confirmDisabled={!isWithdrawAmountValid || withdrawing}
                onCancel={closeWithdrawModal}
                onConfirm={handleWithdraw}
            >
                <div className={styles.withdraw_form}>
                    <label>
                        <span>{t('personal.selectToken')}</span>
                        <div className={styles.token_tabs}>
                            <button className={withdrawToken === 'SPACE' ? styles.token_tab_active : ''} type="button" onClick={() => setWithdrawToken('SPACE')}>SpaceXZI</button>
                            <button className={withdrawToken === 'USDT' ? styles.token_tab_active : ''} type="button" onClick={() => setWithdrawToken('USDT')}>USDT</button>
                        </div>
                    </label>
                    <label>
                        <span className={styles.withdraw_amount_label}>
                            {t('personal.withdrawAmount')}
                            <em>{t('personal.withdrawableBalance')}{profileLoading ? <SkeletonText width={60} height={11} /> : withdrawToken === 'SPACE' ? formatAmount(withdrawBalanceWei, { display: true }) : usdtBalance} {formatTokenSymbol(withdrawToken)}</em>
                        </span>
                        <div className={styles.withdraw_input}>
                            <input
                                value={withdrawAmount}
                                placeholder={t('market.enterAmount')}
                                inputMode="decimal"
                                onChange={(event) => setWithdrawAmount(event.target.value)}
                            />
                            <button type="button" onClick={() => setWithdrawAmount(maxWithdrawAmount)}>
                                {t('common.max')}
                            </button>
                        </div>
                    </label>
                    {withdrawToken === 'SPACE' && (
                        <div className={styles.withdraw_fee_row}>
                            <div>
                                {t('personal.withdrawFee')}{formatAmount(withdrawFeeWei, { display: true })} SpaceXZI
                            </div>
                            <div>
                                {t('personal.withdrawReceive')}{formatAmount(withdrawReceiveWei, { display: true })} SpaceXZI
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    )
}

export default PersonalPage
