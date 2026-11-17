import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router"
import { useConnection, useWriteContract } from "wagmi"
import { readContract, waitForTransactionReceipt } from "@wagmi/core"
import multiavatar from "@multiavatar/multiavatar"
import { toast } from "react-hot-toast"
import { clearAccessToken, getBalanceLogs, getLoginAddress, getMarketLatestPrice, getProfile, getWithdrawFeeBps, withdraw, withdrawUsdt, type WithdrawToken } from "../../api"
import Modal from "../../components/modal"
import SkeletonText from "../../components/skeleton-text"
import { getFriendlyErrorKey, useI18n } from "../../i18n"
import { formatAmount, parseTokenAmount } from "../../utils/format"
import { formatShortDateTime } from "../../utils/date"
import { formatAddress } from "../../utils/address"
import { balanceLogText } from "../../utils/balance-log"
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

function PersonalPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { t } = useI18n()
    const { address } = useConnection()
    const { mutateAsync: writeContract } = useWriteContract()
    const [assetVisible, setAssetVisible] = useState(true)
    const [withdrawOpen, setWithdrawOpen] = useState(false)
    const [dividendSummaryOpen, setDividendSummaryOpen] = useState(false)
    const [withdrawToken, setWithdrawToken] = useState<WithdrawToken>('SPACE')
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [withdrawing, setWithdrawing] = useState(false)
    const { data: profile, isLoading: profileLoading } = useQuery({
        queryKey: ['profile'],
        queryFn: getProfile,
        staleTime: 30_000,
    })
    const { data: logsData, isLoading: logsLoading, isError: logsIsError } = useQuery({
        queryKey: ['balance-logs', 'personal', 1, 3],
        queryFn: () => getBalanceLogs(1, 3),
        staleTime: 20_000,
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
    const avatarSvg = multiavatar(displayAddress || 'space-user', true)
    const spaceBalance = formatAmount(profile?.balance, { display: true })
    const usdtBalance = formatAmount(profile?.usdtBalance, { display: true })
    const totalAssetValue = BigInt(profile?.usdtBalance || '0') + BigInt(profile?.balance || '0') * BigInt(latestPrice?.price || '0') / 10n ** 18n
    const assetValueLoading = profileLoading || latestPriceLoading
    const balanceLogs = logsData?.list ?? []
    const withdrawAmountWei = parseTokenAmount(withdrawAmount)
    const withdrawBalanceWei = BigInt(withdrawToken === 'SPACE' ? profile?.withdrawableBalance || '0' : profile?.usdtBalance || '0')
    const withdrawFeeWei = withdrawToken === 'SPACE' ? getWithdrawFee(withdrawAmountWei, withdrawFeeBps?.totalFeeBp) : 0n
    const withdrawReceiveWei = withdrawAmountWei > withdrawFeeWei ? withdrawAmountWei - withdrawFeeWei : 0n
    const isWithdrawAmountValid = withdrawAmountWei > 0n && withdrawAmountWei <= withdrawBalanceWei && (withdrawToken !== 'SPACE' || profile?.canWithdrawSpace === true)
    const maxWithdrawAmount = formatAmount(withdrawBalanceWei, { fractionDigits: 18 })

    const handleLogout = () => {
        clearAccessToken()
        queryClient.clear()
        navigate('/login')
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
            <button className={styles.profile_card} type="button" onClick={() => setDividendSummaryOpen(true)}>
                <div className={styles.avatar} dangerouslySetInnerHTML={{ __html: avatarSvg }} />
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
                                    <span>Node V{profile?.nodeLevel ?? 0}</span>
                                </>
                            )}
                        {isFeeExemptAccount && <span>Maker</span>}
                    </div>
                </div>
                <span className={styles.profile_arrow} aria-hidden="true" />
            </button>

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
                    <strong>{assetVisible ? assetValueLoading ? <SkeletonText width={132} height={22} /> : `≈ ${formatAmount(totalAssetValue, { display: true })} USDT` : '******'}</strong>
                </div>
                <div className={styles.token_grid}>
                    <div>
                        <img src={SpaceIcon} alt="" />
                        <div>
                            <span>SPACE</span>
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
                    <button className={styles.withdraw_btn} type="button" onClick={() => setWithdrawOpen(true)}>{t('personal.withdraw')}</button>
                </div>
            </div>

            <div className={styles.logs_card}>
                <div className={styles.logs_head}>
                    <span>{t('personal.balanceDetails')}</span>
                    <button type="button" onClick={() => navigate('/personal/balance-logs')}>{t('personal.viewAll')}</button>
                </div>
                <div className={styles.log_list}>
                    {logsLoading && <div className={styles.log_state}>{t('personal.balanceLogsLoading')}</div>}
                    {!logsLoading && logsIsError && <div className={styles.log_state}>{t('personal.balanceLogsFailed')}</div>}
                    {!logsLoading && !logsIsError && balanceLogs.length === 0 && <div className={styles.log_state}>{t('personal.noBalanceLogs')}</div>}
                    {balanceLogs.map((log) => (
                        <div className={styles.log_item} key={log.id}>
                            <div>
                                <span>{t(balanceLogText[log.type])}</span>
                                <em>{formatShortDateTime(log.createdAt)}</em>
                            </div>
                            <strong>{assetVisible ? `${formatAmount(log.amount, { signed: true, display: true })} ${log.token}` : '***'}</strong>
                        </div>
                    ))}
                </div>
            </div>

            <div className={styles.menu_card}>
                <button type="button" onClick={() => navigate('/personal/team')}>
                    <span>{t('personal.myTeam')}</span>
                    <em>›</em>
                </button>
                <button type="button" onClick={() => toast(t('common.comingSoon'))}>
                    <span>{t('personal.subEcosystem')}</span>
                    <em>›</em>
                </button>
                <button type="button" onClick={() => navigate('/personal/about')}>
                    <span>{t('personal.aboutUs')}</span>
                    <em>›</em>
                </button>
            </div>

            <button className={styles.logout_btn} type="button" onClick={handleLogout}>
                {t('personal.logout')}
            </button>

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
                            <button className={withdrawToken === 'SPACE' ? styles.token_tab_active : ''} type="button" onClick={() => setWithdrawToken('SPACE')}>SPACE</button>
                            <button className={withdrawToken === 'USDT' ? styles.token_tab_active : ''} type="button" onClick={() => setWithdrawToken('USDT')}>USDT</button>
                        </div>
                    </label>
                    {withdrawToken === 'SPACE' && !profileLoading && !profile?.canWithdrawSpace && <p role="status">{t('personal.paidMinerRequired')}</p>}
                    <label>
                        <span className={styles.withdraw_amount_label}>
                            {t('personal.withdrawAmount')}
                            <em>{t('personal.withdrawableBalance')}{profileLoading ? <SkeletonText width={60} height={11} /> : withdrawToken === 'SPACE' ? formatAmount(withdrawBalanceWei, { display: true }) : usdtBalance} {withdrawToken}</em>
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
                                {t('personal.withdrawFee')}{formatAmount(withdrawFeeWei, { display: true })} SPACE
                            </div>
                            <div>
                                {t('personal.withdrawReceive')}{formatAmount(withdrawReceiveWei, { display: true })} SPACE
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    )
}

export default PersonalPage
