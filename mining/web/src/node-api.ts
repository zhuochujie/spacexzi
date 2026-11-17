import { request } from './api'
export type NodeSignature = {
    id: number
    buyer: `0x${string}`
    action: 'purchase' | 'upgrade'
    fromLevel: number
    targetLevelIndex: number
    amount: string
    rewardAmount: string
    nonce: string
    deadline: number
    signature: `0x${string}`
    status: 'pending' | 'used' | 'unused'
}
export type NodeReferralStats = {
    usdtBalance: string
    totalReward: string
    directCount: number
    teamCount: number
    directPerformance: string
    teamPerformance: string
}
export const getNodeReferralStats = () =>
    request<NodeReferralStats>('/node/referral-stats', { auth: true })
export const getPendingNodePurchase = () =>
    request<NodeSignature | null>('/node/pending-purchase', { auth: true })
export const purchaseNode = (targetLevelIndex: number) =>
    request<NodeSignature>('/node/purchase', {
        auth: true,
        method: 'POST',
        body: JSON.stringify({ targetLevelIndex }),
    })
export const submitNodeNonce = (nonce: string) =>
    request('/node/nonce', {
        auth: true,
        method: 'POST',
        body: JSON.stringify({ nonce }),
    })
export const getNodeNonce = (nonce: string) =>
    request<{ status: NodeSignature['status'] }>(
        `/node/nonce/${encodeURIComponent(nonce)}`,
        { auth: true },
    )
