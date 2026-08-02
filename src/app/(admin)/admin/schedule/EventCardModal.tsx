'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import GlowPill from '@/components/ui/glow-pill'
import { upsertScheduleEvent } from '@/lib/actions/schedule'
import { getOrder, type OrderDTO } from '@/lib/actions/orders'
import { getEffectiveEventType, type ScheduleEventVM } from '@/lib/schedule-model'
import { EVENT_TYPE_LABELS, requiresFullBookingForm, type EventType } from '@/lib/event-type'
import { getOrderPromotion, getVisibleOrderComment, PROMOTION_PILL_LABEL, type OrderPromotionType } from '@/lib/promotion-model'
import { useAutosave, readAutosaveDraft, clearAutosaveDraft, type StoredDraft } from '@/lib/hooks/use-autosave'
import SaveStatusIndicator from '@/components/ui/save-status-indicator'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const LABEL = 'block text-zinc-400 text-xs mb-1.5'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

interface Props {
  vm: ScheduleEventVM
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

// 2026-08-02: урезан до лёгкого режима аннотирования — единственный
// оставшийся потребитель этого компонента для КОММЕРЧЕСКИХ записей
// (STUDIO_BOOKING/OFFSITE_SHOOT) был Расписание и ещё 4 точки входа; все они
// переведены на каноническую карточку заказа (OrderFormModal, см. ORDERS.md,
// "Карточка заказа — какой компонент канонический"). Здесь остаётся только
// то, что реально нужно для НЕ-коммерческих записей календаря (встречи,
// отсутствия сотрудников, служебные пометки, "прочее") — комментарий, акция,
// смена типа события. Клиент/оплата/материалы/монтаж/документы отсюда
// удалены НЕ потому что урезана функциональность внутри самого экрана — они
// просто больше не нужны здесь: единственная реализация этих полей теперь в
// OrderFormModal.tsx (см. AGENTS.md, правило 11 — не поддерживать вторую
// независимую реализацию тех же полей).
//
// Если администратор меняет тип события ЗДЕСЬ на коммерческий и жмёт
// "Сохранить" — см. handleSave: это единственное место, где ещё нужна ссылка
// на OrderFormModal, поэтому импорт СТРОГО динамический (`import(...)`, как
// уже сделано для неё в OrdersArchiveView.tsx), а не статический — иначе
// цикл OrderFormModal → SubscriptionPaymentBlock → SubscriptionDetailModal →
// EventCardModal → OrderFormModal.
export default function EventCardModal({ vm, onOpenChange, onSaved }: Props) {
  const { calendarEvent, annotation } = vm

  const [eventType, setEventType] = useState<EventType>(getEffectiveEventType(vm))
  // Комментарий: до первого сохранения строки ScheduleEvent ещё не существует
  // (annotation === null) — донор единственного поля тогда описание события
  // Google Calendar, как и раньше (см. историю этого компонента в git).
  const [notes, setNotes] = useState(
    annotation ? (getVisibleOrderComment({ comment: annotation.notes ?? null }) ?? '') : (calendarEvent.description ?? ''),
  )
  const [promotionType, setPromotionType] = useState<OrderPromotionType | null>(
    getOrderPromotion({ promotionType: annotation?.promotionType ?? null, comment: annotation?.notes ?? null }),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Переход на каноническую карточку заказа — только если ЭТИМ сохранением
  // запись впервые стала коммерческой (см. handleSave).
  const [reclassifiedOrder, setReclassifiedOrder] = useState<OrderDTO | null>(null)
  const [OrderFormModalComp, setOrderFormModalComp] = useState<typeof import('../crm/OrderFormModal').default | null>(null)

  // Единая точка построения payload для upsertScheduleEvent — используется и
  // явным "Сохранить" (см. handleSave), и автосохранением (см. useAutosave
  // ниже). Поля клиента/оплаты/материалов и т.п. сюда не входят — их просто
  // не остаётся редактировать в этом компоненте (см. комментарий выше), а не
  // потому что их нужно обнулять: сервер трактует отсутствие ключа в payload
  // как "не трогать" для каждого из них (проверено по коду upsertScheduleEvent,
  // src/lib/actions/schedule.ts — все раньше редактируемые здесь поля пишутся
  // через `input.field !== undefined && {...}` или явный fallback на текущее
  // значение), поэтому урезание формы не стирает то, что уже было сохранено
  // раньше (например, если запись когда-то была коммерческой, а потом её
  // переклассифицировали обратно).
  function buildEventInput() {
    return {
      calendarEventId: calendarEvent.id,
      title: calendarEvent.title,
      description: calendarEvent.description,
      startAt: calendarEvent.start,
      endAt: calendarEvent.end,
      eventType,
      notes,
      promotionType,
    }
  }

  const storageKey = `studio-lk:autosave:event:${calendarEvent.id}`
  const autosave = useAutosave({
    value: buildEventInput(),
    onSave: async input => {
      const result = await upsertScheduleEvent(input)
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
    enabled: !saving,
    storageKey,
  })

  const [draftBanner, setDraftBanner] = useState<StoredDraft<ReturnType<typeof buildEventInput>> | null>(null)

  // Проверка черновика — один раз при открытии карточки. setState отложен
  // через setTimeout(…, 0) — react-hooks/set-state-in-effect (см. память проекта).
  useEffect(() => {
    const timer = setTimeout(() => {
      const draft = readAutosaveDraft<ReturnType<typeof buildEventInput>>(storageKey)
      if (draft) setDraftBanner(draft)
    }, 0)
    return () => clearTimeout(timer)
  }, [storageKey])

  function applyDraft(input: ReturnType<typeof buildEventInput>) {
    setNotes(input.notes ?? '')
    setPromotionType(input.promotionType ?? null)
    if (input.eventType) setEventType(input.eventType)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const result = await upsertScheduleEvent(buildEventInput())
      if (!result.ok) {
        setError(result.error)
        return
      }

      // Запись была НЕ-коммерческой и стала коммерческой именно этим
      // сохранением (см. заголовочный комментарий) — вместо обычного
      // закрытия передаём управление канонической карточке заказа, у неё уже
      // есть свежесозданный orderId (см. ensureOrderForNewBooking, schedule.ts).
      const wasCommercial = requiresFullBookingForm(getEffectiveEventType(vm))
      if (!wasCommercial && requiresFullBookingForm(eventType) && result.data.orderId) {
        const [orderResult, mod] = await Promise.all([
          getOrder(result.data.orderId),
          import('../crm/OrderFormModal'),
        ])
        if (orderResult.ok) {
          setOrderFormModalComp(() => mod.default)
          setReclassifiedOrder(orderResult.data)
          return
        }
      }

      onSaved()
      onOpenChange(false)
    } catch (e) {
      console.error('[EventCardModal.handleSave]', e)
      setError('Не удалось сохранить запись из-за непредвиденной ошибки. Попробуйте ещё раз.')
    } finally {
      setSaving(false)
    }
  }

  if (reclassifiedOrder && OrderFormModalComp) {
    return (
      <OrderFormModalComp
        order={reclassifiedOrder}
        onOpenChange={open => { if (!open) { setReclassifiedOrder(null); onSaved(); onOpenChange(false) } }}
        onSaved={onSaved}
      />
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl sm:max-w-[min(1040px,94vw)] max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ background: calendarEvent.calendar === 'studio' ? '#00c26b' : '#3b82f6' }}
            />
            <DialogTitle className="text-white text-lg font-semibold">{calendarEvent.title}</DialogTitle>
          </div>
          <p className="text-zinc-400 text-sm">
            {format(parseISO(calendarEvent.start), 'd MMMM yyyy', { locale: ru })}
            {' · '}
            {calendarEvent.allDay
              ? 'Весь день'
              : `${format(parseISO(calendarEvent.start), 'HH:mm')} – ${format(parseISO(calendarEvent.end), 'HH:mm')}`}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {draftBanner && (
            <div className="flex items-center justify-between gap-3 bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2.5 text-xs">
              <span className="text-amber-300">
                Найден несохранённый черновик от {format(parseISO(draftBanner.updatedAt), 'd MMM yyyy, HH:mm', { locale: ru })}.
              </span>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button type="button" onClick={() => { applyDraft(draftBanner.value); setDraftBanner(null) }}
                  className="text-amber-300 underline hover:text-amber-200">Восстановить</button>
                <button type="button" onClick={() => { clearAutosaveDraft(storageKey); setDraftBanner(null) }}
                  className="text-zinc-400 underline hover:text-zinc-300">Отклонить</button>
              </div>
            </div>
          )}

          <div>
            <label className={LABEL}>Комментарий / нюансы</label>
            <textarea
              className={`${INPUT} resize-none max-h-64 overflow-y-auto`}
              rows={5}
              placeholder="Добавьте важные детали, список оборудования, адрес или пожелания клиента"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
            {/* Акция — структурированный тоггл, а не текст, вставляемый в
                комментарий (см. src/lib/promotion-model.ts). Повторный клик
                снимает отметку; комментарий этим не затрагивается. */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="text-zinc-500 text-[11px]">Быстрые пометки:</span>
              <GlowPill
                as="button"
                color={promotionType === 'FIRST_VISIT_20' ? 'green' : 'zinc'}
                onClick={() => setPromotionType(p => p === 'FIRST_VISIT_20' ? null : 'FIRST_VISIT_20')}
                title={promotionType === 'FIRST_VISIT_20' ? 'Убрать акцию' : 'Отметить акцию «−20% первый визит»'}
                ariaLabel={promotionType === 'FIRST_VISIT_20' ? 'Акция «−20% первый визит» отмечена — нажмите, чтобы убрать' : 'Отметить акцию «−20% первый визит»'}
              >
                {PROMOTION_PILL_LABEL.FIRST_VISIT_20}
              </GlowPill>
            </div>
          </div>

          <p className={SECTION}>Тип события</p>
          <select className={SELECT} value={eventType} onChange={e => setEventType(e.target.value as EventType)}>
            {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map(t => (
              <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          {requiresFullBookingForm(eventType) ? (
            <p className="text-zinc-500 text-xs">
              После сохранения откроется полная карточка заказа (клиент, оплата, материалы, монтаж).
            </p>
          ) : (
            <p className="text-zinc-500 text-xs">
              Для типа «{EVENT_TYPE_LABELS[eventType]}» материалы и оплата не проверяются.
            </p>
          )}

          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <SaveStatusIndicator status={autosave.status} error={autosave.error} />
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" onClick={async () => { await autosave.flush(); onOpenChange(false) }}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
            Закрыть
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
