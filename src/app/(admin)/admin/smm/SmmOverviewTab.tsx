'use client'

import Link from 'next/link'
import { Users2, Banknote, Wallet, TrendingDown, Film, AlertTriangle, HandCoins } from 'lucide-react'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import type { SmmDashboardStats, SmmClientPaymentDTO, SmmWorkItemDTO, SmmContentItemDTO } from '@/lib/actions/smm'
import { formatSmmMoney, SMM_CLIENT_PAYMENT_STATUS_LABELS, SMM_WORK_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS, isSmmContentOverdue } from '@/lib/smm-model'

function formatDate(v: string): string {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface Props {
  stats: SmmDashboardStats | null
  upcomingPayments: SmmClientPaymentDTO[]
  unpaidWork: SmmWorkItemDTO[]
  content: SmmContentItemDTO[]
  onGoToClients: () => void
  onGoToPayouts: () => void
  onGoToContent: () => void
}

export default function SmmOverviewTab({ stats, upcomingPayments, unpaidWork, content, onGoToClients, onGoToPayouts, onGoToContent }: Props) {
  if (!stats) {
    return <p className="text-zinc-500 text-sm">Не удалось загрузить статистику SMM.</p>
  }

  const overdueContent = content.filter(c => isSmmContentOverdue(c)).slice(0, 8)

  return (
    <div className="space-y-6">
      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard size="large" icon={Users2} label="Активные SMM-клиенты" value={String(stats.activeProjectsCount)} subtitle="Активных проектов" onClick={onGoToClients} />
        <MetricCard size="large" icon={Banknote} label="Месячная выручка SMM" value={formatSmmMoney(stats.monthlyRevenue)} subtitle="Сумма стоимости активных контрактов" />
        <MetricCard size="large" icon={HandCoins} label="Получено в текущем месяце" value={formatSmmMoney(stats.receivedThisMonth)} subtitle="Фактически зарегистрированные оплаты" />
      </div>

      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard icon={Wallet} label="Ожидается от клиентов" value={formatSmmMoney(stats.expectedFromClients)} subtitle="Платежи в этом месяце" />
        <MetricCard icon={TrendingDown} label="К выплате команде" value={formatSmmMoney(stats.payableToTeam)} subtitle="Подтверждено, не оплачено" onClick={onGoToPayouts} />
        <MetricCard icon={Film} label="Контент в производстве" value={String(stats.contentInProduction)} subtitle="Единиц контента" onClick={onGoToContent} />
        <MetricCard icon={AlertTriangle} label="Просрочено" value={String(stats.overdueContent)} subtitle="Дедлайн прошёл, не завершено" onClick={onGoToContent} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800">
            <h3 className="text-white font-semibold text-sm">Ближайшие платежи клиентов</h3>
          </div>
          {upcomingPayments.length === 0 ? (
            <p className="text-zinc-500 text-sm px-5 py-6">Нет запланированных платежей</p>
          ) : (
            <div className="divide-y divide-zinc-800/80">
              {upcomingPayments.slice(0, 8).map(p => (
                <Link key={p.id} href={`/admin/smm/${p.smmProjectId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-zinc-800/40 transition-colors">
                  <div className="min-w-0">
                    <p className="text-zinc-200 text-sm truncate">{p.smmProjectClientName ?? 'Без клиента'}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">{formatDate(p.plannedDate)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-zinc-100 text-sm font-medium">{formatSmmMoney(p.plannedAmount)}</p>
                    <p className="text-zinc-500 text-[11px] mt-0.5">{SMM_CLIENT_PAYMENT_STATUS_LABELS[p.status]}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800">
            <h3 className="text-white font-semibold text-sm">Ближайшие выплаты команде</h3>
          </div>
          {unpaidWork.length === 0 ? (
            <p className="text-zinc-500 text-sm px-5 py-6">Нет неоплаченных подтверждённых работ</p>
          ) : (
            <div className="divide-y divide-zinc-800/80">
              {unpaidWork.slice(0, 8).map(w => (
                <div key={w.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-zinc-200 text-sm truncate">{w.performerName} · {SMM_WORK_TYPE_LABELS[w.workType]}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">{w.smmProjectClientName ?? 'Без клиента'} · {formatDate(w.workDate)}</p>
                  </div>
                  <p className="text-zinc-100 text-sm font-medium flex-shrink-0">{formatSmmMoney(w.amount)}</p>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={onGoToPayouts} className="w-full text-center text-xs text-zinc-400 hover:text-white py-2.5 border-t border-zinc-800 transition-colors">
            Открыть раздел «Выплаты» →
          </button>
        </div>
      </div>

      <div className="bg-amber-950/20 border border-amber-600/40 rounded-xl overflow-hidden">
        <button type="button" onClick={onGoToContent} className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-amber-950/30 transition-colors text-left">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-amber-200 text-sm flex-1">
            {stats.overdueContent === 0 ? 'Проблемных задач нет' : `${stats.overdueContent} ${stats.overdueContent === 1 ? 'единица контента просрочена' : 'единиц контента просрочено'}`}
          </p>
        </button>
        {overdueContent.length > 0 && (
          <div className="divide-y divide-amber-900/30 border-t border-amber-900/30">
            {overdueContent.map(c => (
              <Link key={c.id} href={`/admin/smm/${c.smmProjectId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-amber-950/20 transition-colors">
                <p className="text-zinc-200 text-sm truncate">{c.title ?? SMM_CONTENT_STATUS_LABELS[c.status]}</p>
                <span className="text-[11px] text-amber-300 bg-amber-900/30 rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0">
                  Дедлайн {c.deadline ? formatDate(c.deadline) : '—'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
