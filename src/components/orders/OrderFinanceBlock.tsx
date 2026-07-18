'use client'

import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import GlowPill from '@/components/ui/glow-pill'
import { getMontageProjectsForOrder, updateMontageProject, type MontageProjectDTO } from '@/lib/actions/montage'
import { getOrder, updateOrderNetProfit } from '@/lib/actions/orders'
import { computeOrderNetProfit } from '@/lib/order-model'
import NetProfitOverrideDialog from './NetProfitOverrideDialog'
import type { OrderNetProfitMode } from '@prisma/client'

const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const LABEL = 'block text-zinc-400 text-xs'

function formatMoney(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface FinanceData {
  netProfitMode: OrderNetProfitMode
  netProfitManualAmount: number | null
  netProfitOverrideReason: string | null
  netProfitOverrideByName: string | null
  netProfitOverrideAt: string | null
}

interface Props {
  orderId: string | null
  // Тот же preliminaryAmount/estimatedPrice, что и раньше (дуал-сорсинг с
  // ScheduleEvent сохраняется — решает вызывающая сторона) — здесь только
  // переименованная подпись "Выручка по заказу", не новое поле. Строка, не
  // число — тот же паттерн контролируемого текстового инпута, что и у
  // остальных денежных полей в обеих модалках.
  revenueValue: string
  onRevenueChange: (v: string) => void
  editingRequired: boolean | null
  // Отдаёт родителю список непогашенных (не CANCELLED) проектов монтажа —
  // нужен MontageDisableChoiceDialog при отключении "Монтаж требуется"
  // (см. EditingRequiredControl в самих модалках), чтобы не делать второй
  // такой же запрос.
  onMontageProjectsLoaded?: (projects: MontageProjectDTO[]) => void
}

// Общий финансовый блок карточки заказа — используется и в OrderFormModal
// (CRM), и в EventCardModal (расписание/дашборд/карточка клиента), чтобы обе
// карточки одного заказа показывали одинаковую логику вместо двух разных
// независимых виджетов (см. AGENTS.md, единый источник данных). Выплата за
// монтаж и режим прибыли — самостоятельные overlay-мутации (тот же приём,
// что pause/cancel/archiveMontageProject и WorkDocumentsSection): сохраняются
// сразу через отдельные действия, не через общую кнопку "Сохранить" карточки
// — так EventCardModal, у которого нет полного OrderDTO под рукой (только
// annotation.orderId), может показывать и редактировать эти данные без
// изменений в своей общей форме/handleSave.
export default function OrderFinanceBlock({
  orderId, revenueValue, onRevenueChange, editingRequired, onMontageProjectsLoaded,
}: Props) {
  const revenue = revenueValue.trim() ? parseFloat(revenueValue) : null
  const [projects, setProjects] = useState<MontageProjectDTO[] | null>(null)
  const [editorAmountDraft, setEditorAmountDraft] = useState('')
  const [clientAmountDraft, setClientAmountDraft] = useState('')
  const [savingPayout, setSavingPayout] = useState(false)
  const [payoutSaved, setPayoutSaved] = useState(false)
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false)
  const [finance, setFinance] = useState<FinanceData | null>(null)

  // setState отложен через setTimeout(…, 0) для ветки "нет orderId" —
  // react-hooks/set-state-in-effect не разрешает синхронный setState в теле
  // эффекта (см. память проекта). Ветка с реальным orderId и так асинхронна
  // (setState происходит в .then()), этого правила не касается.
  useEffect(() => {
    let cancelled = false
    if (!orderId) {
      const timer = setTimeout(() => {
        setProjects([])
        setFinance({ netProfitMode: 'AUTO', netProfitManualAmount: null, netProfitOverrideReason: null, netProfitOverrideByName: null, netProfitOverrideAt: null })
      }, 0)
      return () => clearTimeout(timer)
    }

    getMontageProjectsForOrder(orderId).then(res => {
      if (cancelled) return
      const active = res.data.filter(p => p.status !== 'CANCELLED')
      setProjects(res.data)
      onMontageProjectsLoaded?.(active)
      const primary = active[0]
      setEditorAmountDraft(primary?.editorAmount != null ? String(primary.editorAmount) : '')
      setClientAmountDraft(primary?.clientAmount != null ? String(primary.clientAmount) : '')
    })
    getOrder(orderId).then(res => {
      if (cancelled) return
      if (res.ok) {
        setFinance({
          netProfitMode: res.data.netProfitMode,
          netProfitManualAmount: res.data.netProfitManualAmount,
          netProfitOverrideReason: res.data.netProfitOverrideReason,
          netProfitOverrideByName: res.data.netProfitOverrideByName,
          netProfitOverrideAt: res.data.netProfitOverrideAt,
        })
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const activeProject = projects?.find(p => p.status !== 'CANCELLED') ?? null
  const montageEditorAmountTotal = activeProject?.editorAmount ?? null
  const netProfit = computeOrderNetProfit({
    revenue, montageEditorAmountTotal,
    mode: finance?.netProfitMode ?? 'AUTO',
    manualAmount: finance?.netProfitManualAmount ?? null,
  })

  async function handleSavePayout() {
    if (!activeProject) return
    setSavingPayout(true)
    const result = await updateMontageProject(activeProject.id, {
      editorAmount: editorAmountDraft.trim() ? parseFloat(editorAmountDraft) : null,
      clientAmount: clientAmountDraft.trim() ? parseFloat(clientAmountDraft) : null,
    })
    setSavingPayout(false)
    if (result.ok) {
      setProjects(prev => prev?.map(p => p.id === activeProject.id ? result.data : p) ?? null)
      setPayoutSaved(true)
      setTimeout(() => setPayoutSaved(false), 2000)
    }
  }

  async function handleNetProfitChange(mode: OrderNetProfitMode, manualAmount: number | null, reason: string | null) {
    if (!orderId) return
    const result = await updateOrderNetProfit(orderId, { mode, manualAmount, reason })
    if (result.ok) {
      setFinance({
        netProfitMode: result.data.netProfitMode,
        netProfitManualAmount: result.data.netProfitManualAmount,
        netProfitOverrideReason: result.data.netProfitOverrideReason,
        netProfitOverrideByName: result.data.netProfitOverrideByName,
        netProfitOverrideAt: result.data.netProfitOverrideAt,
      })
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div>
          <Label>Выручка по заказу, ₽</Label>
          <input className={`${INPUT} mt-1.5`} type="number" min="0" placeholder="напр. 15000" value={revenueValue}
            onChange={e => onRevenueChange(e.target.value)} />
        </div>

        {editingRequired && (
          <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 space-y-2.5">
            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Финансы монтажа</p>
            {projects === null ? (
              <p className="text-zinc-500 text-xs">Загрузка...</p>
            ) : !activeProject ? (
              <p className="text-zinc-500 text-xs">Проект монтажа ещё не создан — появится после сохранения.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Выплата за монтаж, ₽</Label>
                    <input className={INPUT} type="number" min="0" placeholder="напр. 15000" value={editorAmountDraft}
                      onChange={e => setEditorAmountDraft(e.target.value)} />
                  </div>
                  <div>
                    <Label>Клиент платит за монтаж, ₽</Label>
                    <input className={INPUT} type="number" min="0" placeholder="напр. 20000" value={clientAmountDraft}
                      onChange={e => setClientAmountDraft(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={handleSavePayout} disabled={savingPayout}
                    className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-100 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    {savingPayout ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  {payoutSaved && <span className="text-[#00c26b] text-xs">Сохранено</span>}
                  <GlowPill color="violet" icon={HardDrive} size="sm">
                    {activeProject.editorName ?? 'Монтажёр не назначен'}
                  </GlowPill>
                </div>
              </>
            )}
          </div>
        )}

        <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 text-xs">Предварительная прибыль</span>
            <span className="text-zinc-300 text-sm">{formatMoney(netProfit.autoAmount)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className={LABEL}>Чистая прибыль студии, ₽</span>
            <div className="flex items-center gap-2">
              <span className="text-zinc-100 text-sm font-medium">{formatMoney(netProfit.amount)}</span>
              {finance?.netProfitMode === 'MANUAL_OVERRIDE' && (
                <GlowPill as="button" color="amber" size="sm" onClick={() => setOverrideDialogOpen(true)}
                  title="Изменить вручную указанное значение" ariaLabel="Прибыль изменена вручную — нажмите, чтобы изменить">
                  Изменено вручную
                </GlowPill>
              )}
            </div>
          </div>
          {finance?.netProfitMode === 'MANUAL_OVERRIDE' ? (
            <p className="text-zinc-500 text-[11px]">
              {finance.netProfitOverrideByName && finance.netProfitOverrideAt
                ? `Подтверждено: ${finance.netProfitOverrideByName}, ${new Date(finance.netProfitOverrideAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : 'Подтверждено администратором'}
              {finance.netProfitOverrideReason && ` · ${finance.netProfitOverrideReason}`}
              {' · '}
              <button type="button" className="underline hover:text-zinc-300" onClick={() => handleNetProfitChange('AUTO', null, null)}>
                Вернуться к автоматическому расчёту
              </button>
            </p>
          ) : (
            <button type="button" className="text-zinc-500 text-[11px] underline hover:text-zinc-300"
              onClick={() => setOverrideDialogOpen(true)} disabled={!orderId} title={!orderId ? 'Сначала сохраните заказ' : undefined}>
              Указать вручную
            </button>
          )}
        </div>
      </div>

      <NetProfitOverrideDialog
        open={overrideDialogOpen}
        onOpenChange={setOverrideDialogOpen}
        autoAmount={netProfit.autoAmount}
        initialManualAmount={finance?.netProfitManualAmount ?? null}
        initialReason={finance?.netProfitOverrideReason ?? null}
        onConfirm={(manualAmount, reason) => { setOverrideDialogOpen(false); handleNetProfitChange('MANUAL_OVERRIDE', manualAmount, reason) }}
      />
    </>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className={LABEL}>{children}</label>
}
