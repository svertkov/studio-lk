'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Copy, Check, ExternalLink, AlertTriangle, UserPlus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import GlowPill from '@/components/ui/glow-pill'
import { upsertScheduleEvent, findSimilarClientsForEvent, confirmScheduleClient, type SimilarClientMatch } from '@/lib/actions/schedule'
import { chargeEventToSubscription, createSubscription, removeEventSubscriptionCharge } from '@/lib/actions/subscriptions'
import { parseEventTitle } from '@/lib/event-category'
import type { ScheduleEventVM } from '@/lib/schedule-model'
import {
  MATERIALS_WARNING_TEXT,
  getEffectiveEventType, isPastBooking, shouldShowMaterialsBadge,
  type ClientConfirmationStatus,
  MAKEUP_QUICK_OPTIONS, MAKEUP_DURATION_MAX_MINUTES, normalizeMakeupDurationMinutes, computeMakeupInterval, type MakeupInterval,
  QUICK_COMMENT_TEMPLATES, hasQuickCommentTemplate, applyQuickCommentTemplate,
} from '@/lib/schedule-model'
import { EVENT_TYPE_LABELS, type EventType } from '@/lib/event-type'
import { PAYMENT_METHOD_LABELS, ONE_TIME_PAYMENT_METHODS, type PaymentMethod } from '@/lib/schedule-model'
import { ROOM_DICTIONARY, FORMAT_DICTIONARY } from '@/lib/import/normalize'
import MaterialsStatusBadge from './MaterialsStatusBadge'
import SubscriptionPaymentBlock, { type SubscriptionPaymentHandle } from './SubscriptionPaymentBlock'
import AddClientModal from '../clients/AddClientModal'

// "08:00–09:00", либо с датой спереди, если гримёр уходит на предыдущий
// календарный день ("9 мар., 23:00–09:00" — начало съёмки в 00:xx).
function formatMakeupRange(interval: MakeupInterval): string {
  const time = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const sameDay = interval.start.toDateString() === interval.end.toDateString()
  const startLabel = sameDay
    ? time(interval.start)
    : `${interval.start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time(interval.start)}`
  return `${startLabel}–${time(interval.end)}`
}

const ROOM_OPTIONS = ROOM_DICTIONARY.map(e => e.canonical)
const FORMAT_OPTIONS = FORMAT_DICTIONARY.map(e => e.canonical)

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const LABEL = 'block text-zinc-400 text-xs mb-1.5'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

