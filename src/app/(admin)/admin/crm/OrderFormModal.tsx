'use client'

import { useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Search, Link2, UserPlus, ChevronDown, ArchiveRestore, HardDrive } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import GlowPill from '@/components/ui/glow-pill'
import { createOrder, updateOrder, updateOrderStatus, unarchiveOrder, type OrderDTO, type OrderInput } from '@/lib/actions/orders'
import { getClients } from '@/lib/actions/clients'
import { findSimilarClientsForEvent, type SimilarClientMatch } from '@/lib/actions/schedule'
import { chargeEventToSubscription, createSubscription, removeEventSubscriptionCharge } from '@/lib/actions/subscriptions'
import { ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, ORDER_PAYMENT_STATUS_LABELS, ORDER_PAYMENT_METHOD_LABELS, ARCHIVE_REASON_LABELS } from '@/lib/order-model'
import { CLIENT_TYPE_LABELS } from '@/lib/client-model'
import { ROOM_DICTIONARY, FORMAT_DICTIONARY } from '@/lib/import/normalize'
import { EVENT_TYPE_LABELS, type EventType } from '@/lib/event-type'
import {
  MAKEUP_QUICK_OPTIONS, MAKEUP_DURATION_MAX_MINUTES, normalizeMakeupDurationMinutes, computeMakeupInterval, formatMakeupRange,
} from '@/lib/schedule-model'
import { getOrderPromotion, getVisibleOrderComment, PROMOTION_PILL_LABEL, type OrderPromotionType } from '@/lib/promotion-model'
import type { ClientType, OrderStatus, OrderPaymentStatus, PaymentMethod } from '@prisma/client'
import AddClientModal from '../clients/AddClientModal'
import WorkDocumentsSection from '@/components/documents/WorkDocumentsSection'
import ConfirmableStatusToggle from '@/components/ui/confirmable-status-toggle'
import OrderFinanceBlock, { type OrderFinanceBlockHandle } from '@/components/orders/OrderFinanceBlock'
import MontageDisableChoiceDialog from '@/components/orders/MontageDisableChoiceDialog'
import SubscriptionPaymentBlock, { type SubscriptionPaymentHandle } from '../schedule/SubscriptionPaymentBlock'
import type { MontageProjectDTO } from '@/lib/actions/montage'
import { useAutosave, readAutosaveDraft, clearAutosaveDraft, type StoredDraft } from '@/lib/hooks/use-autosave'
import SaveStatusIndicator from '@/components/ui/save-status-indicator'

interface Props {
  order: OrderDTO | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  // Предзаполнение при создании нового заказа (например, из Telegram-диалога)
  // — тот же аддитивный паттерн, что у AddClientModal.initialValues. Не имеет
  // эффекта при редактировании существующего заказа (order уже не null).
  initialValues?: Partial<OrderInput>
  // Если задан — заказ при создании автоматически привязывается к этому
  // Telegram-диалогу (см. src/lib/actions/telegram.ts).
  telegramConversationId?: string
}

interface ClientOption {
  id: string
  name: string
  phone?: string | null
  companyName?: string | null
}

// Общая геометрия для инпутов и селектов в одной сетке: одинаковая высота
// (h-10), рамка и радиус — иначе нативный select рендерится не той же высоты,
// что input, и ряд "съезжает" (см. FIELD_BASE/INPUT/SELECT ниже).
const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const SELECT = `${FIELD_BASE} pl-3 pr-9 text-zinc-200 cursor-pointer appearance-none`
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none'
const LABEL = 'block text-zinc-400 text-xs'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

// Единая структура "поле": лейбл сверху, контрол снизу, фиксированный зазор
// между ними — вместо margin на отдельных лейблах/инпутах по всей форме.
function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}

// Единая структура "строка из двух полей": на десктопе 2 колонки, на узких
// экранах складывается в одну — без ручных отступов на отдельных полях.
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}

function Label({ children }: { children: ReactNode }) {
  return <label className={LABEL}>{children}</label>
}

// select с appearance-none + своя стрелка — чтобы высота и позиция control
// всегда совпадали с input рядом (нативный select иначе рисует свою высоту).
function SelectField({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={SELECT}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
    </div>
  )
}

function splitDateTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = parseISO(iso)
  return { date: format(d, 'yyyy-MM-dd'), time: format(d, 'HH:mm') }
}

