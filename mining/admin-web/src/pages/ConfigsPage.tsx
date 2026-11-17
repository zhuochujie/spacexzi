import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getAdminMiningStatus, startAdminMining, updateAdminConfig, type AdminConfigItem } from '../api'
import { ConfigModal } from '../components/configs/ConfigModal'
import { ConfigTable } from '../components/configs/ConfigTable'
import { useAdminConfigsQuery } from '../hooks/useAdminData'
import { useAdminOutlet } from '../hooks/useAdminOutlet'

export function ConfigsPage() {
  const { token } = useAdminOutlet()
  const [editingConfig, setEditingConfig] = useState<AdminConfigItem | null>(null)

  const configsQuery = useAdminConfigsQuery(token, Boolean(token))
  const configs = configsQuery.data ?? []

  const miningStatus = useQuery({ queryKey: ['admin-mining-status'], queryFn: () => getAdminMiningStatus(token), enabled: Boolean(token), refetchInterval: 15000 })
  const startMining = useMutation({
    mutationFn: () => startAdminMining(token),
    onSuccess: async () => { await miningStatus.refetch() },
  })

  const updateConfigMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return updateAdminConfig(token, key, value)
    },
    onSuccess: async () => {
      await configsQuery.refetch()
      setEditingConfig(null)
    },
  })

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Config Management</p>
        <h1>配置管理</h1>
      </header>

      <section className="summary-row">
        <div className="summary-card">
          <span>配置总数</span>
          <strong>{configs.length}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>统一产币</h2></div>
        {miningStatus.isLoading && <p>加载中…</p>}
        {miningStatus.error && <p role="alert">{miningStatus.error.message}</p>}
        {miningStatus.data && <>
          <p>{miningStatus.data.miningStartedAt === null ? '未开启：所有矿机等待统一启动，不产币、不推进周期。' : `已开启：${new Date(miningStatus.data.miningStartedAt * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）`}</p>
          <p>待启动付费矿机：{miningStatus.data.pendingMiners}，免费矿机：{miningStatus.data.pendingFreeMiners}</p>
          {miningStatus.data.miningStartedAt === null && <button className="primary" disabled={startMining.isPending || miningStatus.isFetching} onClick={() => {
            if (window.confirm('确认立即开启所有矿机产币？此操作只能执行一次，已有矿机将从现在开始计算收益和周期。')) startMining.mutate()
          }}>{startMining.isPending ? '开启中…' : '开启产币'}</button>}
        </>}
        {startMining.error && <p role="alert">{startMining.error.message}</p>}
      </section>

      <ConfigTable
        configs={configs}
        busy={configsQuery.isFetching}
        onEdit={(config) => {
          updateConfigMutation.reset()
          setEditingConfig(config)
        }}
      />

      <ConfigModal
        key={editingConfig?.key ?? 'closed'}
        open={Boolean(editingConfig)}
        config={editingConfig}
        busy={updateConfigMutation.isPending}
        error={updateConfigMutation.error?.message}
        onClose={() => {
          setEditingConfig(null)
          updateConfigMutation.reset()
        }}
        onSubmit={(value) => {
          if (!editingConfig) return
          updateConfigMutation.mutate({ key: editingConfig.key, value })
        }}
      />
    </div>
  )
}
