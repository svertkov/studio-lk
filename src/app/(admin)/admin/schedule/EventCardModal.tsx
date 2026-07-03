'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Copy, Check, ExternalLink, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { upsertScheduleEvent, findSimilarClientsForEvent, confirmScheduleClient, type SimilarClientMatch } from '@/lib/actions/schedule'
import { chargeEventToSubscription, createSubscription, removeEventSubscriptionCharge } from '@/lib/actions/subscriptions'
import { parseEventTitle } from '@/lib/event-category'
import type { ScheduleEventVM } from '@/lib/schedule-model'
import {
  computeYandexLinkStatus, YANDEX_LINK_STATUS_LABELS, MATERIALS_WARNING_TEXT,
  getEffectiveEventType, isPastBooking, shouldShowMaterialsBadge,
  type ClientConfirmationStatus,
} from '@/lib/schedule-model'
import { EVENT_TYPE_LABELS, type EventType } from '@/lib/event-type'
import { PAYMENT_METHOD_LABELS, ONE_TIME_PAYMENT_METHODS, type PaymentMethod } from '@/lib/schedule-model'
import { ROOM_DICTIONARY, FORMAT_DICTIONARY } from '@/lib/import/normalize'
import MaterialsStatusBadge from './MaterialsStatusBadge'
import SubscriptionPaymentBlock, { type SubscriptionPaymentHandle } from './SubscriptionPaymentBlock'
import AddClientModal from '../clients/AddClientModal'

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

  const [eventType, setEventType] = useState<EventType>(getEffectiveEventType(vm))
  const [room, setRoom] = useState(annotation?.room ?? '')
  const [formatValue, setFormatValue] = useState(annotation?.format ?? '')
  const [camerasCount, setCamerasCount] = useState(annotation?.camerasCount?.toString() ?? '')
  const [estimatedPrice, setEstimatedPrice] = useState(annotation?.estimatedPrice?.toString() ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(annotation?.paymentMethod ?? '')
  const [notes, setNotes] = useState(annotation?.notes ?? '')
  const [yandexDiskUrl, setYandexDiskUrl] = useState(annotation?.yandexDiskUrl ?? '')
  const [nasBackupUrl, setNasBackupUrl] = useState(annotation?.nasBackupUrl ?? '')
  const [materialsComment, setMaterialsComment] = useState(annotation?.materialsComment ?? '')
  const [clientNameRaw, setClientNameRaw] = useState(annotation?.clientNameRaw ?? '')
  const [contactRaw, setContactRaw] = useState(annotation?.contactRaw ?? '')
  const [companyRaw, setCompanyRaw] = useState(annotation?.companyRaw ?? '')

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
  const yandexLinkStatus = computeYandexLinkStatus(annotation?.yandexDiskUrl ?? null, yandexAddedAt)
  const warningText = MATERIALS_WARNING_TEXT[materialsStatus]
  const hasClient = !!clientId
  const eventDurationHours = Math.max(0, (new Date(calendarEvent.end).getTime() - new Date(calendarEvent.start).getTime()) / 3600000)
  const isBookingPast = isPastBooking(vm)
  // NAS и Яндекс.Диск проверяются раздельно (NAS важнее) — см. Материалы ниже
  const hasYandexNow = !!yandexDiskUrl
  const hasNasNow = !!nasBackupUrl
  const paymentMissingNow = paymentMode === 'ONE_TIME' && !estimatedPrice

  // Лучшая догадка об имени клиента: то, что вручную ввели в "Имя из
  // календаря", иначе — разбор названия/описания события Google Calendar
  // (например «Подкаст, тз, 3к, Соломатин» → «Соломатин»).
  const guessedClientName = clientNameRaw.trim() || parseEventTitle(calendarEvent.title, calendarEvent.description).client || ''

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
      clientNameRaw,
      contactRaw,
      companyRaw,
      ...(confirmationOverride && { clientConfirmationStatus: confirmationOverride }),
    })
    if (!result.ok) {
      setSaving(false)
      setError(result.error)
      return
    }

    if (eventType === 'STUDIO_BOOKING' && clientId) {
      if (paymentMode === 'ONE_TIME') {
        if (annotation?.subscriptionUsage) {
          const removed = await removeEventSubscriptionCharge(result.data.id)
          if (!removed.ok) { setSaving(false); setError(removed.error); return }
        }
      } else {
        const value = subscriptionRef.current?.getValue()
        if (value?.paymentType === 'EXISTING') {
          const charged = await chargeEventToSubscription({
            scheduleEventId: result.data.id, subscriptionId: value.subscriptionId, usedHours: value.usedHours,
          })
          if (!charged.ok) { setSaving(false); setError(charged.error); return }
        } else if (value?.paymentType === 'NEW') {
          const created = await createSubscription({
            clientId, packageHours: value.packageHours, paidAmount: value.paidAmount, purchasedAt: value.purchasedAt,
          })
          if (!created.ok) { setSaving(false); setError(created.error); return }
          const charged = await chargeEventToSubscription({
            scheduleEventId: result.data.id, subscriptionId: created.data.id, usedHours: value.usedHours,
          })
          if (!charged.ok) { setSaving(false); setError(charged.error); return }
        }
      }
    }

    setSaving(false)
    onSaved()
    onOpenChange(false)
  }

  return (
    <>
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl max-h-[88vh] flex flex-col p-0">
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
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => setAddClientOpen(true)}
                  className="text-xs text-zinc-400 hover:text-white underline">
                  Создать нового клиента
                </button>
                {annotation?.clientConfirmationStatus === 'PENDING' ? (
                  <p className="text-amber-400 text-xs">Ожидает подтверждения в разделе «Клиенты»</p>
                ) : (
                  <button type="button" onClick={() => handleSave('PENDING')} disabled={saving || !clientNameRaw.trim()}
                    className="text-xs text-[#00c26b] hover:underline disabled:opacity-40 disabled:no-underline">
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
              {!hasNasNow && !hasYandexNow && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-red-950/40 border border-red-900 text-red-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>Съёмка уже прошла, но ссылка на Яндекс.Диск и бэкап на NAS не указаны.</p>
                </div>
              )}
              {!hasNasNow && hasYandexNow && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-red-950/40 border border-red-900 text-red-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>Съёмка уже прошла, но бэкап на NAS не указан. Это критично для сохранности материалов.</p>
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
              <span className="text-xs text-zinc-400">{YANDEX_LINK_STATUS_LABELS[yandexLinkStatus]}</span>
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

        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button type="button" onClick={() => handleSave()} disabled={saving || (eventType === 'STUDIO_BOOKING' && hasClient && paymentMode === 'SUBSCRIPTION' && !subscriptionValid)}
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
