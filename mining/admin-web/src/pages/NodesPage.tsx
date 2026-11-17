import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getAdminNodes, retryAdminNode } from '../api'
import { useAdminOutlet } from '../hooks/useAdminOutlet'
import { formatTime } from '../lib/format'
const statusNames: Record<string, string> = {
    pending: '待确认',
    used: '已使用',
    unused: '过期未使用',
    reward: '推荐奖励',
}
export function NodesPage() {
    const { token } = useAdminOutlet()
    const [kind, setKind] = useState('purchases')
    const [page, setPage] = useState(1)
    const query = useQuery({
        queryKey: ['admin', 'nodes', kind, page],
        queryFn: () => getAdminNodes(token, kind, page),
        refetchInterval: 15000,
    })
    const retry = useMutation({
        mutationFn: (id: number) => retryAdminNode(token, id),
        onSuccess: () => query.refetch(),
    })
    return (
        <section className="panel">
            <p className="eyebrow">Node Center</p>
            <h1>节点管理</h1>
            <p className="muted">
                节点推荐奖励统一计入个人中心 USDT 余额，并通过个人中心提现。金额为合约代币的最小单位。
            </p>
            <div className="modal-actions">
                {[
                    ['purchases', '购买 / 升级签名'],
                    ['rewards', '奖励流水'],
                ].map(([value, label]) => (
                    <button
                        key={value}
                        className={kind === value ? 'primary' : 'secondary'}
                        onClick={() => {
                            setKind(value)
                            setPage(1)
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {(query.error || retry.error) && (
                <p className="status error">
                    {(query.error || retry.error)?.message}
                </p>
            )}
            {query.isLoading && <p>加载中...</p>}
            <div style={{ overflowX: 'auto' }}>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>用户</th>
                            <th>金额</th>
                            <th>奖励金额</th>
                            <th>状态 / 类型</th>
                            <th>Nonce</th>
                            <th>时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {query.data?.list.map((r) => (
                            <tr key={r.id}>
                                <td>{r.id}</td>
                                <td>{r.buyer || r.accountId}</td>
                                <td>{r.amount}</td>
                                <td>{r.rewardAmount || '—'}</td>
                                <td>
                                    {statusNames[r.status || r.type || ''] ||
                                        r.status ||
                                        r.type}
                                </td>
                                <td
                                    style={{
                                        maxWidth: 200,
                                        overflowWrap: 'anywhere',
                                    }}
                                >
                                    {r.nonce || '—'}
                                </td>
                                <td>{formatTime(r.createdAt)}</td>
                                <td>
                                    {kind === 'purchases' &&
                                        r.status === 'pending' && (
                                            <button
                                                className="secondary"
                                                disabled={retry.isPending}
                                                onClick={() =>
                                                    retry.mutate(r.id)
                                                }
                                            >
                                                重新核对
                                            </button>
                                        )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {query.data?.total === 0 && <p>暂无记录</p>}
            <div className="modal-actions">
                <button
                    className="secondary"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                >
                    上一页
                </button>
                <span>
                    {page} /{' '}
                    {Math.max(1, Math.ceil((query.data?.total ?? 0) / 20))}
                </span>
                <button
                    className="secondary"
                    disabled={page * 20 >= (query.data?.total ?? 0)}
                    onClick={() => setPage(page + 1)}
                >
                    下一页
                </button>
            </div>
        </section>
    )
}
