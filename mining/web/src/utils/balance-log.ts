import type { BalanceLogType } from "../api"

export const balanceLogText: Record<BalanceLogType, string> = {
    miner_reward: 'logType.miner_reward',
    team_reward: 'logType.team_reward',
    free_miner_claim: 'logType.free_miner_claim',
    miner_purchase: 'logType.miner_purchase',
    miner_purchase_refund: 'logType.miner_purchase_refund',
    withdraw: 'logType.withdraw',
    withdraw_refund: 'logType.withdraw_refund',
    vip_dividend: 'logType.vip_dividend',
    node_dividend: 'logType.node_dividend',
    node_referral_reward: 'logType.node_referral_reward',
    buyback_dividend: 'logType.buyback_dividend',
    system_reward: 'logType.system_reward',
    admin_transfer_out: 'logType.admin_transfer_out',
    admin_transfer_in: 'logType.admin_transfer_in',
}