interface Props {
  vm: ScheduleEventVM
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

function selectWithCustom(options: string[], current: string) {
  return current && !options.includes(current) ? [current, ...options] : options
}

export default function EventCardModal({ vm, onOpenChange, onSaved }: Props) {
  const { calendarEvent, annotation } = vm

  // Зал/камеры из самого события Google Calendar ("тз, 3к" в названии или
  // "Тёмный зал, 3 камеры" в описании) — используются как подсказка по
  // умолчанию, только если администратор ещё не указал их сам в карточке.
  // Once сохранено вручную, эта авто-подсказка больше не участвует (аннотация
  // побеждает) — см. parseEventTitle в src/lib/event-category.ts.
  const parsedFromCalendar = parseEventTitle(calendarEvent.title, calendarEvent.description)

  const [eventType, setEventType] = useState<EventType>(getEffectiveEventType(vm))
  const [room, setRoom] = useState(annotation?.room ?? parsedFromCalendar.hall ?? '')
  const [formatValue, setFormatValue] = useState(annotation?.format ?? '')
  const [camerasCount, setCamerasCount] = useState(
    annotation?.camerasCount?.toString() ?? parsedFromCalendar.cameras?.toString() ?? '',
  )
  const [estimatedPrice, setEstimatedPrice] = useState(annotation?.estimatedPrice?.toString() ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(annotation?.paymentMethod ?? '')
  const [notes, setNotes] = useState(annotation?.notes ?? '')
  const [yandexDiskUrl, setYandexDiskUrl] = useState(annotation?.yandexDiskUrl ?? '')
  const [nasBackupUrl, setNasBackupUrl] = useState(annotation?.nasBackupUrl ?? '')
  const [materialsComment, setMaterialsComment] = useState(annotation?.materialsComment ?? '')
  const [editingRequired, setEditingRequired] = useState<boolean | null>(annotation?.editingRequired ?? null)
  const [clientNameRaw, setClientNameRaw] = useState(annotation?.clientNameRaw ?? '')
  const [contactRaw, setContactRaw] = useState(annotation?.contactRaw ?? '')
  const [companyRaw, setCompanyRaw] = useState(annotation?.companyRaw ?? '')

  // Гримёр — длительность хранится строкой + единицей измерения только для
  // удобства ручного ввода; в БД (ScheduleEvent.makeupDurationMinutes) и при
  // сохранении всегда уходят целые минуты через normalizeMakeupDurationMinutes.
  const [makeupDurationInput, setMakeupDurationInput] = useState(
    annotation?.makeupDurationMinutes != null ? String(annotation.makeupDurationMinutes) : '',
  )
  const [makeupDurationUnit, setMakeupDurationUnit] = useState<'minutes' | 'hours'>('minutes')

  const [paymentMode, setPaymentMode] = useState<'ONE_TIME' | 'SUBSCRIPTION'>(
    annotation?.subscriptionUsage ? 'SUBSCRIPTION' : 'ONE_TIME',
  )
  const [subscriptionValid, setSubscriptionValid] = useState(true)
  const subscriptionRef = useRef<SubscriptionPaymentHandle>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<'yandex' | 'nas' | null>(null)

  const [clientId, setClientId] = useState<string | null>(annotation?.clientId ?? null)
  const [clientName, setClientName] = useState<string | null>(annotation?.clientName ?? null)
  const [similarMatches, setSimilarMatches] = useState<SimilarClientMatch[] | null>(null)
  const [searchingClient, setSearchingClient] = useState(false)
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [addClientOpen, setAddClientOpen] = useState(false)

  const materialsStatus = annotation?.materialsStatus ?? 'NO_LINKS'
  const yandexAddedAt = annotation?.yandexDiskUrlAddedAt ? parseISO(annotation.yandexDiskUrlAddedAt) : null
  const yandexExpiresAt = annotation?.yandexDiskUrlExpiresAt ? parseISO(annotation.yandexDiskUrlExpiresAt) : null
  const warningText = MATERIALS_WARNING_TEXT[materialsStatus]
  const hasClient = !!clientId
  const eventDurationHours = Math.max(0, (new Date(calendarEvent.end).getTime() - new Date(calendarEvent.start).getTime()) / 3600000)
  const makeupDurationMinutes = normalizeMakeupDurationMinutes(makeupDurationInput, makeupDurationUnit)
  const makeupInterval = computeMakeupInterval(new Date(calendarEvent.start), makeupDurationMinutes)
  const isBookingPast = isPastBooking(vm)
  // Лёгкая, СОВЕТУЮЩАЯ (не блокирующая) проверка формата — только для живой
  // подсказки под полем; сохранить ссылку можно в любом случае, даже если она
  // не похожа на Яндекс.Диск (см. ТЗ: "не должно быть ситуации, когда ссылка
  // визуально введена, но форма считает поле невалидным без понятной причины").
  const yandexUrlTrimmedLive = yandexDiskUrl.trim()
  const looksLikeYandexLink = /^https?:\/\/(disk\.yandex\.[a-z.]+|yadi\.sk)\//i.test(yandexUrlTrimmedLive)
  // Материалы: наличие ссылки на Яндекс.Диск снимает предупреждение само по
  // себе — NAS-бэкап при этом просто дополнительный плюс, а не обязательное
  // условие (см. Материалы ниже и schedule-model.ts: getMaterialsDisplay/getBookingAttentionInfo).
  const hasYandexNow = !!yandexDiskUrl
  const hasNasNow = !!nasBackupUrl
  const paymentMissingNow = paymentMode === 'ONE_TIME' && !estimatedPrice
  // Единственная причина, по которой кнопка "Сохранить" может быть
  // заблокирована помимо самого процесса сохранения — см. disabled на кнопке
  // ниже. Вынесено в переменную, чтобы явно показать причину рядом с кнопкой,
  // а не просто оставить её серой без объяснения.
  const subscriptionBlocksSave = eventType === 'STUDIO_BOOKING' && hasClient && paymentMode === 'SUBSCRIPTION' && !subscriptionValid

  // Лучшая догадка об имени клиента: то, что вручную ввели в "Имя из
  // календаря", иначе — разбор названия/описания события Google Calendar
  // (например «Подкаст, тз, 3к, Соломатин» → «Соломатин»).
  const guessedClientName = clientNameRaw.trim() || parsedFromCalendar.client || ''

  // Пытаемся сами найти клиента по имени из названия/описания события в Google
  // Calendar — та же функция поиска, что и в блоке "Клиенты из расписания" на
  // странице Клиентов, просто вызванная прямо в карточке, чтобы не заставлять
  // администратора переключаться на другую страницу ради привязки клиента.
  async function runClientSearch() {
    if (!guessedClientName && !contactRaw.trim() && !companyRaw.trim()) { setSimilarMatches([]); return }
    setSearchingClient(true)
    setLinkError(null)
    const result = await findSimilarClientsForEvent({
      name: guessedClientName || undefined,
      contact: contactRaw.trim() || undefined,
      company: companyRaw.trim() || undefined,
    })
    setSearchingClient(false)
    setSimilarMatches(result.ok ? result.data : [])
    setSelectedMatchId('')
  }

  // Автопоиск при открытии карточки — без runClientSearch(), чтобы не задавать
  // состояние синхронно в теле эффекта (setSearchingClient обновляется только
  // из клика "Искать"/"Изменить"; здесь достаточно того, что similarMatches
  // остаётся null, пока запрос не завершится).
  useEffect(() => {
    if (hasClient || eventType !== 'STUDIO_BOOKING') return
    if (!guessedClientName && !contactRaw.trim() && !companyRaw.trim()) return
    let cancelled = false
    findSimilarClientsForEvent({
      name: guessedClientName || undefined,
      contact: contactRaw.trim() || undefined,
      company: companyRaw.trim() || undefined,
    }).then(result => {
      if (!cancelled) setSimilarMatches(result.ok ? result.data : [])
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Привязка клиента сохраняется сразу (не дожидаясь общей кнопки "Сохранить"),
  // чтобы блок абонементов клиента тут же подтянулся и предупреждение "оплата
  // доступна после привязки" исчезло без перезагрузки формы.
  async function handleLinkClient(id: string, name: string) {
    setLinking(true)
    setLinkError(null)
    const result = annotation?.id
      ? await confirmScheduleClient(annotation.id, id)
      : await upsertScheduleEvent({
          calendarEventId: calendarEvent.id,
          title: calendarEvent.title,
          description: calendarEvent.description,
          startAt: calendarEvent.start,
          endAt: calendarEvent.end,
          clientId: id,
          clientConfirmationStatus: 'CONFIRMED',
        })
    setLinking(false)
    if (!result.ok) { setLinkError(result.error); return }
    setClientId(id)
    setClientName(name)
    setSimilarMatches(null)
  }

  async function copyLink(url: string, field: 'yandex' | 'nas') {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch {
      // буфер обмена недоступен — молча игнорируем, ссылка всё равно видна в поле
    }
  }

  async function handleSave(confirmationOverride?: ClientConfirmationStatus) {
    setSaving(true)
    setError(null)
    // Всё тело — в try/finally: раньше setSaving(false) вызывался отдельно
    // перед каждым return, и если бы что-то неожиданно бросило исключение
    // (а не просто вернуло {ok:false}) — например сетевой сбой посреди одного
    // из последовательных вызовов ниже — кнопка "Сохранить" оставалась бы
    // задизейбленной навсегда без единой видимой ошибки: saving так и не
    // вернулся бы в false. finally гарантирует сброс при любом исходе.
    try {
      const result = await upsertScheduleEvent({
        calendarEventId: calendarEvent.id,
        title: calendarEvent.title,
        description: calendarEvent.description,
        startAt: calendarEvent.start,
        endAt: calendarEvent.end,
        eventType,
        room,
        format: formatValue,
        camerasCount: camerasCount ? parseInt(camerasCount, 10) : null,
        // Абонемент оплачивается один раз при покупке — отдельная запись не должна
        // повторно создавать выручку, поэтому очищаем разовую цену.
        estimatedPrice: paymentMode === 'SUBSCRIPTION' ? null : (estimatedPrice ? parseFloat(estimatedPrice) : null),
        paymentMethod: paymentMode === 'SUBSCRIPTION' ? null : (paymentMethod || null),
        notes,
        yandexDiskUrl: yandexDiskUrl || null,
        nasBackupUrl: nasBackupUrl || null,
        materialsComment,
        editingRequired,
        clientNameRaw,
        contactRaw,
        companyRaw,
        makeupDurationMinutes,
        ...(confirmationOverride && { clientConfirmationStatus: confirmationOverride }),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }

      if (eventType === 'STUDIO_BOOKING' && clientId) {
        if (paymentMode === 'ONE_TIME') {
          if (annotation?.subscriptionUsage) {
            const removed = await removeEventSubscriptionCharge(result.data.id)
            if (!removed.ok) { setError(removed.error); return }
          }
        } else {
          const value = subscriptionRef.current?.getValue()
          if (value?.paymentType === 'EXISTING') {
            const charged = await chargeEventToSubscription({
              scheduleEventId: result.data.id, subscriptionId: value.subscriptionId, usedHours: value.usedHours,
            })
            if (!charged.ok) { setError(charged.error); return }
          } else if (value?.paymentType === 'NEW') {
            const created = await createSubscription({
              clientId, packageHours: value.packageHours, paidAmount: value.paidAmount, purchasedAt: value.purchasedAt,
            })
            if (!created.ok) { setError(created.error); return }
            const charged = await chargeEventToSubscription({
              scheduleEventId: result.data.id, subscriptionId: created.data.id, usedHours: value.usedHours,
            })
            if (!charged.ok) { setError(charged.error); return }
          }
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

  return (
    <>
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl sm:max-w-[662px] max-h-[88vh] flex flex-col p-0">
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
          {calendarEvent.description && (
            <p className="text-zinc-400 text-xs whitespace-pre-wrap bg-zinc-800/50 rounded-lg p-3">
              {calendarEvent.description}
            </p>
          )}

          <p className={SECTION}>Тип события</p>
          <select className={SELECT} value={eventType} onChange={e => setEventType(e.target.value as EventType)}>
            {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map(t => (
              <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
            ))}
          </select>

          <div>
            <label className={LABEL}>Комментарий / нюансы</label>
            <textarea className={`${INPUT} resize-none`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            {QUICK_COMMENT_TEMPLATES.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-zinc-500 text-[11px]">Быстрые комментарии:</span>
                {QUICK_COMMENT_TEMPLATES.map(t => {
                  const active = hasQuickCommentTemplate(notes, t.text)
                  return (
                    <GlowPill
                      key={t.id}
                      as="button"
                      color={active ? 'green' : 'zinc'}
                      disabled={active}
                      onClick={() => setNotes(n => applyQuickCommentTemplate(n, t.text))}
                      title={active ? 'Уже добавлено в комментарий' : 'Добавить в комментарий'}
                      ariaLabel={active ? `${t.label} — уже добавлено в комментарий` : `Добавить в комментарий: ${t.label}`}
                    >
                      {t.label}
                    </GlowPill>
                  )
                })}
              </div>
            )}
          </div>

          {eventType !== 'STUDIO_BOOKING' && (
            <p className="text-zinc-500 text-xs">
              Для типа «{EVENT_TYPE_LABELS[eventType]}» материалы и оплата не проверяются.
            </p>
          )}

          {eventType === 'STUDIO_BOOKING' && (
          <>
          <p className={SECTION}>Съёмка</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Зал</label>
              <select className={SELECT} value={room} onChange={e => setRoom(e.target.value)}>
                <option value="">Не указан</option>
                {selectWithCustom(ROOM_OPTIONS, room).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>Формат</label>
              <select className={SELECT} value={formatValue} onChange={e => setFormatValue(e.target.value)}>
                <option value="">Не указан</option>
                {selectWithCustom(FORMAT_OPTIONS, formatValue).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL}>Количество камер</label>
            <input className={INPUT} type="number" min="0" placeholder="напр. 3" value={camerasCount}
              onChange={e => setCamerasCount(e.target.value)} />
          </div>

          <p className={SECTION}>Гримёр</p>
          <div>
            <label className={LABEL}>Время на гримёра до съёмки</label>
            <div className="flex items-center gap-2">
              <input
                className={`${INPUT} flex-1`}
                type="number"
                min="0"
                inputMode="decimal"
                placeholder="0"
                value={makeupDurationInput}
                onChange={e => setMakeupDurationInput(e.target.value)}
              />
              <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-lg p-1 flex-shrink-0">
                {(['minutes', 'hours'] as const).map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setMakeupDurationUnit(u)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      makeupDurationUnit === u ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {u === 'minutes' ? 'мин' : 'ч'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {MAKEUP_QUICK_OPTIONS.map(opt => {
              const active = makeupDurationUnit === 'minutes' && makeupDurationMinutes === opt.minutes
              return (
                <GlowPill
                  key={opt.minutes}
                  as="button"
                  color={active ? 'green' : 'zinc'}
                  onClick={() => { setMakeupDurationInput(String(opt.minutes)); setMakeupDurationUnit('minutes') }}
                  title={`Гримёр: ${opt.label}`}
                  ariaLabel={`Установить время гримёра: ${opt.label}`}
                >
                  {opt.label}
                </GlowPill>
              )
            })}
          </div>
          {makeupDurationMinutes != null && (
            makeupInterval ? (
              <p className="text-zinc-400 text-xs">Гримёр: {formatMakeupRange(makeupInterval)}</p>
            ) : (
              <p className="text-zinc-500 text-xs">Интервал будет рассчитан после выбора времени съёмки</p>
            )
          )}
          <p className="text-zinc-600 text-[11px]">
            Не входит в длительность и стоимость основной съёмки. Максимум — {MAKEUP_DURATION_MAX_MINUTES / 60} часов.
          </p>

          <p className={SECTION}>Клиент</p>
          {hasClient ? (
            <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center justify-between gap-3">
              <p className="text-zinc-200 text-sm truncate">{clientName}</p>
              <div className="flex items-center gap-3 flex-shrink-0">
                <Link href={`/admin/clients/${clientId}`} className="text-xs text-[#00c26b] hover:underline">
                  Открыть карточку
                </Link>
                {!annotation?.subscriptionUsage && (
                  <button type="button" onClick={() => { setClientId(null); setClientName(null); runClientSearch() }}
                    className="text-xs text-zinc-400 hover:text-white underline">
                    Изменить
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {searchingClient && <p className="text-zinc-500 text-xs">Ищем клиента по названию записи...</p>}

              {!searchingClient && similarMatches && similarMatches.length > 0 && (
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
                  {similarMatches.length === 1 ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-zinc-300 text-xs">
                        Возможный клиент: <span className="text-zinc-100 font-medium">{similarMatches[0].name}</span>
                      </p>
                      <button type="button" onClick={() => handleLinkClient(similarMatches[0].id, similarMatches[0].name)} disabled={linking}
                        className="text-xs text-[#00c26b] hover:underline disabled:opacity-50 flex-shrink-0 whitespace-nowrap">
                        Привязать
                      </button>
                    </div>
                  ) : (
                    <div>
                      <label className={LABEL}>Похожие клиенты — выберите</label>
                      <div className="flex items-center gap-2">
                        <select className={SELECT} value={selectedMatchId} onChange={e => setSelectedMatchId(e.target.value)}>
                          <option value="">Выберите клиента</option>
                          {similarMatches.map(m => (
                            <option key={m.id} value={m.id}>{m.name}{m.phone ? ` · ${m.phone}` : ''}</option>
                          ))}
                        </select>
                        <button type="button" disabled={linking || !selectedMatchId} className="text-xs text-[#00c26b] hover:underline disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
                          onClick={() => {
                            const m = similarMatches.find(x => x.id === selectedMatchId)
                            if (m) handleLinkClient(m.id, m.name)
                          }}>
                          Привязать
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {linkError && <p className="text-red-400 text-xs">{linkError}</p>}

              <div>
                <label className={LABEL}>Имя из календаря</label>
                <div className="flex items-center gap-2">
                  <input className={INPUT} placeholder="Как записано в календаре" value={clientNameRaw}
                    onChange={e => setClientNameRaw(e.target.value)} />
                  <button type="button" onClick={runClientSearch} disabled={searchingClient}
                    className="flex-shrink-0 text-xs text-zinc-400 hover:text-white underline whitespace-nowrap disabled:opacity-50">
                    Искать
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Контакт</label>
                  <input className={INPUT} placeholder="Телефон / Telegram / email" value={contactRaw}
                    onChange={e => setContactRaw(e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>Компания</label>
                  <input className={INPUT} placeholder="Если известна" value={companyRaw}
                    onChange={e => setCompanyRaw(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col items-start gap-2">
                <button type="button" onClick={() => setAddClientOpen(true)}
                  className="inline-flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-xs px-3 py-2 rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00c26b]">
                  <UserPlus className="w-3.5 h-3.5" />
                  Создать нового клиента
                </button>
                {annotation?.clientConfirmationStatus === 'PENDING' ? (
                  <p className="text-amber-400 text-xs">Ожидает подтверждения в разделе «Клиенты»</p>
                ) : (
                  <button type="button" onClick={() => handleSave('PENDING')} disabled={saving || !clientNameRaw.trim()}
                    className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline disabled:opacity-40 disabled:no-underline">
                    Отметить как ожидает подтверждения
                  </button>
                )}
              </div>
            </>
          )}

          <p className={SECTION}>Оплата</p>
          {hasClient && clientId ? (
            <SubscriptionPaymentBlock
              ref={subscriptionRef}
              clientId={clientId}
              eventDurationHours={eventDurationHours}
              initialUsage={annotation?.subscriptionUsage ?? null}
              onModeChange={setPaymentMode}
              onValidityChange={setSubscriptionValid}
            />
          ) : (
            <p className="text-zinc-500 text-xs">Оплата через абонемент доступна после привязки клиента к записи.</p>
          )}
          {(!hasClient || paymentMode === 'ONE_TIME') && (
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className={LABEL}>Стоимость, ₽</label>
                <input className={INPUT} type="number" min="0" placeholder="напр. 15000" value={estimatedPrice}
                  onChange={e => setEstimatedPrice(e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>Способ оплаты</label>
                <select className={SELECT} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod | '')}>
                  <option value="">Не указан</option>
                  {ONE_TIME_PAYMENT_METHODS.map(m => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {paymentMissingNow && (
            isBookingPast ? (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-amber-950/40 border border-amber-900 text-amber-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>Оплата не указана.</p>
              </div>
            ) : (
              <p className="text-zinc-500 text-xs">Оплата будет проверяться после завершения записи.</p>
            )
          )}

          {isBookingPast && (
            <div>
              <label className={LABEL}>Монтаж</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingRequired(true)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    editingRequired === true ? 'bg-[#FACC15] text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                  }`}>
                  Монтаж требуется
                </button>
                <button type="button" onClick={() => setEditingRequired(false)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    editingRequired === false ? 'bg-[#00c26b] text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                  }`}>
                  Монтаж не требуется
                </button>
              </div>
              <p className="text-zinc-500 text-xs mt-1.5">
                {editingRequired === null
                  ? 'Выберите, нужен ли монтаж, прежде чем прикладывать материалы — так администратор не забудет это сделать.'
                  : 'После сохранения заказ автоматически перейдёт в «Монтаж», если монтаж требуется, или в «Завершено», если монтаж не требуется.'}
              </p>
            </div>
          )}

          <p className={SECTION}>Материалы</p>
          {shouldShowMaterialsBadge(vm) && (
            <div className="flex items-center justify-between">
              <MaterialsStatusBadge status={materialsStatus} nasBackupUrl={annotation?.nasBackupUrl} size="md" showLabel />
            </div>
          )}

          {!isBookingPast ? (
            <p className="text-zinc-500 text-xs">Материалы ещё не добавлены — проверка начнётся после завершения записи.</p>
          ) : (
            <>
              {/* Ссылка на Яндекс.Диск сама по себе снимает предупреждение —
                  NAS-бэкап только дополнительный плюс, а не обязательное
                  условие (см. schedule-model.ts: getMaterialsDisplay/
                  getBookingAttentionInfo). Поэтому блока "hasYandexNow &&
                  !hasNasNow" здесь больше нет — это больше не проблема, это норма. */}
              {!hasNasNow && !hasYandexNow && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-red-950/40 border border-red-900 text-red-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>Съёмка уже прошла, но ссылка на Яндекс.Диск и бэкап на NAS не указаны.</p>
                </div>
              )}
              {hasNasNow && !hasYandexNow && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-amber-950/40 border border-amber-900 text-amber-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>Бэкап на NAS указан, но ссылка на Яндекс.Диск для клиента не добавлена.</p>
                </div>
              )}
              {hasNasNow && hasYandexNow && warningText && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-amber-950/40 border border-amber-900 text-amber-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>{warningText}</p>
                </div>
              )}
            </>
          )}

          <div>
            <label className={LABEL}>Ссылка на Яндекс.Диск</label>
            <div className="flex items-center gap-2">
              <input className={INPUT} placeholder="https://disk.yandex.ru/..." value={yandexDiskUrl}
                onChange={e => setYandexDiskUrl(e.target.value)} />
              {annotation?.yandexDiskUrl && (
                <>
                  <button type="button" onClick={() => copyLink(annotation.yandexDiskUrl!, 'yandex')}
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300" title="Скопировать ссылку">
                    {copiedField === 'yandex' ? <Check className="w-4 h-4 text-[#00c26b]" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a href={annotation.yandexDiskUrl} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300" title="Открыть в новой вкладке">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </>
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-zinc-500 text-xs">
                {yandexAddedAt && `Добавлена: ${format(yandexAddedAt, 'd MMM yyyy', { locale: ru })}`}
                {yandexExpiresAt && ` · Истекает: ${format(yandexExpiresAt, 'd MMM yyyy', { locale: ru })}`}
              </p>
              {/* Живая подсказка по формату — считается от того, что СЕЙЧАС
                  введено в поле, а не от того, что уже сохранено (раньше
                  здесь был YANDEX_LINK_STATUS_LABELS[yandexLinkStatus],
                  который отражал только сохранённое значение и не менялся,
                  пока набираешь новую ссылку). Только подсказка, никогда не
                  блокирует "Сохранить" — если ссылка не похожа на
                  Яндекс.Диск, это просто предупреждение, а не запрет. */}
              <span className={`text-xs ${
                !yandexUrlTrimmedLive ? 'text-zinc-500' : looksLikeYandexLink ? 'text-[#00c26b]' : 'text-amber-400'
              }`}>
                {!yandexUrlTrimmedLive
                  ? 'Ссылка не указана'
                  : looksLikeYandexLink
                    ? 'Ссылка указана'
                    : 'Не похоже на ссылку Яндекс.Диска — сохранить всё равно можно'}
              </span>
            </div>
          </div>

          <div>
            <label className={LABEL}>Ссылка на бэкап / NAS</label>
            <div className="flex items-center gap-2">
              <input className={INPUT} placeholder="\\\\nas\\... или https://..." value={nasBackupUrl}
                onChange={e => setNasBackupUrl(e.target.value)} />
              {annotation?.nasBackupUrl && (
                <button type="button" onClick={() => copyLink(annotation.nasBackupUrl!, 'nas')}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300" title="Скопировать ссылку">
                  {copiedField === 'nas' ? <Check className="w-4 h-4 text-[#00c26b]" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
            </div>
            <div className="flex items-center justify-end mt-1.5">
              <span className="text-xs text-zinc-400">{hasNasNow ? 'Бэкап указан' : 'Нет NAS-бэкапа'}</span>
            </div>
          </div>

          <div>
            <label className={LABEL}>Комментарий по материалам</label>
            <textarea className={`${INPUT} resize-none`} rows={2} value={materialsComment}
              onChange={e => setMaterialsComment(e.target.value)} />
          </div>
          </>
          )}

          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Причина блокировки "Сохранить" — вне скролл-области, всегда видна
            рядом с самой кнопкой. Без этого администратор, редактируя
            Материалы внизу формы, не видел бы, что кнопку заблокировал
            совсем другой, не прокрученный в этот момент раздел "Оплата". */}
        {subscriptionBlocksSave && (
          <p className="px-6 pt-3 text-amber-400 text-xs flex-shrink-0">
            Сохранение недоступно: в разделе «Оплата» выберите действующий абонемент или переключитесь на «Разовая оплата».
          </p>
        )}

        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button type="button" onClick={() => handleSave()} disabled={saving || subscriptionBlocksSave}
            className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" onClick={() => onOpenChange(false)}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
            Закрыть
          </button>
        </div>
      </DialogContent>
    </Dialog>
    {addClientOpen && (
      <AddClientModal
        open={addClientOpen}
        onOpenChange={setAddClientOpen}
        onSuccess={() => {}}
        initialValues={{
          firstName: guessedClientName,
          contactPerson: clientNameRaw.trim(),
          phone: contactRaw.trim(),
          companyName: companyRaw.trim(),
          source: 'OTHER',
          customSource: 'Google Calendar',
        }}
        onCreated={client => { setAddClientOpen(false); handleLinkClient(client.id, client.name) }}
      />
    )}
    </>
  )
}
