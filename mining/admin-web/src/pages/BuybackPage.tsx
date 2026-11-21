import { formatTokenSymbol } from '../lib/token'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
    createWalletClient,
    custom,
    erc20Abi,
    isAddress,
    zeroAddress,
    formatUnits,
    parseUnits,
    type EIP1193Provider,
} from 'viem'
import { appChain } from '../lib/chain'
import { getAdminBuybackRanking } from '../api'
import {
    buybackClient as client,
    getOnchainBuybackAdminOverview,
} from '../lib/buyback'
import { useAdminOutlet } from '../hooks/useAdminOutlet'
import { buybackAbi } from '../buyback-abi'
const display = (value?: string) => formatUnits(BigInt(value ?? '0'), 18)
export default function BuybackPage() {
    const { token } = useAdminOutlet()
    const [page, setPage] = useState(1)
    const [asset, setAsset] = useState<'SPACE' | 'USDT'>('USDT')
    const [amount, setAmount] = useState('')
    const [withdrawAsset, setWithdrawAsset] = useState<'SPACE' | 'USDT'>('USDT')
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [recipient, setRecipient] = useState('')
    const [buy, setBuy] = useState('')
    const [sell, setSell] = useState('')
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const overview = useQuery({
        queryKey: ['admin', 'buyback', 'chain'],
        queryFn: getOnchainBuybackAdminOverview,
        refetchInterval: 15000,
    })
    const ranking = useQuery({
        queryKey: ['admin', 'buyback', 'ranking', page],
        queryFn: () => getAdminBuybackRanking(token, page),
        refetchInterval: 15000,
    })
    const data = overview.data
    async function operate(action: 'fund' | 'prices' | 'pause' | 'withdraw') {
        if (!data || busy) return
        setBusy(true)
        setMessage('')
        try {
            const provider = (
                window as unknown as { ethereum?: EIP1193Provider }
            ).ethereum
            if (!provider)
                throw new Error('请安装钱包，并连接合约 owner 账户。')
            const wallet = createWalletClient({
                chain: appChain,
                transport: custom(provider),
            })
            const [account] = await wallet.requestAddresses()
            if (!account || account.toLowerCase() !== data.owner.toLowerCase())
                throw new Error('请使用合约 owner 钱包。')
            try {
                await wallet.switchChain({ id: appChain.id })
            } catch (error) {
                let cause: unknown = error
                let missing = false
                for (let depth = 0; depth < 8 && cause && typeof cause === 'object'; depth++) {
                    if ('code' in cause && Number(cause.code) === 4902) { missing = true; break }
                    cause = 'cause' in cause ? cause.cause : undefined
                }
                if (!missing) throw error
                await wallet.addChain({ chain: appChain })
                await wallet.switchChain({ id: appChain.id })
            }
            if (action === 'fund') {
                if (
                    !/^\d+(\.\d+)?$/.test(amount) ||
                    (amount.split('.')[1]?.length ?? 0) > 18
                )
                    throw new Error('请输入有效数量。')
                const value = parseUnits(amount, 18)
                if (value <= 0n) throw new Error('数量必须大于零。')
                const tokenAddress =
                    asset === 'SPACE' ? data.spaceToken : data.usdtToken
                const allowance = await client.readContract({
                    address: tokenAddress,
                    abi: erc20Abi,
                    functionName: 'allowance',
                    args: [account, data.contract],
                })
                if (allowance < value) {
                    const hash = await wallet.writeContract({
                        account,
                        address: tokenAddress,
                        abi: erc20Abi,
                        functionName: 'approve',
                        args: [data.contract, value],
                    })
                    if (
                        (await client.waitForTransactionReceipt({ hash }))
                            .status !== 'success'
                    )
                        throw new Error('授权失败。')
                }
                const hash = await wallet.writeContract({
                    account,
                    address: data.contract,
                    abi: buybackAbi,
                    functionName: asset === 'SPACE' ? 'fundSpace' : 'fundUsdt',
                    args: [value],
                })
                if (
                    (await client.waitForTransactionReceipt({ hash }))
                        .status !== 'success'
                )
                    throw new Error('注资失败。')
                setAmount('')
            } else if (action === 'withdraw') {
                const destination = recipient.trim()
                if (!isAddress(destination) || destination.toLowerCase() === zeroAddress || destination.toLowerCase() === data.contract.toLowerCase())
                    throw new Error('请输入有效接收地址，不能为零地址或回购合约自身。')
                if (!/^\d+(\.\d+)?$/.test(withdrawAmount) || (withdrawAmount.split('.')[1]?.length ?? 0) > 18)
                    throw new Error('请输入有效提取数量，最多18位小数。')
                const value = parseUnits(withdrawAmount, 18)
                if (value <= 0n) throw new Error('提取数量必须大于零。')
                const available = BigInt(withdrawAsset === 'SPACE' ? data.availableSpace : data.availableUsdt)
                if (value > available) throw new Error('提取数量超过回购池余额，请刷新后重试。')
                const hash = await wallet.writeContract({
                    account, address: data.contract, abi: buybackAbi,
                    functionName: withdrawAsset === 'SPACE' ? 'withdrawSpace' : 'withdrawUsdt',
                    args: [destination, value],
                })
                if ((await client.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('提取失败。')
                setWithdrawAmount('')
            } else if (action === 'prices') {
                if (!data.paused) throw new Error('请先暂停买卖。')
                const buyPrice = parseUnits(buy, 18),
                    sellPrice = parseUnits(sell, 18)
                if (sellPrice <= 0n || buyPrice <= sellPrice)
                    throw new Error('买入价必须大于卖出价，且卖出价大于零。')
                const hash = await wallet.writeContract({
                    account,
                    address: data.contract,
                    abi: buybackAbi,
                    functionName: 'setPrices',
                    args: [buyPrice, sellPrice],
                })
                if (
                    (await client.waitForTransactionReceipt({ hash }))
                        .status !== 'success'
                )
                    throw new Error('修改价格失败。')
            } else {
                const hash = await wallet.writeContract({
                    account,
                    address: data.contract,
                    abi: buybackAbi,
                    functionName: data.paused ? 'unpause' : 'pause',
                })
                if (
                    (await client.waitForTransactionReceipt({ hash }))
                        .status !== 'success'
                )
                    throw new Error('操作失败。')
            }
            setMessage('链上操作已成功确认。')
            await overview.refetch()
        } catch (e) {
            setMessage(
                e instanceof Error ? e.message.split('\n')[0] : '操作失败。',
            )
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="page-stack">
            <header className="page-header">
                <p className="eyebrow">On-chain Buyback</p>
                <h1>回购管理</h1>
            </header>
            {overview.isLoading && (
                <section className="panel">加载链上数据...</section>
            )}
            {overview.error && (
                <p className="status error">{overview.error.message}</p>
            )}
            {data && (
                <>
                    <section className="summary-row">
                        <div className="summary-card">
                            <span>SpaceXZI 库存</span>
                            <strong>{display(data.availableSpace)}</strong>
                        </div>
                        <div className="summary-card">
                            <span>回购 USDT 储备</span>
                            <strong>{display(data.availableUsdt)}</strong>
                        </div>
                        <div className="summary-card">
                            <span>待分红 USDT</span>
                            <strong>{display(data.dividendBalance)}</strong>
                        </div>
                    </section>
                    <section className="panel">
                        <h2>固定价格</h2>
                        <p>
                            用户买入：{display(data.buyPrice)} USDT /
                            SpaceXZI；用户卖出：{display(data.sellPrice)} USDT /
                            SpaceXZI
                        </p>
                        <p
                            className="muted"
                            style={{ overflowWrap: 'anywhere' }}
                        >
                            合约：{data.contract}
                            <br />
                            Owner：{data.owner}
                        </p>
                        <div className="modal-actions">
                            <button
                                className="secondary"
                                disabled={busy}
                                onClick={() => void operate('pause')}
                            >
                                {data.paused ? '恢复交易' : '暂停交易'}
                            </button>
                        </div>
                        <div className="field">
                            <label>买入价 USDT</label>
                            <input
                                inputMode="decimal"
                                value={buy}
                                onChange={(e) => setBuy(e.target.value)}
                            />
                        </div>
                        <div className="field">
                            <label>卖出价 USDT</label>
                            <input
                                inputMode="decimal"
                                value={sell}
                                onChange={(e) => setSell(e.target.value)}
                            />
                        </div>
                        <button
                            className="primary"
                            disabled={busy || !data.paused || !buy || !sell}
                            onClick={() => void operate('prices')}
                        >
                            使用 owner 钱包修改价格
                        </button>
                    </section>
                    <section className="panel">
                        <h2>补充真实库存 / 储备</h2>
                        <p className="muted">
                            注资不计入买入排名，也不参与 50% / 30% / 20% 拆分。
                        </p>
                        <div className="field">
                            <label>代币</label>
                            <select
                                value={asset}
                                onChange={(e) =>
                                    setAsset(e.target.value as 'SPACE' | 'USDT')
                                }
                            >
                                <option>USDT</option>
                                <option value="SPACE">SpaceXZI</option>
                            </select>
                        </div>
                        <div className="field">
                            <label>数量</label>
                            <input
                                inputMode="decimal"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                            />
                        </div>
                        <button
                            className="primary"
                            disabled={busy || !amount}
                            onClick={() => void operate('fund')}
                        >
                            {busy ? '等待钱包 / 链上确认...' : '授权并注资'}
                        </button>
                    </section>
                </>
            )}
            {data && <section className="panel">
                <h2>提取回购池资金</h2>
                <p className="muted">仅合约 Owner 钱包可操作。资金从回购池转到指定地址，不包含分红 Vault 中的资金。</p>
                <div className="field">
                    <label htmlFor="buyback-withdraw-asset">代币</label>
                    <select id="buyback-withdraw-asset" value={withdrawAsset} onChange={e => setWithdrawAsset(e.target.value as 'SPACE' | 'USDT')}>
                        <option>USDT</option><option value="SPACE">SpaceXZI</option>
                    </select>
                </div>
                <p>池内可提取：{display(withdrawAsset === 'SPACE' ? data.availableSpace : data.availableUsdt)} {formatTokenSymbol(withdrawAsset)}</p>
                <div className="field">
                    <label htmlFor="buyback-withdraw-recipient">接收地址</label>
                    <input id="buyback-withdraw-recipient" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..." autoComplete="off" />
                </div>
                <div className="field">
                    <label htmlFor="buyback-withdraw-amount">提取数量</label>
                    <input id="buyback-withdraw-amount" inputMode="decimal" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
                </div>
                <button className="primary" disabled={busy || !recipient.trim() || !withdrawAmount} onClick={() => void operate('withdraw')}>
                    {busy ? '等待钱包 / 链上确认...' : '使用 Owner 钱包提取'}
                </button>
            </section>}
            {message && <p className="status">{message}</p>}
            <section className="panel">
                <h2>本周交易商买入排行</h2>
                <p>预计奖励按当前分红池余额及排名比例计算，前五名参与分红，空缺份额保留；最终以实际分红为准。</p>
                {ranking.error && (
                    <p className="status error">{ranking.error.message}</p>
                )}
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>名次</th>
                                <th>地址</th>
                                <th>累计 SpaceXZI</th>
                                <th>预计奖励 USDT</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ranking.data?.items.map((item) => (
                                <tr key={item.address}>
                                    <td>{item.rank}</td>
                                    <td>{item.address}</td>
                                    <td>{display(item.spaceAmount)}</td>
                                    <td>{item.rewardBp === 0 ? '0' : data ? display((BigInt(data.dividendBalance) * BigInt(item.rewardBp) / 10000n).toString()) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="modal-actions">
                    <button
                        className="secondary"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                    >
                        上一页
                    </button>
                    <span>{page}</span>
                    <button
                        className="secondary"
                        disabled={page * 20 >= (ranking.data?.total ?? 0)}
                        onClick={() => setPage(page + 1)}
                    >
                        下一页
                    </button>
                </div>
            </section>
        </div>
    )
}