function combineDateTime(date: string, time: string): string | null {
  if (!date || !time) return null
  const d = new Date(`${date}T${time}:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export default function OrderFormModal({ order, onOpenChange, onSaved, initialValues, telegramConversationId }: Props) {
  const isEdit = !!order
  const startSplit = splitDateTime(order?.plannedStartTime ?? initialValues?.plannedStartTime ?? null)
  const endSplit = splitDateTime(order?.plannedEndTime ?? initialValues?.plannedEndTime ?? null)

  const [clientId, setClientId] = useState<string | null>(order?.clientId ?? initialValues?.clientId ?? null)
  const [clientName, setClientName] = useState(order?.clientName ?? initialValues?.clientName ?? '')
  const [clientPhone, setClientPhone] = useState(order?.clientPhone ?? initialValues?.clientPhone ?? '')
  const [clientTelegram, setClientTelegram] = useState(order?.clientTelegram ?? initialValues?.clientTelegram ?? '')
  const [clientEmail, setClientEmail] = useState(order?.clientEmail ?? initialValues?.clientEmail ?? '')
  const [clientType, setClientType] = useState<ClientType | ''>(order?.clientType ?? initialValues?.clientType ?? '')
  const [companyName, setCompanyName] = useState(order?.companyName ?? initialValues?.companyName ?? '')
  const [serviceType, setServiceType] = useState(order?.serviceType ?? initialValues?.serviceType ?? '')
  const [room, setRoom] = useState(order?.room ?? initialValues?.room ?? '')
  // Тип события — источник правды на ScheduleEvent (см. OrderDTO.eventType,
  // AGENTS.md/ORDERS.md "Типы события"), не гейтится наличием брони: акцию и
  // тип события можно отметить и на заявке без даты (тот же принцип, что у
  // promotionType ниже).
  const [eventType, setEventType] = useState<EventType>(order?.eventType ?? 'STUDIO_BOOKING')
  // Блок "Выезд" — только для eventType=OFFSITE_SHOOT, живёт только на
  // ScheduleEvent (см. schema.prisma, комментарий у ScheduleEvent.shootAddress).
  const [shootAddress, setShootAddress] = useState(order?.shootAddress ?? '')
  const [venueName, setVenueName] = useState(order?.venueName ?? '')
  const [venueContact, setVenueContact] = useState(order?.venueContact ?? '')
  const [logisticsComment, setLogisticsComment] = useState(order?.logisticsComment ?? '')
  // Комментарий инициализируется уже очищенным от текста акции (см.
  // src/lib/promotion-model.ts) — акция теперь отдельный тоггл (promotionType),
  // не часть свободного текста. Для старых заказов, где акция ещё жила только
  // как фраза в комментарии, это на первом же Save "мигрирует" её в
  // структурированное поле и одновременно убирает дублирующий текст.
  const [comment, setComment] = useState(
    getVisibleOrderComment({ comment: order?.comment ?? initialValues?.comment ?? null }) ?? ''
  )
  const [promotionType, setPromotionType] = useState<OrderPromotionType | null>(
    getOrderPromotion({ promotionType: order?.promotionType ?? null, comment: order?.comment ?? initialValues?.comment ?? null }),
  )
  const [preliminaryAmount, setPreliminaryAmount] = useState(
    order?.preliminaryAmount?.toString() ?? initialValues?.preliminaryAmount?.toString() ?? ''
  )
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(order?.paymentMethod ?? initialValues?.paymentMethod ?? '')
  const [paymentStatus, setPaymentStatus] = useState<OrderPaymentStatus>(
    order?.paymentStatus ?? initialValues?.paymentStatus ?? 'NOT_SPECIFIED'
  )
  // Оплата абонементом — редактируется прямо здесь через SubscriptionPaymentBlock
  // (2026-08-02: перенесено из EventCardModal, тот же компонент — не вторая
  // независимая реализация, см. AGENTS.md, правило 11). Доступна только когда
  // есть клиент и есть (или появится этим же сохранением) запись в расписании
  // — структурно необходим scheduleEventId, см. SubscriptionUsage в схеме.
  const [paymentMode, setPaymentMode] = useState<'ONE_TIME' | 'SUBSCRIPTION'>(
    order?.subscriptionUsage ? 'SUBSCRIPTION' : 'ONE_TIME',
  )
  const [subscriptionValid, setSubscriptionValid] = useState(true)
  const subscriptionRef = useRef<SubscriptionPaymentHandle>(null)
  const [status, setStatus] = useState<OrderStatus>(order?.status ?? 'LEAD')

  // Материалы/гримёр/монтаж — есть чему их редактировать только когда у
  // заказа уже есть (или появится этим же сохранением) своя запись в
  // расписании (см. willHaveBooking ниже): источник правды на ScheduleEvent,
  // см. комментарий у OrderDTO.yandexDiskUrl.
  // Гримёр — длительность хранится строкой + единицей измерения только для
  // удобства ручного ввода; при сохранении всегда уходят целые минуты через
  // normalizeMakeupDurationMinutes (тот же приём, что в EventCardModal).
  const [makeupDurationInput, setMakeupDurationInput] = useState(
    order?.makeupDurationMinutes != null ? String(order.makeupDurationMinutes) : '',
  )
  const [makeupDurationUnit, setMakeupDurationUnit] = useState<'minutes' | 'hours'>('minutes')
  const [editingRequired, setEditingRequired] = useState<'' | 'true' | 'false'>(
    order?.editingRequired === true ? 'true' : order?.editingRequired === false ? 'false' : ''
  )
  // activeMontageProjects заполняется самим OrderFinanceBlock (единственное
  // место, что реально загружает проекты монтажа заказа) — переиспользуем
  // для диалога отключения монтажа, не делаем второй такой же запрос.
  // "Прибыль по заказу" и "Комментарий к прибыли" редактируются и
  // сохраняются САМИМ OrderFinanceBlock напрямую через updateOrderProfit —
  // не часть этой формы/handleSave, поэтому здесь для них нет локального
  // состояния — только ref для явной досылки уже введённых значений сразу
  // после createOrder (см. handleSave, тот же приём, что и в EventCardModal).
  const [activeMontageProjects, setActiveMontageProjects] = useState<MontageProjectDTO[]>([])
  const financeBlockRef = useRef<OrderFinanceBlockHandle>(null)
  const [montageDisableDialogOpen, setMontageDisableDialogOpen] = useState(false)
  const [pendingEditingRequired, setPendingEditingRequired] = useState<'' | 'true' | 'false' | null>(null)
  const [yandexDiskUrl, setYandexDiskUrl] = useState(order?.yandexDiskUrl ?? '')
  const [nasBackupUrl, setNasBackupUrl] = useState(order?.nasBackupUrl ?? '')
  const [materialsComment, setMaterialsComment] = useState(order?.materialsComment ?? '')
  const [yandexLinkRequired, setYandexLinkRequired] = useState(order?.yandexLinkRequired ?? true)
  const [nasLinkRequired, setNasLinkRequired] = useState(order?.nasLinkRequired ?? true)
  const [yandexNotRequiredReason, setYandexNotRequiredReason] = useState<string | null>(order?.yandexNotRequiredReason ?? null)
  const [nasNotRequiredReason, setNasNotRequiredReason] = useState<string | null>(order?.nasNotRequiredReason ?? null)

  const [date, setDate] = useState(startSplit.date)
  const [startTime, setStartTime] = useState(startSplit.time)
  const [endTime, setEndTime] = useState(endSplit.time)

  // Единое условие "у заказа есть или появится этим же сохранением своя
  // запись в расписании" — заменяет прежнее "isEdit && order?.hasBooking",
  // которое при СОЗДАНИИ заказа скрывало материалы/монтаж/тип события даже
  // если дата/время уже заполнены в этой же форме. Ровно то же условие,
  // что сервер использует для решения "создавать ли ScheduleEvent" (см.
  // hasBookingTime в createOrder, src/lib/actions/orders.ts).
  const willHaveBooking = isEdit ? !!order!.hasBooking : !!(date && startTime && endTime)

  // Оплата абонементом показывается только когда есть клиент и запись — та же
  // связка условий, что в EventCardModal (hasClient && requiresFullBookingForm).
  // Для isEdit willHaveBooking завязан на order.hasBooking (уже сохранённый
  // факт) — значит order.scheduleEventId здесь гарантированно не null, когда
  // это условие истинно (см. handleSave, где этот id и используется).
  const payingBySubscription = willHaveBooking && !!clientId && paymentMode === 'SUBSCRIPTION'
  const subscriptionBlocksSave = willHaveBooking && !!clientId && paymentMode === 'SUBSCRIPTION' && !subscriptionValid
  const eventDurationHours = Math.max(0, (() => {
    const start = combineDateTime(date, startTime)
    const end = combineDateTime(date, endTime)
    return start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 3600000 : 0
  })())

  const makeupDurationMinutes = normalizeMakeupDurationMinutes(makeupDurationInput, makeupDurationUnit)
  const makeupShootStart = combineDateTime(date, startTime)
  const makeupInterval = computeMakeupInterval(makeupShootStart ? new Date(makeupShootStart) : null, makeupDurationMinutes)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ClientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [addClientOpen, setAddClientOpen] = useState(false)

  // Проактивный подбор существующего клиента — тот же поиск, что уже
  // используется в EventCardModal (findSimilarClientsForEvent), просто
  // питается уже существующими раздельными полями этой формы (clientPhone/
  // clientTelegram/clientEmail) вместо одного сырого "contact". НЕ заменяет
  // ручной поиск выше (searchQuery/getClients) — это два взаимодополняющих
  // способа найти клиента (см. AGENTS.md, правило 11: не вторая независимая
  // реализация, а то же действие "привязать клиента" другим путём входа),
  // а не два конкурирующих поиска.
  const [similarMatches, setSimilarMatches] = useState<SimilarClientMatch[] | null>(null)
  const [searchingSimilar, setSearchingSimilar] = useState(false)
  const [selectedMatchId, setSelectedMatchId] = useState('')

  async function runSimilarClientSearch() {
    const contact = [clientPhone, clientTelegram, clientEmail].filter(v => v.trim()).join(' ')
    if (!clientName.trim() && !contact.trim() && !companyName.trim()) { setSimilarMatches([]); return }
    setSearchingSimilar(true)
    const result = await findSimilarClientsForEvent({
      name: clientName.trim() || undefined,
      contact: contact.trim() || undefined,
      company: companyName.trim() || undefined,
    })
    setSearchingSimilar(false)
    setSimilarMatches(result.ok ? result.data : [])
    setSelectedMatchId('')
  }

  // Автопоиск при открытии карточки существующей заявки без привязанного
  // клиента — то же условие, что и у ручного триггера ниже, но без
  // synchronous setState в теле эффекта (см. память проекта). Не запускается
  // повторно при каждой правке полей — для этого есть кнопка "Искать".
  useEffect(() => {
    if (clientId) return
    const contact = [clientPhone, clientTelegram, clientEmail].filter(v => v.trim()).join(' ')
    if (!clientName.trim() && !contact.trim() && !companyName.trim()) return
    let cancelled = false
    findSimilarClientsForEvent({
      name: clientName.trim() || undefined,
      contact: contact.trim() || undefined,
      company: companyName.trim() || undefined,
    }).then(result => {
      if (!cancelled) setSimilarMatches(result.ok ? result.data : [])
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unarchiving, setUnarchiving] = useState(false)

  async function handleUnarchive() {
    if (!order) return
    setUnarchiving(true)
    setError(null)
    const result = await unarchiveOrder(order.id)
    setUnarchiving(false)
    if (!result.ok) { setError(result.error); return }
    onSaved()
    onOpenChange(false)
  }

  async function handleClientSearch(value: string) {
    setSearchQuery(value)
    if (value.trim().length < 2) { setSearchResults([]); return }
    setSearching(true)
    const res = await getClients({ search: value.trim() })
    setSearching(false)
    if (res.ok) setSearchResults(res.data.filter((c: ClientOption) => c.id !== clientId).slice(0, 8))
  }

  function selectClient(c: ClientOption) {
    setClientId(c.id)
    setClientName(c.name)
    if (c.phone) setClientPhone(c.phone)
    if (c.companyName) setCompanyName(c.companyName)
    setSearchQuery('')
    setSearchResults([])
    setSimilarMatches(null)
  }

  function unlinkClient() {
    setClientId(null)
    setSimilarMatches(null)
  }

  // Отключение "Монтаж требуется" при уже существующем проекте монтажа —
  // раньше проект просто зависал без предупреждения (см. план). Перехватываем
  // переход true -> не true, если есть непогашенный проект.
  function handleEditingRequiredChange(next: '' | 'true' | 'false') {
    if (editingRequired === 'true' && next !== 'true' && activeMontageProjects.length > 0) {
      setPendingEditingRequired(next)
      setMontageDisableDialogOpen(true)
      return
    }
    setEditingRequired(next)
  }

  // Единая точка построения OrderInput — используется и явным "Сохранить", и
  // автосохранением (см. useAutosave ниже), чтобы не держать два разных
  // способа собрать один и тот же payload.
  function buildOrderInput(): OrderInput {
    return {
      title: clientName.trim() || undefined,
      clientId,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientTelegram: clientTelegram.trim(),
      clientEmail: clientEmail.trim(),
      clientType: clientType || null,
      companyName: companyName.trim(),
      serviceType: serviceType.trim(),
      room: room.trim(),
      comment: comment.trim(),
      promotionType,
      ...(payingBySubscription ? {} : {
        preliminaryAmount: preliminaryAmount ? parseFloat(preliminaryAmount) : null,
        paymentMethod: paymentMethod || null,
        paymentStatus,
      }),
      plannedStartTime: combineDateTime(date, startTime),
      plannedEndTime: combineDateTime(date, endTime),
      ...(telegramConversationId ? { telegramConversationId } : {}),
      // Тип события и поля выезда не гейтятся willHaveBooking — как и акция,
      // их можно отметить и на заявке без даты; сервер применяет их только
      // если действительно создаёт/обновляет ScheduleEvent (см. createOrder/
      // updateOrder, hasBookingTime).
      eventType,
      shootAddress: shootAddress.trim(),
      venueName: venueName.trim(),
      venueContact: venueContact.trim(),
      logisticsComment: logisticsComment.trim(),
      // Материалы/гримёр/монтаж применяются только когда секция реально
      // видна — см. willHaveBooking и условие рендера ниже.
      ...(willHaveBooking ? {
        makeupDurationMinutes,
        editingRequired: editingRequired === '' ? null : editingRequired === 'true',
        yandexDiskUrl: yandexDiskUrl.trim(),
        nasBackupUrl: nasBackupUrl.trim(),
        materialsComment: materialsComment.trim(),
        yandexLinkRequired,
        nasLinkRequired,
        yandexNotRequiredReason,
        nasNotRequiredReason,
      } : {}),
    }
  }

  // Автосохранение — пишет прямо в реальную запись заказа (updateOrder), без
  // отдельной "черновик"-сущности. Только для уже существующих заказов: для
  // совсем нового заказа (ещё нет id) периодическое автосохранение намеренно
  // не включаем — иначе каждый тик дебаунса создавал бы новый заказ повторно
  // (isEdit статичен на весь срок жизни модалки, а createOrder не идемпотентен).
  // Локальная резервная копия в этом случае тоже не пишется — риск (потерять
  // недозаполненную ещё не начатую заявку при краше) намного меньше, чем у
  // потери правок уже открытого существующего заказа, на которую и рассчитан
  // этот механизм.
  const storageKey = order?.id ? `studio-lk:autosave:order:${order.id}` : null
  const autosave = useAutosave<OrderInput>({
    value: buildOrderInput(),
    onSave: async input => {
      if (!isEdit) return { ok: true }
      const result = await updateOrder(order!.id, input)
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
    enabled: isEdit && !saving,
    storageKey,
  })

  const [draftBanner, setDraftBanner] = useState<StoredDraft<OrderInput> | null>(null)

  // Проверка черновика — один раз при открытии карточки. setState отложен
  // через setTimeout(…, 0) — react-hooks/set-state-in-effect (см. память проекта).
  useEffect(() => {
    if (!storageKey) return
    const timer = setTimeout(() => {
      const draft = readAutosaveDraft<OrderInput>(storageKey)
      if (draft && (!order || new Date(draft.updatedAt) > new Date(order.updatedAt))) {
        setDraftBanner(draft)
      }
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  function applyDraft(input: OrderInput) {
    if (input.clientId !== undefined) setClientId(input.clientId ?? null)
    if (input.clientName !== undefined) setClientName(input.clientName ?? '')
    if (input.clientPhone !== undefined) setClientPhone(input.clientPhone ?? '')
    if (input.clientTelegram !== undefined) setClientTelegram(input.clientTelegram ?? '')
    if (input.clientEmail !== undefined) setClientEmail(input.clientEmail ?? '')
    if (input.clientType !== undefined) setClientType(input.clientType ?? '')
    if (input.companyName !== undefined) setCompanyName(input.companyName ?? '')
    if (input.serviceType !== undefined) setServiceType(input.serviceType ?? '')
    if (input.room !== undefined) setRoom(input.room ?? '')
    if (input.comment !== undefined) setComment(input.comment ?? '')
    if (input.promotionType !== undefined) setPromotionType(input.promotionType ?? null)
    if (input.preliminaryAmount !== undefined) setPreliminaryAmount(input.preliminaryAmount != null ? String(input.preliminaryAmount) : '')
    if (input.paymentMethod !== undefined) setPaymentMethod(input.paymentMethod ?? '')
    if (input.paymentStatus !== undefined) setPaymentStatus(input.paymentStatus ?? 'NOT_SPECIFIED')
    if (input.eventType !== undefined) setEventType(input.eventType ?? 'STUDIO_BOOKING')
    if (input.shootAddress !== undefined) setShootAddress(input.shootAddress ?? '')
    if (input.venueName !== undefined) setVenueName(input.venueName ?? '')
    if (input.venueContact !== undefined) setVenueContact(input.venueContact ?? '')
    if (input.logisticsComment !== undefined) setLogisticsComment(input.logisticsComment ?? '')
    if (input.makeupDurationMinutes !== undefined) { setMakeupDurationInput(input.makeupDurationMinutes != null ? String(input.makeupDurationMinutes) : ''); setMakeupDurationUnit('minutes') }
    if (input.editingRequired !== undefined) setEditingRequired(input.editingRequired === null || input.editingRequired === undefined ? '' : input.editingRequired ? 'true' : 'false')
    if (input.yandexDiskUrl !== undefined) setYandexDiskUrl(input.yandexDiskUrl ?? '')
    if (input.nasBackupUrl !== undefined) setNasBackupUrl(input.nasBackupUrl ?? '')
    if (input.materialsComment !== undefined) setMaterialsComment(input.materialsComment ?? '')
  }

  async function handleSave() {
    if (!clientId && !clientName.trim()) {
      setError('Укажите имя клиента или название заявки')
      return
    }
    setSaving(true)
    setError(null)

    // Id записи расписания для списания/снятия абонемента — после этой же
    // функции определяем его либо из уже известного order.scheduleEventId
    // (isEdit: willHaveBooking требует order.hasBooking, значит id уже есть
    // до сохранения), либо из ответа createOrder (только что созданная запись).
    let scheduleEventIdForCharge: string | null = isEdit ? order!.scheduleEventId : null

    if (isEdit) {
      const result = await autosave.flush()
      if (!result.ok) {
        setSaving(false)
        setError(result.error)
        return
      }
    } else {
      const result = await createOrder(buildOrderInput())
      if (!result.ok) {
        setSaving(false)
        setError(result.error)
        return
      }
      scheduleEventIdForCharge = result.data.scheduleEventId
      // Заказ только что создан этим сохранением — если администратор уже
      // успел ввести прибыль/комментарий к ней (заказа тогда ещё не было,
      // OrderFinanceBlock не мог их сохранить), досылаем прямо сейчас, пока
      // карточка не закрылась ниже (см. OrderFinanceBlockHandle).
      await financeBlockRef.current?.flushToOrder(result.data.id)
    }

    if (isEdit && status !== order!.status) {
      const statusResult = await updateOrderStatus(order!.id, status)
      if (!statusResult.ok) {
        setSaving(false)
        setError(statusResult.error)
        return
      }
    }

    // Абонемент — тот же перенос логики из EventCardModal.handleSave (2026-08-02):
    // списание/снятие/создание нового абонемента после того, как заказ и его
    // запись в расписании уже точно сохранены.
    if (willHaveBooking && clientId && scheduleEventIdForCharge) {
      if (paymentMode === 'ONE_TIME') {
        if (order?.subscriptionUsage) {
          const removed = await removeEventSubscriptionCharge(scheduleEventIdForCharge)
          if (!removed.ok) { setSaving(false); setError(removed.error); return }
        }
      } else {
        const value = subscriptionRef.current?.getValue()
        if (value?.paymentType === 'EXISTING') {
          const charged = await chargeEventToSubscription({
            scheduleEventId: scheduleEventIdForCharge, subscriptionId: value.subscriptionId, usedHours: value.usedHours,
          })
          if (!charged.ok) { setSaving(false); setError(charged.error); return }
        } else if (value?.paymentType === 'NEW') {
          const created = await createSubscription({
            clientId, packageHours: value.packageHours, paidAmount: value.paidAmount, purchasedAt: value.purchasedAt,
          })
          if (!created.ok) { setSaving(false); setError(created.error); return }
          const charged = await chargeEventToSubscription({
            scheduleEventId: scheduleEventIdForCharge, subscriptionId: created.data.id, usedHours: value.usedHours,
          })
          if (!charged.ok) { setSaving(false); setError(charged.error); return }
        }
      }
    }

    setSaving(false)
    onSaved()
    onOpenChange(false)
  }

  async function handleOpenClientCard() {
    await autosave.flush()
  }

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl sm:max-w-[min(1040px,94vw)] max-h-[88vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
            <DialogTitle className="text-white text-lg font-semibold">
              {isEdit ? 'Заказ' : 'Новый заказ'}
            </DialogTitle>
            {order?.isArchived && (
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">
                  В архиве
                </span>
                {order.archiveReason && (
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    order.archiveReason === 'COMPLETED'
                      ? 'bg-green-950/40 border border-green-800 text-green-400'
                      : 'bg-red-950/40 border border-red-900 text-red-300'
                  }`}>
                    {ARCHIVE_REASON_LABELS[order.archiveReason]}
                  </span>
                )}
              </div>
            )}
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
                  <button type="button" onClick={() => { if (storageKey) clearAutosaveDraft(storageKey); setDraftBanner(null) }}
                    className="text-zinc-400 underline hover:text-zinc-300">Отклонить</button>
                </div>
              </div>
            )}
            {isEdit && (
              <>
                <p className={SECTION}>Статус</p>
                <SelectField value={status} onChange={e => setStatus(e.target.value as OrderStatus)}>
                  {ORDER_BOARD_COLUMNS.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                </SelectField>
              </>
            )}

            <p className={SECTION}>Клиент</p>
            {clientId ? (
              <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center justify-between gap-3">
                <p className="text-zinc-200 text-sm truncate">{clientName || 'Без имени'}</p>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Link href={`/admin/clients/${clientId}`} onClick={handleOpenClientCard} className="text-xs text-[#00c26b] hover:underline">
                    Открыть карточку
                  </Link>
                  <button type="button" onClick={unlinkClient} className="text-xs text-zinc-400 hover:text-white underline">
                    Отвязать
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Field>
                  <Label>Имя клиента или название заявки *</Label>
                  <input className={INPUT} placeholder="Например, Сергей Соломатин" value={clientName}
                    onChange={e => setClientName(e.target.value)} />
                </Field>
                <Row>
                  <Field>
                    <Label>Телефон</Label>
                    <input className={INPUT} placeholder="+7..." value={clientPhone} onChange={e => setClientPhone(e.target.value)} />
                  </Field>
                  <Field>
                    <Label>Telegram</Label>
                    <input className={INPUT} placeholder="@username" value={clientTelegram} onChange={e => setClientTelegram(e.target.value)} />
                  </Field>
                </Row>
                <Row>
                  <Field>
                    <Label>Email</Label>
                    <input className={INPUT} placeholder="mail@example.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
                  </Field>
                  <Field>
                    <Label>Тип клиента</Label>
                    <SelectField value={clientType} onChange={e => setClientType(e.target.value as ClientType | '')}>
                      <option value="">Не указан</option>
                      {(Object.keys(CLIENT_TYPE_LABELS) as ClientType[]).map(t => (
                        <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>
                      ))}
                    </SelectField>
                  </Field>
                </Row>
                <Field>
                  <Label>Компания</Label>
                  <input className={INPUT} placeholder="Если известна" value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </Field>

                {/* Проактивный подбор — заполняется автоматически по уже
                    введённым выше полям (см. runSimilarClientSearch), не
                    требует отдельного запроса от администратора. Тот же
                    UX, что уже есть в EventCardModal (findSimilarClientsForEvent),
                    перенесён сюда как отдельный, дополняющий ручной поиск ниже
                    механизм — не замена. */}
                {searchingSimilar && <p className="text-zinc-500 text-xs">Ищем похожего клиента...</p>}
                {!searchingSimilar && similarMatches && similarMatches.length > 0 && (
                  <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
                    {similarMatches.length === 1 ? (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-zinc-300 text-xs">
                          Похожий клиент: <span className="text-zinc-100 font-medium">{similarMatches[0].name}</span>
                        </p>
                        <button type="button" onClick={() => selectClient({ id: similarMatches[0].id, name: similarMatches[0].name, phone: similarMatches[0].phone })}
                          className="text-xs text-[#00c26b] hover:underline flex-shrink-0 whitespace-nowrap">
                          Привязать
                        </button>
                      </div>
                    ) : (
                      <div>
                        <Label>Похожие клиенты — выберите</Label>
                        <div className="flex items-center gap-2 mt-1.5">
                          <SelectField value={selectedMatchId} onChange={e => setSelectedMatchId(e.target.value)}>
                            <option value="">Выберите клиента</option>
                            {similarMatches.map(m => (
                              <option key={m.id} value={m.id}>{m.name}{m.phone ? ` · ${m.phone}` : ''}</option>
                            ))}
                          </SelectField>
                          <button type="button" disabled={!selectedMatchId} className="text-xs text-[#00c26b] hover:underline disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
                            onClick={() => {
                              const m = similarMatches.find(x => x.id === selectedMatchId)
                              if (m) selectClient({ id: m.id, name: m.name, phone: m.phone })
                            }}>
                            Привязать
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Field>
                    <Label>Найти существующего клиента</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                      <input
                        value={searchQuery}
                        onChange={e => handleClientSearch(e.target.value)}
                        placeholder="Имя или телефон..."
                        className={`${INPUT} pl-9`}
                      />
                    </div>
                  </Field>
                  {searching && <p className="text-zinc-500 text-xs mt-1.5">Ищу...</p>}
                  {!searching && searchResults.length > 0 && (
                    <div className="mt-1.5 border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800">
                      {searchResults.map(c => (
                        <button key={c.id} type="button" onClick={() => selectClient(c)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-800/60 transition-colors">
                          <div className="min-w-0">
                            <p className="text-zinc-200 text-xs truncate">{c.name}</p>
                            <p className="text-zinc-500 text-[11px] truncate">{c.phone || c.companyName || '—'}</p>
                          </div>
                          <Link2 className="w-3.5 h-3.5 text-[#00c26b] flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <button type="button" onClick={async () => { await autosave.flush(); setAddClientOpen(true) }}
                      className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white underline">
                      <UserPlus className="w-3.5 h-3.5" />
                      Создать нового клиента
                    </button>
                    <button type="button" onClick={runSimilarClientSearch} disabled={searchingSimilar}
                      className="text-xs text-zinc-400 hover:text-white underline disabled:opacity-50">
                      Искать похожих по введённым данным
                    </button>
                  </div>
                </div>
              </>
            )}

            <p className={SECTION}>Услуга</p>
            <Field>
              <Label>Тип события</Label>
              <SelectField value={eventType} onChange={e => setEventType(e.target.value as EventType)}>
                {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map(t => (
                  <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
                ))}
              </SelectField>
            </Field>
            <Row>
              <Field>
                <Label>Формат</Label>
                <SelectField value={serviceType} onChange={e => setServiceType(e.target.value)}>
                  <option value="">Не указан</option>
                  {FORMAT_DICTIONARY.map(e => <option key={e.canonical} value={e.canonical}>{e.canonical}</option>)}
                </SelectField>
              </Field>
              <Field>
                <Label>Зал</Label>
                {eventType === 'OFFSITE_SHOOT' ? (
                  <p className="text-zinc-400 text-sm px-3 py-2">Локация: выездная</p>
                ) : (
                  <SelectField value={room} onChange={e => setRoom(e.target.value)}>
                    <option value="">Не указан</option>
                    {ROOM_DICTIONARY.map(e => <option key={e.canonical} value={e.canonical}>{e.canonical}</option>)}
                  </SelectField>
                )}
              </Field>
            </Row>
            <Field>
              <Label>Комментарий</Label>
              <textarea className={TEXTAREA} rows={2} value={comment} onChange={e => setComment(e.target.value)} />
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
            </Field>

            <p className={SECTION}>Запись в студию</p>
            <p className="text-zinc-500 text-xs -mt-2 mb-1">Можно оставить пустым — заказ останется заявкой.</p>
            <Field>
              <Label>Дата</Label>
              <input className={INPUT} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </Field>
            <Row>
              <Field>
                <Label>Время начала</Label>
                <input className={INPUT} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </Field>
              <Field>
                <Label>Время окончания</Label>
                <input className={INPUT} type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </Field>
            </Row>
            {willHaveBooking && (
              <p className="text-zinc-500 text-xs">
                {isEdit && order?.hasBooking
                  ? 'У заказа уже есть запись в расписании платформы — при изменении даты/времени она обновится.'
                  : 'После сохранения появится запись в расписании платформы.'}
              </p>
            )}

            {eventType === 'OFFSITE_SHOOT' && willHaveBooking && (
              <>
                <p className={SECTION}>Выезд</p>
                <Field>
                  <Label>Адрес съёмки</Label>
                  <input className={INPUT} placeholder="напр. ул. Ленина, 10" value={shootAddress}
                    onChange={e => setShootAddress(e.target.value)} />
                </Field>
                <Row>
                  <Field>
                    <Label>Площадка / локация</Label>
                    <input className={INPUT} value={venueName} onChange={e => setVenueName(e.target.value)} />
                  </Field>
                  <Field>
                    <Label>Контакт на площадке</Label>
                    <input className={INPUT} value={venueContact} onChange={e => setVenueContact(e.target.value)} />
                  </Field>
                </Row>
                <Field>
                  <Label>Комментарий по логистике</Label>
                  <textarea className={TEXTAREA} rows={2} value={logisticsComment} onChange={e => setLogisticsComment(e.target.value)} />
                </Field>
                {!shootAddress.trim() && (
                  <p className="bg-amber-950/40 border border-amber-900 text-amber-300 text-xs rounded-lg px-3 py-2">
                    Для выездной съёмки не указан адрес
                  </p>
                )}
              </>
            )}

            {willHaveBooking && (
              <>
                <p className={SECTION}>Материалы и монтаж</p>
                <Field>
                  <Label>Время на гримёра до съёмки</Label>
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
                </Field>
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
                <Field>
                  <Label>Монтаж</Label>
                  <SelectField value={editingRequired} onChange={e => handleEditingRequiredChange(e.target.value as '' | 'true' | 'false')}>
                    <option value="">Не указано</option>
                    <option value="true">Нужен</option>
                    <option value="false">Не нужен</option>
                  </SelectField>
                </Field>
                <Field>
                  <Label>Яндекс.Диск</Label>
                  <input
                    className={`${INPUT} ${!yandexLinkRequired ? 'border-red-800/60 bg-red-950/20 text-red-200/80' : ''}`}
                    placeholder={yandexLinkRequired ? 'https://disk.yandex.ru/...' : 'Материалы на Яндекс.Диске не предусмотрены'}
                    value={yandexDiskUrl}
                    readOnly={!yandexLinkRequired}
                    onChange={e => setYandexDiskUrl(e.target.value)}
                  />
                  {!yandexLinkRequired && yandexDiskUrl.trim() && (
                    <p className="text-amber-400/80 text-xs mt-1.5">
                      В поле уже указана ссылка. Она будет сохранена, но перестанет считаться обязательной.
                    </p>
                  )}
                  {!yandexLinkRequired && (
                    <p className="text-zinc-500 text-xs mt-1.5">
                      {order?.yandexNotRequiredConfirmedByName && order?.yandexNotRequiredConfirmedAt
                        ? `Подтверждено: ${order.yandexNotRequiredConfirmedByName}, ${format(parseISO(order.yandexNotRequiredConfirmedAt), 'd MMM yyyy, HH:mm')}`
                        : 'Подтверждено администратором'}
                    </p>
                  )}
                  <div className="mt-1.5">
                    <ConfirmableStatusToggle
                      active={!yandexLinkRequired}
                      onConfirm={reason => { setYandexLinkRequired(false); setYandexNotRequiredReason(reason) }}
                      onDeactivate={() => { setYandexLinkRequired(true); setYandexNotRequiredReason(null) }}
                      normalLabel="Яндекс.Диск обязателен"
                      exceptionLabel="Ссылка не требуется"
                      dialogTitle="Сохранить заказ без ссылки на Яндекс.Диск?"
                      dialogBody="После подтверждения система перестанет требовать ссылку на Яндекс.Диск для этого заказа. Клиентская ссылка на материалы может отсутствовать. Убедитесь, что это соответствует договорённости и материалы переданы или будут переданы другим способом."
                      escalatedNotice={!nasLinkRequired ? 'После этого у заказа не останется ни одной обязательной ссылки на материалы.' : undefined}
                      size="sm"
                    />
                  </div>
                </Field>
                <Field>
                  <Label>NAS</Label>
                  <input
                    className={`${INPUT} ${!nasLinkRequired ? 'border-red-800/60 bg-red-950/20 text-red-200/80' : ''}`}
                    placeholder={nasLinkRequired ? 'Ссылка на резервную копию' : 'Бэкап материалов на NAS отсутствует'}
                    value={nasBackupUrl}
                    readOnly={!nasLinkRequired}
                    onChange={e => setNasBackupUrl(e.target.value)}
                  />
                  {!nasLinkRequired && nasBackupUrl.trim() && (
                    <p className="text-amber-400/80 text-xs mt-1.5">
                      В поле уже указана ссылка. Она будет сохранена, но перестанет считаться обязательной.
                    </p>
                  )}
                  {!nasLinkRequired && (
                    <p className="text-zinc-500 text-xs mt-1.5">
                      {order?.nasNotRequiredConfirmedByName && order?.nasNotRequiredConfirmedAt
                        ? `Подтверждено: ${order.nasNotRequiredConfirmedByName}, ${format(parseISO(order.nasNotRequiredConfirmedAt), 'd MMM yyyy, HH:mm')}`
                        : 'Подтверждено администратором'}
                    </p>
                  )}
                  <div className="mt-1.5">
                    <ConfirmableStatusToggle
                      active={!nasLinkRequired}
                      onConfirm={reason => { setNasLinkRequired(false); setNasNotRequiredReason(reason) }}
                      onDeactivate={() => { setNasLinkRequired(true); setNasNotRequiredReason(null) }}
                      normalLabel="Бэкап на NAS требуется"
                      exceptionLabel="NAS не требуется"
                      dialogTitle="Сохранить заказ без бэкапа на NAS?"
                      dialogBody="После подтверждения система перестанет требовать NAS-ссылку для этого заказа. В платформе не будет подтверждения наличия долгосрочного бэкапа материалов. Убедитесь, что хранение действительно не требуется или организовано другим способом."
                      escalatedNotice={!yandexLinkRequired ? 'После этого у заказа не останется ни одной обязательной ссылки на материалы.' : undefined}
                      normalIcon={HardDrive}
                      size="sm"
                    />
                  </div>
                </Field>
                <Field>
                  <Label>Комментарий к материалам</Label>
                  <textarea className={TEXTAREA} rows={2} value={materialsComment} onChange={e => setMaterialsComment(e.target.value)} />
                </Field>
              </>
            )}

            <p className={SECTION}>Оплата</p>
            {willHaveBooking && clientId ? (
              <SubscriptionPaymentBlock
                ref={subscriptionRef}
                clientId={clientId}
                eventDurationHours={eventDurationHours}
                initialUsage={order?.subscriptionUsage ?? null}
                onModeChange={setPaymentMode}
                onValidityChange={setSubscriptionValid}
              />
            ) : willHaveBooking ? (
              <p className="text-zinc-500 text-xs">Оплата через абонемент доступна после привязки клиента к записи.</p>
            ) : null}
            {(!willHaveBooking || !clientId || paymentMode === 'ONE_TIME') && (
              <>
                <OrderFinanceBlock
                  ref={financeBlockRef}
                  orderId={order?.id ?? null}
                  revenueValue={preliminaryAmount}
                  onRevenueChange={setPreliminaryAmount}
                  editingRequired={editingRequired === '' ? null : editingRequired === 'true'}
                  onMontageProjectsLoaded={setActiveMontageProjects}
                />
                <Row>
                  <Field>
                    <Label>Способ оплаты</Label>
                    <SelectField value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod | '')}>
                      <option value="">Не указан</option>
                      {(Object.keys(ORDER_PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(m => (
                        <option key={m} value={m}>{ORDER_PAYMENT_METHOD_LABELS[m]}</option>
                      ))}
                    </SelectField>
                  </Field>
                  <Field>
                    <Label>Статус оплаты</Label>
                    <SelectField value={paymentStatus} onChange={e => setPaymentStatus(e.target.value as OrderPaymentStatus)}>
                      {(Object.keys(ORDER_PAYMENT_STATUS_LABELS) as OrderPaymentStatus[]).map(s => (
                        <option key={s} value={s}>{ORDER_PAYMENT_STATUS_LABELS[s]}</option>
                      ))}
                    </SelectField>
                  </Field>
                </Row>
              </>
            )}

            {order?.id && (
              <>
                <p className={SECTION}>Документы</p>
                <WorkDocumentsSection orderId={order.id} clientId={order.clientId} onBeforeEditRelated={() => autosave.flush()} />
              </>
            )}

            {error && (
              <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>

          {subscriptionBlocksSave && (
            <p className="px-6 pt-3 text-amber-400 text-xs flex-shrink-0">
              Сохранение недоступно: в разделе «Оплата» выберите действующий абонемент или переключитесь на «Разовая оплата».
            </p>
          )}

          <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
            {isEdit && <SaveStatusIndicator status={autosave.status} error={autosave.error} />}
            {order?.isArchived && (
              <button type="button" onClick={handleUnarchive} disabled={unarchiving}
                className="flex items-center gap-1.5 flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm px-3.5 py-2.5 rounded-lg transition-colors">
                <ArchiveRestore className="w-4 h-4" />
                {unarchiving ? 'Возвращаем...' : 'Вернуть из архива'}
              </button>
            )}
            <button type="button" onClick={handleSave} disabled={saving || subscriptionBlocksSave}
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

      {montageDisableDialogOpen && activeMontageProjects[0] && (
        <MontageDisableChoiceDialog
          open={montageDisableDialogOpen}
          onOpenChange={setMontageDisableDialogOpen}
          project={activeMontageProjects[0]}
          onResolve={() => { if (pendingEditingRequired !== null) setEditingRequired(pendingEditingRequired); setPendingEditingRequired(null) }}
        />
      )}

      {addClientOpen && (
        <AddClientModal
          open={addClientOpen}
          onOpenChange={setAddClientOpen}
          onSuccess={() => {}}
          initialValues={{
            firstName: clientName.trim(),
            contactPerson: clientName.trim(),
            phone: clientPhone.trim(),
            telegram: clientTelegram.trim(),
            email: clientEmail.trim(),
            companyName: companyName.trim(),
          }}
          onCreated={client => { setAddClientOpen(false); selectClient({ id: client.id, name: client.name }) }}
        />
      )}
    </>
  )
}
