'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, ExternalLink, ArrowRightLeft, SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { getSubscriptionDetail, type SubscriptionDetailDTO } from '@/lib/actions/finance'
import {
  updateSubscriptionHours, getSubscriptionAdjustmentHistory,
  type SubscriptionAdjustmentDTO,
} from '@/lib/actions/subscriptions'
import { getScheduleAnnotations } from '@/lib/actions/schedule'
import {
  SUBSCRIPTION_DISPLAY_STATUS_LABELS, SUBSCRIPTION_DISPLAY_STATUS_COLORS,
  SUBSCRIPTION_ARCHIVED_BADGE_LABEL, SUBSCRIPTION_ARCHIVED_BADGE_CLASS,
  getSubscriptionDisplayStatus,
} from '@/lib/subscription-model'
import { mergeScheduleEvent, type ScheduleEventVM } from '@/lib/schedule-model'
import type { CalendarEvent } from '@/lib/google-calendar'
import SubscriptionActionsMenu from '@/components/subscriptions/SubscriptionActionsMenu'
import HourStepper from '@/components/subscriptions/HourStepper'
import EventCardModal from '../../schedule/EventCardModal'

// Единый компонент карточки абонемента — открывается одинаково из Финансов,
// карточки клиента и подбора абонемента в заказе. Принимает только id и сам
// подгружает всё остальное через getSubscriptionDetail — раньше требовал
// целый SubscriptionRow, из-за чего вызывающим приходилось таскать за собой
// разные формы данных (см. ТЗ, часть 7: "не нужно делать три разных формы").
interface Props {
  subscriptionId: string
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatHours(v: number) {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)
}

function formatDate(v: string) {
  return format(parseISO(v), 'd MMM yyyy', { locale: ru })
}

function formatDateTime(v: string) {
  return format(parseISO(v), 'd MMM yyyy, HH:mm', { locale: ru })
}

const ROW = 'flex items-center justify-between py-2.5 border-b border-zinc-800/60 last:border-0'
const LABEL = 'text-zinc-500 text-xs'
const VALUE = 'text-zinc-100 text-sm text-right'

