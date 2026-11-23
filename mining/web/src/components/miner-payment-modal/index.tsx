import { fallbackMinerImage, getMinerPresentation } from '../../utils/miner-presentation'
import { formatTokenSymbol } from '../../utils/token'
import type { PurchaseMinerMethod } from '../../api'
import { useI18n } from '../../i18n'
import type { MinerPurchaseState } from '../../hooks/useMinerPurchase'
import { formatAmount } from '../../utils/format'
import Modal from '../modal'
import styles from './index.module.css'

type MinerPaymentModalProps = {
    purchase: MinerPurchaseState
}

function MinerPaymentModal({ purchase }: MinerPaymentModalProps) {
    const { t } = useI18n()
    const { selectedMiner, successMiner } = purchase

    return (
        <>
            <Modal
                open={Boolean(selectedMiner)}
                title="home.paymentTitle"
                confirmText="home.confirmPurchase"
                confirmLoading={Boolean(purchase.buyingMinerId)}
                confirmDisabled={
                    !selectedMiner ||
                    purchase.balanceLoading ||
                    Boolean(purchase.buyingMinerId) ||
                    !purchase.isBalanceEnough(
                        purchase.activePaymentMethod,
                        selectedMiner,
                    )
                }
                onCancel={purchase.closePaymentModal}
                onConfirm={purchase.handleConfirmPayment}
            >
                {selectedMiner && (
                    <div className={styles.payment_modal}>
                        <div className={styles.payment_summary}>
                            <span>{formatTokenSymbol(selectedMiner.name)}</span>
                            <span>
                                {formatAmount(selectedMiner.price, {
                                    display: true,
                                    fractionDigits: 3,
                                })}{' '}
                                SpaceXZI
                            </span>
                        </div>
                        {[
                            {
                                value: 'wallet_balance',
                                label: t('home.walletBalance'),
                                balance: purchase.walletSpaceBalance,
                                token: 'SPACE',
                            },
                            {
                                value: 'internal_balance',
                                label: t('home.accountBalance'),
                                balance: purchase.internalBalance,
                                token: 'SPACE',
                            },
                            {
                                value: 'internal_and_wallet_balance',
                                label: t('home.accountAndWallet'),
                                balance:
                                    purchase.internalBalance +
                                    purchase.walletSpaceBalance,
                                token: 'SPACE',
                            },
                        ].map((item) => {
                            const value = item.value as PurchaseMinerMethod
                            const enough = purchase.isBalanceEnough(
                                value,
                                selectedMiner,
                            )

                            return (
                                <button
                                    className={`${styles.payment_option} ${purchase.activePaymentMethod === value ? styles.payment_active : ''}`}
                                    type="button"
                                    key={value}
                                    onClick={() =>
                                        purchase.setPaymentMethod(value)
                                    }
                                >
                                    <div>
                                        <span>{item.label}</span>
                                        <span>
                                            {formatAmount(item.balance, {
                                                display: true,
                                            })}{' '}
                                            {formatTokenSymbol(item.token)}
                                        </span>
                                    </div>
                                    <span
                                        className={
                                            enough
                                                ? styles.enough
                                                : styles.not_enough
                                        }
                                    >
                                        {enough
                                            ? t('home.available')
                                            : t('home.notEnough')}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                )}
            </Modal>
            <Modal
                open={Boolean(successMiner)}
                title={
                    purchase.successMode === 'reinvest'
                        ? 'home.reinvestSuccess'
                        : 'home.purchaseSuccess'
                }
                confirmText="miner.myMiners"
                onCancel={purchase.closeSuccessModal}
                onConfirm={purchase.goToMyMiners}
            >
                {successMiner && (
                    <div className={styles.success_modal}>
                        <img
                            src={getMinerPresentation(successMiner.id, '').image}
                            alt={formatTokenSymbol(successMiner.name)}
                            onError={(event) => {
                                if (!event.currentTarget.src.endsWith(fallbackMinerImage)) {
                                    event.currentTarget.src = fallbackMinerImage
                                }
                            }}
                        />
                        <strong>{formatTokenSymbol(successMiner.name)}</strong>
                        <span>
                            {t(
                                purchase.successMode === 'reinvest'
                                    ? 'home.reinvestSuccessWithName'
                                    : 'home.purchaseSuccessWithName',
                                { name: formatTokenSymbol(successMiner.name) },
                            )}
                        </span>
                    </div>
                )}
            </Modal>
        </>
    )
}

export default MinerPaymentModal
