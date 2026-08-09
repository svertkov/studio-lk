'use client'

import type { SmmAnalyticsRowDTO } from '@/lib/actions/smm'
import { SMM_PUBLICATION_PLATFORM_LABELS, SMM_METRIC_TYPE_LABELS, formatSmmMoney, type SmmAnalyticsAggregates } from '@/lib/smm-model'
import { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import type { SmmMetricType } from '@prisma/client'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

// Колонки метрик показываются, только если хотя бы в одной строке текущей
// выборки есть значение (ТЗ: "скрывать колонки без смысла для площадки, но
// без чрезмерной сложности") — простая проверка непустого столбца, не
// конфигурация по площадке.
const METRIC_COLUMNS: SmmMetricType[] = [
  'VIEWS', 'REACH', 'LIKES', 'COMMENTS', 'SHARES', 'SAVES', 'REACTIONS', 'FOLLOWERS_GAINED', 'RETENTION_PERCENT', 'WATCH_TIME',
]

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

interface Props {
  rows: SmmAnalyticsRowDTO[]
  aggregates: SmmAnalyticsAggregates
  showClientColumn?: boolean
  onOpenContent: (contentItemId: string) => void
}

export default function SmmAnalyticsTable({ rows, aggregates, showClientColumn = true, onOpenContent }: Props) {
  const visibleMetricColumns = METRIC_COLUMNS.filter(m => rows.some(r => r.metrics[m] != null))

  return (
    <div className="space-y-4">
      <div className={METRIC_GRID_CLASSNAME}>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Опубликовано</p>
          <p className="text-white text-2xl font-bold mt-1">{aggregates.publishedCount}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Всего просмотров</p>
          <p className="text-white text-2xl font-bold mt-1">{aggregates.totalViews.toLocaleString('ru-RU')}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Средние просмотры</p>
          <p className="text-white text-2xl font-bold mt-1">{aggregates.averageViews.toLocaleString('ru-RU')}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Медиана просмотров</p>
          <p className="text-white text-2xl font-bold mt-1">{aggregates.medianViews.toLocaleString('ru-RU')}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide">Рост подписчиков</p>
          <p className="text-white text-2xl font-bold mt-1">+{aggregates.followersGained.toLocaleString('ru-RU')}</p>
        </div>
      </div>
      {aggregates.bestContentTitle && (
        <p className="text-zinc-400 text-xs">
          Лучший контент: <span className="text-zinc-200">{aggregates.bestContentTitle}</span> — {formatSmmMoney(aggregates.bestContentViews ?? 0).replace('₽', '')} просмотров
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6">По выбранным фильтрам публикаций не найдено</p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Дата</TableHead>
                {showClientColumn && <TableHead className="text-zinc-400">Клиент</TableHead>}
                <TableHead className="text-zinc-400">File Code</TableHead>
                <TableHead className="text-zinc-400">Контент</TableHead>
                <TableHead className="text-zinc-400">Площадка</TableHead>
                {visibleMetricColumns.map(m => <TableHead key={m} className="text-zinc-400">{SMM_METRIC_TYPE_LABELS[m]}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} onClick={() => onOpenContent(r.contentItemId)} className="cursor-pointer transition-colors border-zinc-800">
                  <TableCell><span className="text-zinc-300 text-xs">{formatDate(r.date)}</span></TableCell>
                  {showClientColumn && <TableCell><span className="text-zinc-300 text-xs">{r.clientName ?? '—'}</span></TableCell>}
                  <TableCell><span className="text-zinc-400 text-xs font-mono">{r.fileCode ?? '—'}</span></TableCell>
                  <TableCell><p className="text-zinc-200 text-sm truncate max-w-[220px]">{r.contentTitle ?? '—'}</p></TableCell>
                  <TableCell><span className="text-zinc-400 text-xs">{SMM_PUBLICATION_PLATFORM_LABELS[r.platform]}</span></TableCell>
                  {visibleMetricColumns.map(m => (
                    <TableCell key={m}><span className="text-zinc-300 text-xs">{r.metrics[m] != null ? r.metrics[m]!.toLocaleString('ru-RU') : '—'}</span></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
