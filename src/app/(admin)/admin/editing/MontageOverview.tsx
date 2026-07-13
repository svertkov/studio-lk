'use client'

import { AlertTriangle, Banknote, Clock3, TrendingUp, Wallet, Film, Users2 } from 'lucide-react'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import DonutChart from '@/components/ui/donut-chart'
import type { MontageProjectDTO } from '@/lib/actions/montage'
import type { MontageDashboardStats } from '@/lib/montage-model'
import {
  MONTAGE_ATTENTION_LABELS, MONTAGE_ACTIVE_STATUSES, MONTAGE_DELIVERED_STATUSES,
  MONTAGE_STATUS_ORDER, MONTAGE_STATUS_LABELS, type MontageStatus,
} from '@/lib/montage-model'
import type { MontageProjectsFilterPreset } from './MontageProjectsTable'

function formatMoney(v: number) {
  return new Intl.NumberFormat('ru-RU', { notation: 'compact', style: 'currency', currency: 'RUB', maximumFractionDigits: 1 }).format(v)
}

function formatDate(v: string) {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Кольцевая диаграмма статусов — после сокращения производственных статусов
// до 5 понятных этапов (см. MONTAGE_STATUS_ORDER, montage-model.ts) группировка
// в "корзины" больше не нужна: каждый сектор — ровно один реальный статус,
// плюс CANCELLED отдельным сектором (терминальный, вне MONTAGE_STATUS_ORDER).
// Лейблы — из MONTAGE_STATUS_LABELS (единый источник, тот же текст, что и на
// плашке статуса в таблице/карточке, см. MontageStatusBadge.tsx), здесь
// заводится только HEX-палитра для самого графика (DonutChart рисует SVG,
// которому нужен конкретный цвет, а не Tailwind-класс) — по той же
// цветовой смысловой схеме, что MONTAGE_STATUS_CONFIG.color.
const STATUS_DONUT_COLORS: Record<MontageStatus, string> = {
  NEW: '#60a5fa',
  IN_PROGRESS: '#22d3ee',
  IN_REVIEW: '#a78bfa',
  REVISIONS: '#fbbf24',
  DELIVERED: '#22c55e',
  CANCELLED: '#f87171',
}
const DONUT_STATUSES: MontageStatus[] = [...MONTAGE_STATUS_ORDER, 'CANCELLED']

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
}

interface Props {
  stats: MontageDashboardStats | null
  projects: MontageProjectDTO[]
  onGoToProjects: (preset: MontageProjectsFilterPreset) => void
}

export default function MontageOverview({ stats, projects, onGoToProjects }: Props) {
  if (!stats) {
    return <p className="text-zinc-500 text-sm">Не удалось загрузить статистику монтажа.</p>
  }

  const attentionProjects = projects.filter(p => p.attentionReasons.length > 0).slice(0, 5)

  // Последние 6 календарных месяцев (включая текущий) по дате поступления в
  // монтаж — та же дата, что используется во всём разделе как "дата
  // поступления" (см. sourceReceivedAt в montage-model.ts).
  const now = new Date()
  const monthKeys: string[] = []
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthCounts = monthKeys.map(key => ({
    key,
    label: monthLabel(key),
    count: projects.filter(p => p.sourceReceivedAt && p.sourceReceivedAt.slice(0, 7) === key).length,
  }))
  const maxMonthCount = Math.max(1, ...monthCounts.map(m => m.count))

  const statusDonutData = DONUT_STATUSES
    .map(s => ({ label: MONTAGE_STATUS_LABELS[s], color: STATUS_DONUT_COLORS[s], value: projects.filter(p => p.status === s).length }))
    .filter(d => d.value > 0)

  return (
    <div className="space-y-6">
      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard
          size="large"
          icon={Film}
          label="Смонтировано проектов"
          value={String(stats.deliveredCount)}
          subtitle={stats.reportingSince ? `Отчётность с ${formatDate(stats.reportingSince)}` : 'Нет данных за период'}
          onClick={() => onGoToProjects({ kind: 'status', statuses: MONTAGE_DELIVERED_STATUSES })}
        />
        <MetricCard
          size="large"
          icon={Banknote}
          label="Выручка по монтажу"
          value={formatMoney(stats.revenueTotal)}
          subtitle={`Оплачено клиентами: ${formatMoney(stats.revenuePaid)}`}
        />
        <MetricCard
          size="large"
          icon={TrendingUp}
          label="Чистая прибыль"
          value={formatMoney(stats.profit)}
          subtitle={stats.margin != null ? `Маржа ${Math.round(stats.margin * 100)}%` : 'Маржа неизвестна'}
        />
      </div>

      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard icon={Wallet} label="Расходы на монтаж" value={formatMoney(stats.expensesTotal)} subtitle={`Выплачено: ${formatMoney(stats.expensesPaid)}`} />
        <MetricCard
          icon={Clock3}
          label="В работе"
          value={String(stats.activeCount)}
          subtitle="Активные проекты"
          onClick={() => onGoToProjects({ kind: 'status', statuses: MONTAGE_ACTIVE_STATUSES })}
        />
        <MetricCard icon={Users2} label="Клиенты должны студии" value={formatMoney(stats.clientDebt)} subtitle="По незакрытым оплатам" />
        <MetricCard icon={Wallet} label="Студия должна монтажёрам" value={formatMoney(stats.studioDebt)} subtitle="По невыплаченным вознаграждениям" />
      </div>

      {stats.attentionCount > 0 && (
        <div className="bg-amber-950/20 border border-amber-600/40 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => onGoToProjects({ kind: 'attention' })}
            className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-amber-950/30 transition-colors text-left"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-amber-200 text-sm flex-1">
              {stats.attentionCount} {stats.attentionCount === 1 ? 'проект требует' : 'проектов требуют'} внимания
            </p>
          </button>
          <div className="divide-y divide-amber-900/30 border-t border-amber-900/30">
            {attentionProjects.map(p => (
              <div key={p.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                <p className="text-zinc-200 text-sm truncate">{p.title ?? p.clientName ?? 'Без названия'}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {p.attentionReasons.slice(0, 2).map(r => (
                    <span key={r} className="text-[11px] text-amber-300 bg-amber-900/30 rounded-full px-2 py-0.5 whitespace-nowrap">
                      {MONTAGE_ATTENTION_LABELS[r]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Проекты по месяцам</h3>
          <div className="flex items-end gap-3" style={{ height: 140 }}>
            {monthCounts.map(m => (
              <div key={m.key} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                <div className="w-full flex items-end justify-center" style={{ height: 110 }} title={`${m.label}: ${m.count}`}>
                  <div className="w-6 rounded-t bg-[#00c26b]" style={{ height: `${Math.max(2, (m.count / maxMonthCount) * 110)}px` }} />
                </div>
                <span className="text-zinc-500 text-[11px]">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Статусы проектов</h3>
          <DonutChart data={statusDonutData} emptyLabel="Пока нет проектов" />
        </div>
      </div>
    </div>
  )
}
