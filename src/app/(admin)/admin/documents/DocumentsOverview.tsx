'use client'

import { AlertTriangle, Receipt, ScrollText, Layers, ClipboardCheck, UserX, FileWarning } from 'lucide-react'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import type { DocumentsDashboardStats, DocumentAttentionRowDTO } from '@/lib/actions/documents'
import { DOCUMENT_ATTENTION_LABELS } from '@/lib/document-model'

type Tab = 'overview' | 'contracts' | 'appendices' | 'invoices' | 'acts' | 'no-contract' | 'attention'

interface Props {
  stats: DocumentsDashboardStats | null
  attention: DocumentAttentionRowDTO[]
  onGoToTab: (tab: Tab) => void
}

// Композиция карточек — тот же приём, что MontageOverview.tsx (первый ряд —
// три крупных приоритетных показателя, второй — обычные), ТЗ разд.20:
// "не размещать восемь маленьких одинаковых карточек в одну строку".
export default function DocumentsOverview({ stats, attention, onGoToTab }: Props) {
  if (!stats) {
    return <p className="text-zinc-500 text-sm">Не удалось загрузить статистику документов.</p>
  }

  return (
    <div className="space-y-6">
      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard
          size="large" icon={Receipt} label="Неоплаченные счета"
          value={String(stats.invoicesUnpaid)} subtitle={`из ${stats.invoicesTotal} всего`}
          onClick={() => onGoToTab('invoices')}
        />
        <MetricCard
          size="large" icon={AlertTriangle} label="Документы требуют внимания"
          value={String(stats.attentionCount)} subtitle="проблемы и неполные данные"
          onClick={() => onGoToTab('attention')}
        />
        <MetricCard
          size="large" icon={UserX} label="Клиенты без договора"
          value={String(stats.clientsWithoutContract)} subtitle="работа без договора, готовится, не указано"
          onClick={() => onGoToTab('no-contract')}
        />
      </div>

      <div className={METRIC_GRID_CLASSNAME}>
        <MetricCard icon={ScrollText} label="Договоры" value={String(stats.contractsTotal)} subtitle={`${stats.contractsActive} действующих`} onClick={() => onGoToTab('contracts')} />
        <MetricCard icon={Layers} label="Приложения" value={String(stats.appendicesTotal)} subtitle="всего в реестре" onClick={() => onGoToTab('appendices')} />
        <MetricCard icon={Receipt} label="Счета" value={String(stats.invoicesTotal)} subtitle="всего в реестре" onClick={() => onGoToTab('invoices')} />
        <MetricCard icon={ClipboardCheck} label="Акты" value={String(stats.actsTotal)} subtitle="всего в реестре" onClick={() => onGoToTab('acts')} />
        <MetricCard icon={FileWarning} label="Заказы без счёта" value={String(stats.ordersWithoutInvoice)} subtitle="счёт требуется, но отсутствует" onClick={() => onGoToTab('attention')} />
        <MetricCard icon={FileWarning} label="Работы без акта" value={String(stats.completedWorksWithoutAct)} subtitle="завершены, акт отсутствует" onClick={() => onGoToTab('attention')} />
      </div>

      {attention.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-600/40 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => onGoToTab('attention')}
            className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-amber-950/30 transition-colors text-left"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-amber-200 text-sm flex-1">
              {attention.length} {attention.length === 1 ? 'запись требует' : 'записей требуют'} внимания
            </p>
          </button>
          <div className="divide-y divide-amber-900/30 border-t border-amber-900/30">
            {attention.slice(0, 5).map(a => (
              <div key={a.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                <p className="text-zinc-200 text-sm truncate">{a.workTitle}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {a.reasons.slice(0, 2).map(r => (
                    <span key={r} className="text-[11px] text-amber-300 bg-amber-900/30 rounded-full px-2 py-0.5 whitespace-nowrap">
                      {DOCUMENT_ATTENTION_LABELS[r]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