export default function SubscriptionDetailModal({ subscriptionId, onOpenChange, onChanged }: Props) {
  const [detail, setDetail] = useState<SubscriptionDetailDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adjustments, setAdjustments] = useState<SubscriptionAdjustmentDTO[] | null>(null)
  const [historyIncompleteBefore, setHistoryIncompleteBefore] = useState<string | null>(null)

  // Ручная корректировка часов
  const [packageHoursDraft, setPackageHoursDraft] = useState<number | null>(null)
  const [usedHoursDraft, setUsedHoursDraft] = useState<number | null>(null)
  const [adjustmentComment, setAdjustmentComment] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [savingHours, setSavingHours] = useState(false)
  const [hoursError, setHoursError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  // Открытие конкретной записи из истории списаний
  const [openVm, setOpenVm] = useState<ScheduleEventVM | null>(null)
  const [openingUsageId, setOpeningUsageId] = useState<string | null>(null)

  async function loadDetail() {
    const res = await getSubscriptionDetail(subscriptionId)
    if (res.ok) {
      setDetail(res.data)
      setPackageHoursDraft(res.data.packageHours)
      setUsedHoursDraft(res.data.usedHours)
    } else {
      setLoadError(res.error)
    }
  }

  useEffect(() => {
    let cancelled = false
    getSubscriptionDetail(subscriptionId).then(res => {
      if (cancelled) return
      if (res.ok) {
        setDetail(res.data)
        setPackageHoursDraft(res.data.packageHours)
        setUsedHoursDraft(res.data.usedHours)
      } else {
        setLoadError(res.error)
      }
    })
    getSubscriptionAdjustmentHistory(subscriptionId).then(res => {
      if (!cancelled) { setAdjustments(res.data); setHistoryIncompleteBefore(res.historyIncompleteBefore) }
    })
    return () => { cancelled = true }
  }, [subscriptionId])

  const remaining = detail?.remainingHours ?? 0
  const displayStatus = detail
    ? getSubscriptionDisplayStatus({ status: detail.status, isArchived: detail.isArchived, remainingHours: remaining })
    : null
  const isLow = displayStatus === 'LOW'

  const hoursChanged = detail != null && packageHoursDraft != null && usedHoursDraft != null
    && (packageHoursDraft !== detail.packageHours || usedHoursDraft !== detail.usedHours)
  const draftRemaining = packageHoursDraft != null && usedHoursDraft != null ? packageHoursDraft - usedHoursDraft : null

  async function handleConfirmHours() {
    if (packageHoursDraft == null || usedHoursDraft == null) return
    setSavingHours(true)
    setHoursError(null)
    const result = await updateSubscriptionHours(subscriptionId, {
      packageHours: packageHoursDraft,
      usedHours: usedHoursDraft,
      adjustmentComment: adjustmentComment.trim() || undefined,
    })
    setSavingHours(false)
    if (!result.ok) {
      setHoursError(result.error)
      return
    }
    setShowConfirm(false)
    setAdjustmentComment('')
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2500)
    await loadDetail()
    const adj = await getSubscriptionAdjustmentHistory(subscriptionId)
    setAdjustments(adj.data)
    setHistoryIncompleteBefore(adj.historyIncompleteBefore)
    onChanged?.()
  }

  async function handleOpenUsage(u: SubscriptionDetailDTO['usages'][number]) {
    if (!u.calendarEventId) return
    setOpeningUsageId(u.id)
    const annResult = await getScheduleAnnotations([u.calendarEventId])
    setOpeningUsageId(null)
    const annotation = annResult.data[u.calendarEventId] ?? null
    const calendarEvent: CalendarEvent = {
      id: u.calendarEventId,
      title: annotation?.title ?? u.eventTitle ?? 'Без названия',
      start: annotation?.startAt ?? u.usedAt,
      end: annotation?.endAt ?? u.usedAt,
      allDay: false,
      description: annotation?.description ?? '',
      location: '',
      calendar: 'studio',
      color: '#00c26b',
    }
    setOpenVm(mergeScheduleEvent(calendarEvent, annotation))
  }

  function adjustmentLine(a: SubscriptionAdjustmentDTO): string {
    if (a.type === 'MANUAL_UPDATE') {
      const parts: string[] = []
      if (a.oldUsedHours != null && a.newUsedHours != null && a.oldUsedHours !== a.newUsedHours) {
        parts.push(`Использовано: ${formatHours(a.oldUsedHours)} → ${formatHours(a.newUsedHours)} ч`)
      }
      if (a.oldRemainingHours != null && a.newRemainingHours != null && a.oldRemainingHours !== a.newRemainingHours) {
        parts.push(`Остаток: ${formatHours(a.oldRemainingHours)} → ${formatHours(a.newRemainingHours)} ч`)
      }
      if (a.oldTotalHours != null && a.newTotalHours != null && a.oldTotalHours !== a.newTotalHours) {
        parts.push(`Куплено: ${formatHours(a.oldTotalHours)} → ${formatHours(a.newTotalHours)} ч`)
      }
      return [parts.join(' · '), a.comment].filter(Boolean).join(' · ')
    }
    if (a.type === 'TRANSFER_OUT') {
      return ['Перенесено списание на другой абонемент', a.relatedScheduleEventDate ? `Связано с записью от ${formatDate(a.relatedScheduleEventDate)}` : null]
        .filter(Boolean).join(' · ')
    }
    if (a.type === 'TRANSFER_IN') {
      return ['Принято списание с другого абонемента', a.relatedScheduleEventDate ? `Связано с записью от ${formatDate(a.relatedScheduleEventDate)}` : null]
        .filter(Boolean).join(' · ')
    }
    return a.comment ?? ''
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0 pr-8">
          <DialogTitle className="text-white text-lg font-semibold">Абонемент</DialogTitle>
          {detail && (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_DISPLAY_STATUS_COLORS[displayStatus!]}`}>
                {SUBSCRIPTION_DISPLAY_STATUS_LABELS[displayStatus!]}
              </Badge>
              {detail.isArchived && (
                <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_ARCHIVED_BADGE_CLASS}`}>
                  {SUBSCRIPTION_ARCHIVED_BADGE_LABEL}
                </Badge>
              )}
              <SubscriptionActionsMenu
                subscription={{ id: detail.id, status: detail.status, isArchived: detail.isArchived }}
                onChanged={() => { onChanged?.(); onOpenChange(false) }}
              />
            </div>
          )}
          <p className="text-zinc-400 text-sm mt-2">
            {detail ? (
              <>
                <Link href={`/admin/clients/${detail.clientId}`} className="text-[#00c26b] hover:underline">
                  {detail.clientName}
                </Link>
                {' '}· от {formatDate(detail.purchasedAt)}
              </>
            ) : 'Загрузка...'}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loadError && <p className="text-red-400 text-sm">{loadError}</p>}
          {!detail && !loadError && <p className="text-zinc-500 text-sm">Загрузка...</p>}

          {detail && (
            <>
              {isLow && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-amber-950/40 border border-amber-900 text-amber-300 mb-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>Абонемент скоро закончится — осталось {formatHours(remaining)} ч.</p>
                </div>
              )}

              <div className={ROW}><span className={LABEL}>Куплено часов</span><span className={VALUE}>{formatHours(detail.packageHours)} ч</span></div>
              <div className={ROW}><span className={LABEL}>Оплачено</span><span className={VALUE}>{formatMoney(detail.paidAmount)}</span></div>
              <div className={ROW}><span className={LABEL}>Использовано</span><span className={VALUE}>{formatHours(detail.usedHours)} ч</span></div>
              <div className={ROW}><span className={LABEL}>Осталось</span><span className={VALUE}>{formatHours(remaining)} ч</span></div>
              <div className={ROW}><span className={LABEL}>Статус изменён</span><span className={VALUE}>{formatDate(detail.statusUpdatedAt)}</span></div>

              {detail.status === 'CANCELLED' && detail.cancellationReason && (
                <div className="pt-3">
                  <p className={`${LABEL} mb-1`}>Причина аннулирования</p>
                  <p className="text-zinc-300 text-sm whitespace-pre-wrap">{detail.cancellationReason}</p>
                </div>
              )}
              {detail.status === 'REFUNDED' && (
                <div className="pt-3 space-y-1">
                  {detail.refundAmount != null && (
                    <div className={ROW}><span className={LABEL}>Сумма возврата</span><span className={VALUE}>{formatMoney(detail.refundAmount)}</span></div>
                  )}
                  {detail.refundReason && (
                    <div>
                      <p className={`${LABEL} mb-1`}>Причина возврата</p>
                      <p className="text-zinc-300 text-sm whitespace-pre-wrap">{detail.refundReason}</p>
                    </div>
                  )}
                </div>
              )}
              {detail.adminComment && (
                <div className="pt-3">
                  <p className={`${LABEL} mb-1`}>Комментарий администратора</p>
                  <p className="text-zinc-300 text-sm whitespace-pre-wrap">{detail.adminComment}</p>
                </div>
              )}
              {detail.notes && (
                <div className="pt-3">
                  <p className={`${LABEL} mb-1`}>Заметки</p>
                  <p className="text-zinc-300 text-sm whitespace-pre-wrap">{detail.notes}</p>
                </div>
              )}

              {/* История списаний */}
              <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mt-5 mb-2">История списаний</p>
              {detail.usages.length === 0 ? (
                <p className="text-zinc-500 text-xs">Списаний пока не было — часы будут списываться при сохранении записей расписания через эту оплату.</p>
              ) : (
                <div className="space-y-1.5">
                  {detail.usages.map(u => {
                    const wasEdited = new Date(u.updatedAt).getTime() - new Date(u.createdAt).getTime() > 60_000
                    return (
                    <div key={u.id} className="flex items-center justify-between gap-3 bg-zinc-800/50 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-zinc-200 text-xs font-medium truncate">
                          {format(parseISO(u.usedAt), 'd MMM yyyy', { locale: ru })}
                          {u.eventTitle && ` · ${u.eventTitle}`}
                        </p>
                        <p className="text-zinc-500 text-[11px] truncate">
                          {[u.eventRoom, u.eventFormat].filter(Boolean).join(' · ') || '—'}
                          {u.comment && ` · ${u.comment}`}
                          {wasEdited && ' · изменено вручную'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-zinc-300 text-xs font-medium">{formatHours(u.usedHours)} ч</span>
                        {u.calendarEventId && (
                          <button
                            type="button"
                            onClick={() => handleOpenUsage(u)}
                            disabled={openingUsageId === u.id}
                            title="Открыть запись"
                            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-[#00c26b] transition-colors px-1.5 py-1 rounded disabled:opacity-50"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {openingUsageId === u.id ? 'Открываем...' : 'Открыть'}
                          </button>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}

              {/* Ручная корректировка часов */}
              <div className="mt-5 pt-4 border-t border-zinc-800">
                <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Ручная корректировка часов
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-400 text-xs">Куплено часов</span>
                    <HourStepper value={packageHoursDraft ?? 0} onChange={setPackageHoursDraft} step={0.5} min={0} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-400 text-xs">Использовано часов</span>
                    <HourStepper value={usedHoursDraft ?? 0} onChange={setUsedHoursDraft} step={0.5} min={0} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-400 text-xs">Осталось (авто)</span>
                    <span className="text-zinc-200 text-sm font-medium">{draftRemaining != null ? formatHours(draftRemaining) : '—'} ч</span>
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs mb-1.5">Комментарий к корректировке</label>
                    <textarea
                      value={adjustmentComment}
                      onChange={e => setAdjustmentComment(e.target.value)}
                      rows={2}
                      placeholder="Например: исправление после импорта из Google-таблицы"
                      className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none"
                    />
                  </div>
                  {hoursError && (
                    <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{hoursError}</p>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={!hoursChanged}
                      onClick={() => setShowConfirm(true)}
                      className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-40 disabled:hover:bg-[#00c26b] text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
                    >
                      Сохранить изменения
                    </button>
                    {savedFlash && <span className="text-[#00c26b] text-xs">Сохранено</span>}
                  </div>
                </div>
              </div>

              {/* История корректировок */}
              <div className="mt-5 pt-4 border-t border-zinc-800">
                <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5" /> История корректировок
                </p>
                {adjustments === null ? (
                  <p className="text-zinc-500 text-xs">Загрузка...</p>
                ) : (
                  <>
                    {adjustments.length === 0 && (
                      historyIncompleteBefore ? (
                        <p className="text-amber-400/80 text-xs">
                          История до {formatDateTime(historyIncompleteBefore)} частично недоступна из-за ранее произошедшей потери журнала. Текущие часы абонемента не пострадали.
                        </p>
                      ) : (
                        <p className="text-zinc-500 text-xs">Ручных корректировок пока не было.</p>
                      )
                    )}
                    {adjustments.length > 0 && (
                      <div className="space-y-1.5">
                        {historyIncompleteBefore && (
                          <p className="text-amber-400/80 text-[11px] mb-1.5">
                            История до {formatDateTime(historyIncompleteBefore)} частично недоступна из-за ранее произошедшей потери журнала.
                          </p>
                        )}
                        {adjustments.map(a => (
                          <div key={a.id} className="text-xs text-zinc-400 bg-zinc-800/30 rounded-lg px-3 py-2">
                            <span className="text-zinc-300">{formatDateTime(a.createdAt)}</span>
                            {' · '}{adjustmentLine(a)}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            Закрыть
          </button>
        </div>
      </DialogContent>

      {showConfirm && (
        <Dialog open onOpenChange={next => { if (!next) setShowConfirm(false) }}>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm p-0">
            <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800">
              <DialogTitle className="text-white text-lg font-semibold">Подтверждение</DialogTitle>
            </DialogHeader>
            <div className="px-6 py-4">
              <p className="text-zinc-300 text-sm">
                Вы меняете часы абонемента вручную. Это повлияет на финансы, карточку клиента и доступность абонемента в заказах. Продолжить?
              </p>
            </div>
            <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800">
              <button type="button" onClick={handleConfirmHours} disabled={savingHours}
                className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
                {savingHours ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button type="button" onClick={() => setShowConfirm(false)} disabled={savingHours}
                className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
                Отмена
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {openVm && (
        <EventCardModal
          vm={openVm}
          onOpenChange={open => { if (!open) setOpenVm(null) }}
          onSaved={() => { setOpenVm(null); loadDetail(); onChanged?.() }}
        />
      )}
    </Dialog>
  )
}
