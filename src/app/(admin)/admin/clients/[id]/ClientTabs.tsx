'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Film, DollarSign, FileText, Upload, Send, Calendar, Clock, Receipt,
  ExternalLink, Wallet, Cloud, CloudOff, Server,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import GlowPill from '@/components/ui/glow-pill'
import {
  CLIENT_TYPE_LABELS, CLIENT_STATUS_LABELS, CLIENT_SOURCE_LABELS,
} from '@/lib/client-model'
import { addClientNote } from '@/lib/actions/clients'
import type { ClientSubscriptionDTO } from '@/lib/actions/subscriptions'
import { getScheduleAnnotations } from '@/lib/actions/schedule'
import type { ShootRowDTO, ShootsSummaryOutDTO, FinanceOverviewOutDTO } from '@/lib/actions/client-shoots'
import {
  computeMaterialsCapsules, getVisibleShoots, getHiddenShootsCount, SHOOTS_TABLE_DEFAULT_LIMIT,
} from '@/lib/client-shoots-model'
import {
  SUBSCRIPTION_DISPLAY_STATUS_LABELS, SUBSCRIPTION_DISPLAY_STATUS_COLORS,
  SUBSCRIPTION_ARCHIVED_BADGE_LABEL, SUBSCRIPTION_ARCHIVED_BADGE_CLASS,
  getSubscriptionDisplayStatus,
} from '@/lib/subscription-model'
import { PAYMENT_METHOD_LABELS, mergeScheduleEvent, type ScheduleEventVM } from '@/lib/schedule-model'
import { isValidHttpUrl } from '@/lib/url'
import type { CalendarEvent } from '@/lib/google-calendar'
import DonutChart from '@/components/ui/donut-chart'
import MetricCard, { METRIC_GRID_CLASSNAME } from '@/components/ui/metric-card'
import EventCardModal from '../../schedule/EventCardModal'
import SubscriptionActionsMenu from '@/components/subscriptions/SubscriptionActionsMenu'
import SubscriptionDetailModal from '../../finance/subscriptions/SubscriptionDetailModal'

const CHART_COLORS = ['#00c26b', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6']
const LONG_COMMENT_THRESHOLD = 140

// Единая сетка колонок таблицы "История съёмок" — ОДНА и та же строка
// подставляется и в заголовок, и в каждую строку тела (ТЗ, часть 3: "Заголовок
// и строки должны использовать один и тот же шаблон колонок"). Обычная
// HTML-таблица с table-layout: fixed уже дважды давала расхождение между
// заявленной шириной колонки и тем, что реально показывал браузер, когда
// внутри ячейки были flex/line-clamp дети — CSS Grid с общим шаблоном для
// header/строк не оставляет для этого возможности в принципе.
// Фиксированные px-колонки в CSS Grid НЕ растут при наличии свободного места
// (в отличие от <table>) — поэтому ширины подобраны по факту самых длинных
// реальных значений (напр. "Говорящая голова", "Тёмный зал", по одной капсуле
// на колонку в "Материалы"/Backup), а не "на глаз", иначе они снова начинают
// обрезаться независимо от того, сколько места есть у самой таблицы.
const SHOOTS_GRID_COLS = 'grid-cols-[130px_130px_162px_64px_128px_150px_110px_minmax(180px,1fr)_44px]'
const SHOOTS_TABLE_MIN_WIDTH = 1095

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

// Компактный формат (напр. "8,5 тыс. ₽") — только для маленьких карточек-метрик,
// где точная сумма и так обрезалась бы CSS-многоточием при узкой колонке.
function formatMoneyCompact(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { notation: 'compact', style: 'currency', currency: 'RUB', maximumFractionDigits: 1 }).format(v)
}

function formatDate(v: string | Date | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTimeRange(startAt: string | null, endAt: string | null): string | null {
  if (!startAt || !endAt) return null
  const fmt = (v: string) => new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `${fmt(startAt)}–${fmt(endAt)}`
}

function formatHours(v: number | null) {
  if (v == null) return '—'
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} ч`
}

// Единое текстовое представление суммы съёмки — правила из ТЗ, часть 4:
// абонемент/бесплатно/не оплачено/нет данных — это состояния, а не 0 ₽.
function formatShootAmount(row: ShootRowDTO): string {
  switch (row.amount.kind) {
    case 'subscription': return `По абонементу${row.amount.subscriptionHours != null ? ` · ${row.amount.subscriptionHours} ч` : ''}`
    case 'free': return '0 ₽'
    case 'unpaid': return 'Не оплачено'
    case 'unknown': return 'Нет данных'
    case 'amount': return formatMoney(row.amount.amount)
  }
}

interface ClientNote {
  id: string
  text: string
  authorId: string | null
  createdAt: string | Date
}

interface ClientContact {
  id: string
  name?: string | null
  role?: string | null
  phone?: string | null
  telegram?: string | null
  email?: string | null
  comment?: string | null
}

interface ClientDoc {
  id: string
  fileName: string
  storageUrl: string
  type?: string | null
  createdAt: string | Date
}

interface PrismaClient {
  id: string
  name: string
  type: string
  status: string
  source?: string | null
  customSource?: string | null
  contactPerson?: string | null
  phone?: string | null
  telegram?: string | null
  email?: string | null
  companyName?: string | null
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legalAddress?: string | null
  documentComment?: string | null
  notes?: string | null
  createdAt: string | Date
  clientNotes: ClientNote[]
  contacts: ClientContact[]
  documents: ClientDoc[]
}

interface Props {
  client: PrismaClient
  subscriptions: ClientSubscriptionDTO[]
  shoots: ShootRowDTO[]
  shootsSummary: ShootsSummaryOutDTO
  financeOverview: FinanceOverviewOutDTO
}

const TABS = [
  { id: 'overview',   label: 'Обзор' },
  { id: 'sessions',   label: 'Съёмки' },
  { id: 'editing',    label: 'Монтаж' },
  { id: 'finance',    label: 'Финансы' },
  { id: 'documents',  label: 'Документы' },
  { id: 'notes',      label: 'Заметки' },
]

function PlaceholderTab({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
      <Icon className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
      <p className="text-zinc-300 font-medium">{title}</p>
      <p className="text-zinc-500 text-sm mt-1.5 max-w-sm mx-auto">{description}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className="text-zinc-200 text-sm">{value}</p>
    </div>
  )
}

// Комментарий может быть очень длинным (старые импортированные заметки) —
// по умолчанию режем до 2 строк по словам (line-clamp, не посимвольно) и
// даём кнопку "Показать полностью" вместо обрыва текста (ТЗ, часть 5/13).
// Тот же приглушённый вторичный текст (text-xs text-zinc-400/500), что и
// остальные некритичные данные таблицы — комментарий не "основное" значение.
function CommentCell({ comment }: { comment: string | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!comment) return <span className="text-zinc-600 text-xs">—</span>
  const isLong = comment.length > LONG_COMMENT_THRESHOLD
  return (
    <div className="min-w-0">
      <p className={`text-zinc-400 text-xs leading-snug whitespace-pre-wrap break-words ${!expanded && isLong ? 'line-clamp-2' : ''}`}>
        {comment}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          className="text-xs text-zinc-400 hover:text-white underline mt-0.5"
        >
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      )}
    </div>
  )
}

// Компактная сумма съёмки — двухстрочный вид для абонемента (ТЗ, часть 8):
// "Абонемент" — основное значение (text-sm, как остальные первичные данные
// строки), "2 ч" под ним — вторичное (text-xs text-zinc-500), тот же приём,
// что и время под датой в DateTimeCell.
function AmountCell({ row }: { row: ShootRowDTO }) {
  switch (row.amount.kind) {
    case 'subscription':
      return (
        <div className="leading-snug">
          <p className="text-zinc-200 text-sm">Абонемент</p>
          {row.amount.subscriptionHours != null && (
            <p className="text-zinc-500 text-xs">{formatHours(row.amount.subscriptionHours)}</p>
          )}
        </div>
      )
    case 'free':      return <span className="text-zinc-300 text-sm whitespace-nowrap">0 ₽</span>
    case 'unpaid':     return <span className="text-zinc-500 text-sm whitespace-nowrap">Не оплачено</span>
    case 'unknown':    return <span className="text-zinc-600 text-sm whitespace-nowrap">Нет данных</span>
    case 'amount':     return <span className="text-zinc-200 text-sm whitespace-nowrap">{formatMoney(row.amount.amount)}</span>
  }
}

function formatDayMonth(v: string | null): string | null {
  if (!v) return null
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

// Колонка "Материалы" (только Яндекс.Диск) — переиспользует общую плашку с
// glow (GlowPill, тот же приём, что и StaffAbsenceBadge в разделе
// "Расписание"), а не рисует свой вариант капсулы. Зелёный — активная ссылка,
// приглушённый zinc — истёкшая (не "предупреждение", а именно нейтральное
// "недоступно", поэтому не amber). Активность/срок жизни считаются чистой
// функцией computeMaterialsCapsules (client-shoots-model.ts) — здесь только рендер.
// NAS вынесен в отдельную колонку "Backup" (BackupCell ниже) — материалы и
// резервная копия больше не делят одну ячейку.
function MaterialsCell({ row }: { row: ShootRowDTO }) {
  const yandexUrl = isValidHttpUrl(row.yandexDiskUrl) ? row.yandexDiskUrl : null
  const state = computeMaterialsCapsules({
    yandexDiskUrl: yandexUrl,
    yandexDiskUrlExpiresAt: row.yandexDiskUrlExpiresAt ? new Date(row.yandexDiskUrlExpiresAt) : null,
    nasBackupUrl: null,
  })

  if (!state.yandex) {
    return <span className="text-zinc-600 text-xs">Нет материалов</span>
  }

  const expiresLabel = formatDayMonth(row.yandexDiskUrlExpiresAt)

  if (state.yandex === 'expired') {
    return (
      <GlowPill
        as="button"
        disabled
        color="zinc"
        icon={CloudOff}
        title={expiresLabel ? `Срок хранения истёк ${expiresLabel}` : 'Материалы удалены с Яндекс.Диска'}
        ariaLabel="Материалы на Яндекс.Диске недоступны — срок хранения истёк"
      >
        Яндекс.Диск
      </GlowPill>
    )
  }

  return (
    <GlowPill
      as="a"
      href={yandexUrl!}
      color="green"
      icon={Cloud}
      onClick={e => e.stopPropagation()}
      title={expiresLabel ? `Доступно до ${expiresLabel}` : 'Открыть материалы на Яндекс.Диске'}
      ariaLabel="Открыть материалы на Яндекс.Диске"
    >
      Яндекс.Диск
    </GlowPill>
  )
}

// Колонка "Backup" — плашка NAS, тот же общий GlowPill, фиолетовый смысловой
// вариант (ТЗ: "используй существующий фиолетовый variant общей системы
// плашек"). Автоистечения по времени у NAS нет (в отличие от Яндекс.Диска) —
// либо ссылка есть и плашка активна, либо её нет вовсе.
function BackupCell({ row }: { row: ShootRowDTO }) {
  const nasUrl = isValidHttpUrl(row.nasBackupUrl) ? row.nasBackupUrl : null
  if (!nasUrl) {
    return <span className="text-zinc-600 text-xs">Нет backup</span>
  }
  return (
    <GlowPill
      as="a"
      href={nasUrl}
      color="violet"
      icon={Server}
      onClick={e => e.stopPropagation()}
      title="Открыть резервную копию на NAS"
      ariaLabel="Открыть резервную копию на NAS"
    >
      NAS
    </GlowPill>
  )
}

// Как и в computeShootsSummary — только фактически состоявшиеся съёмки:
// без отменённых и без будущих (иначе "По залам"/"По форматам" считали бы
// часы съёмки, которая не входит в "Часов в студии" на этой же вкладке).
function groupHoursBy(rows: ShootRowDTO[], key: 'room' | 'format') {
  const groups = new Map<string, number>()
  let totalHours = 0
  for (const r of rows) {
    if (r.isCancelled || r.isFuture) continue
    const label = r[key]
    if (!label) continue
    const hours = r.durationHours ?? 0
    totalHours += hours
    groups.set(label, (groups.get(label) ?? 0) + hours)
  }
  if (totalHours <= 0) return []
  return Array.from(groups.entries())
    .map(([label, hours]) => ({ label, value: (hours / totalHours) * 100 }))
    .sort((a, b) => b.value - a.value)
}

export default function ClientTabs({ client, subscriptions, shoots, shootsSummary, financeOverview }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('overview')
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  // Карточка конкретной съёмки открывается прямо отсюда — переиспользует тот
  // же EventCardModal, что и раздел "Расписание". calendarEvent для него
  // строится из снэпшот-полей самой аннотации (у ScheduleEvent всегда есть
  // аннотация, если он вообще существует, см. schedule-model.ts) — с этой
  // страницы нет доступа к живому Google Calendar, а он и не нужен.
  const [openVm, setOpenVm] = useState<ScheduleEventVM | null>(null)
  const [openingRowId, setOpeningRowId] = useState<string | null>(null)
  // Открытие единой карточки абонемента (SubscriptionDetailModal) — та же
  // самая, что и в Финансах, и в подборе абонемента заказа.
  const [openSubscriptionId, setOpenSubscriptionId] = useState<string | null>(null)
  // По умолчанию таблица "Съёмки" показывает только последние 5 записей
  // (ТЗ, часть 3) — аналитика ниже (метрики, диаграммы) всегда считается по
  // ПОЛНОМУ shoots, это состояние влияет только на то, что рендерится в теле
  // таблицы, см. visibleShoots.
  const [shootsExpanded, setShootsExpanded] = useState(false)

  const isLegal = client.type !== 'INDIVIDUAL' && client.type !== 'SELF_EMPLOYED'

  const byRoom = useMemo(() => groupHoursBy(shoots, 'room'), [shoots])
  const byFormat = useMemo(() => groupHoursBy(shoots, 'format'), [shoots])
  const visibleShoots = useMemo(() => getVisibleShoots(shoots, shootsExpanded), [shoots, shootsExpanded])
  const hiddenShootsCount = getHiddenShootsCount(shoots.length)
  // Те же правила, что и в финансовом расчёте на сервере (computeFinanceOverview):
  // отменённые/будущие съёмки не показываются как "оплата" в этом списке.
  const paymentRows = useMemo(
    () => shoots.filter(r => !r.isCancelled && !r.isFuture && r.amount.kind !== 'unknown'),
    [shoots]
  )

  async function handleOpenShoot(row: ShootRowDTO) {
    if (!row.calendarEventId) return
    setOpeningRowId(row.id)
    const annResult = await getScheduleAnnotations([row.calendarEventId])
    setOpeningRowId(null)
    const annotation = annResult.data[row.calendarEventId] ?? null
    const fallbackTime = row.startAt ?? row.date ?? new Date().toISOString()
    const calendarEvent: CalendarEvent = {
      id: row.calendarEventId,
      title: annotation?.title ?? row.format ?? 'Съёмка',
      start: annotation?.startAt ?? fallbackTime,
      end: annotation?.endAt ?? row.endAt ?? fallbackTime,
      allDay: false,
      description: annotation?.description ?? '',
      location: '',
      calendar: 'studio',
      color: '#00c26b',
    }
    setOpenVm(mergeScheduleEvent(calendarEvent, annotation))
  }

  async function handleSaveNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    setNoteError(null)
    const result = await addClientNote(client.id, noteText)
    setSavingNote(false)
    if (result.ok) {
      setNoteText('')
      router.refresh()
    } else {
      setNoteError(result.error ?? 'Ошибка сохранения')
    }
  }

  return (
    <div className="space-y-4">
      {/* Tab bar — flex-nowrap явно (не полагаемся на дефолт), чтобы узкая
          правая колонка карточки клиента не спровоцировала перенос вкладок
          на вторую строку вместо горизонтального скролла. */}
      <div className="flex flex-nowrap items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {/* Обзор */}
        {activeTab === 'overview' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
            <h3 className="text-white font-semibold">Информация о клиенте</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow label="Имя / название" value={client.name} />
              <InfoRow label="Контактное лицо" value={client.contactPerson} />
              <InfoRow label="Тип" value={CLIENT_TYPE_LABELS[client.type as keyof typeof CLIENT_TYPE_LABELS]} />
              <InfoRow label="Статус" value={CLIENT_STATUS_LABELS[client.status as keyof typeof CLIENT_STATUS_LABELS]} />
              <InfoRow label="Телефон" value={client.phone} />
              <InfoRow label="Telegram" value={client.telegram} />
              <InfoRow label="Email" value={client.email} />
              <InfoRow
                label="Источник"
                value={client.source ? CLIENT_SOURCE_LABELS[client.source as keyof typeof CLIENT_SOURCE_LABELS] : undefined}
              />
              {client.source === 'OTHER' && client.customSource && (
                <InfoRow label="Уточнение источника" value={client.customSource} />
              )}
              <InfoRow
                label="Добавлен"
                value={new Date(client.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              />
            </div>

            {isLegal && (client.companyName || client.inn || client.kpp || client.ogrn || client.legalAddress) && (
              <div className="pt-4 border-t border-zinc-800">
                <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3">Реквизиты</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label="Название компании" value={client.companyName} />
                  <InfoRow label="ИНН" value={client.inn} />
                  <InfoRow label="КПП" value={client.kpp} />
                  <InfoRow label="ОГРН / ОГРНИП" value={client.ogrn} />
                  <InfoRow label="Юридический адрес" value={client.legalAddress} />
                  <InfoRow label="Комментарий по документам" value={client.documentComment} />
                </div>
              </div>
            )}

            {client.notes && (
              <div className="pt-4 border-t border-zinc-800">
                <p className="text-zinc-400 text-xs mb-2">Внутренний комментарий</p>
                <p className="text-zinc-300 text-sm whitespace-pre-wrap">{client.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Съёмки — единый список: старые импортированные визиты + живые
            записи расписания, без дублей (см. getClientShootsData). */}
        {activeTab === 'sessions' && (
          shoots.length === 0 ? (
            <PlaceholderTab
              icon={Calendar}
              title="Съёмок пока нет"
              description="Импортируйте историю визитов или создайте запись в разделе «Расписание», чтобы увидеть съёмки, часы и суммы"
            />
          ) : (
            <div className="space-y-4">
              {/* Метрики — из уже посчитанного на сервере summary, без
                  повторного пересчёта на фронтенде (ТЗ, часть 9). */}
              <div className={METRIC_GRID_CLASSNAME}>
                <MetricCard icon={Calendar} label="Съёмок" value={String(shootsSummary.totalShoots)} />
                <MetricCard icon={Clock} label="Часов в студии" value={formatHours(shootsSummary.totalHours)} />
                <MetricCard icon={DollarSign} label="Средний чек" value={formatMoneyCompact(shootsSummary.avgCheck)} />
              </div>

              {/* Диаграммы */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-white font-semibold text-sm mb-4">По залам</h3>
                  <DonutChart
                    emptyLabel="Нет данных о залах"
                    data={byRoom.map((r, i) => ({ label: r.label, value: r.value, color: CHART_COLORS[i % CHART_COLORS.length] }))}
                  />
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-white font-semibold text-sm mb-4">По форматам записи</h3>
                  <DonutChart
                    emptyLabel="Нет данных о форматах"
                    data={byFormat.map((f, i) => ({ label: f.label, value: f.value, color: CHART_COLORS[i % CHART_COLORS.length] }))}
                  />
                </div>
              </div>

              {/* История съёмок — компактная таблица, ТЗ часть 2-6: по
                  умолчанию только последние 5 (visibleShoots), полный список
                  доступен по кнопке ниже; аналитика выше всегда считается по
                  полному shoots, сворачивание сюда не влияет. */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800">
                  <h3 className="text-white font-semibold text-sm">История съёмок</h3>
                  <p className="text-zinc-500 text-xs mt-0.5">Нажмите на съёмку со связью в расписании, чтобы открыть её карточку</p>
                </div>
                <div className="overflow-x-auto">
                  <div style={{ minWidth: SHOOTS_TABLE_MIN_WIDTH }} role="table" aria-label="История съёмок">
                    {/* Заголовок — та же SHOOTS_GRID_COLS, что и у строк ниже,
                        поэтому значения физически не могут разъехаться со
                        своими колонками. */}
                    <div role="row" className={`grid ${SHOOTS_GRID_COLS} sticky top-0 z-10 border-b border-zinc-800 bg-zinc-800/60 backdrop-blur-sm`}>
                      {['Дата и время', 'Зал', 'Формат', 'Часы', 'Сумма', 'Материалы', 'Backup', 'Комментарий'].map(label => (
                        <div key={label} role="columnheader" className="px-4 py-2.5 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                          {label}
                        </div>
                      ))}
                      <div role="columnheader" className="px-2 py-2.5"><span className="sr-only">Действие</span></div>
                    </div>
                    <div role="rowgroup">
                      {visibleShoots.map((row, i) => {
                        const clickable = !!row.calendarEventId
                        const timeRange = formatTimeRange(row.startAt, row.endAt)
                        const isNewlyRevealed = shootsExpanded && i >= SHOOTS_TABLE_DEFAULT_LIMIT
                        return (
                          <div
                            key={row.id}
                            role="row"
                            aria-label={clickable ? `Открыть съёмку от ${formatDate(row.date)}` : undefined}
                            onClick={() => clickable && handleOpenShoot(row)}
                            onKeyDown={e => {
                              if ((e.key === 'Enter' || e.key === ' ') && clickable) { e.preventDefault(); handleOpenShoot(row) }
                            }}
                            tabIndex={clickable ? 0 : -1}
                            className={`grid ${SHOOTS_GRID_COLS} items-start border-b border-zinc-800/60 last:border-b-0 transition-colors ${
                              clickable ? 'cursor-pointer hover:bg-white/[0.04] focus:outline-none focus:bg-white/[0.04]' : ''
                            } ${row.isCancelled ? 'opacity-50' : ''} ${isNewlyRevealed ? 'animate-in fade-in duration-300' : ''}`}
                          >
                            <div role="cell" className="px-4 py-2.5 whitespace-nowrap overflow-hidden">
                              <p className="text-zinc-300 text-sm">{formatDate(row.date)}</p>
                              {timeRange && <p className="text-zinc-500 text-xs mt-0.5">{timeRange}</p>}
                              {row.isFuture && <Badge variant="outline" className="text-[10px] mt-1 border-blue-800 text-blue-400">Будущая</Badge>}
                              {row.isCancelled && <Badge variant="outline" className="text-[10px] mt-1 border-zinc-700 text-zinc-500">Отменена</Badge>}
                              {openingRowId === row.id && <span className="text-zinc-500 text-[11px] ml-1">Открываем...</span>}
                            </div>
                            <div role="cell" className="px-4 py-2.5 text-zinc-400 text-sm truncate" title={row.room ?? undefined}>{row.room ?? '—'}</div>
                            <div role="cell" className="px-4 py-2.5 text-zinc-400 text-sm truncate" title={row.format ?? undefined}>{row.format ?? '—'}</div>
                            <div role="cell" className="px-4 py-2.5 text-zinc-400 text-sm whitespace-nowrap">{formatHours(row.durationHours)}</div>
                            <div role="cell" className="px-4 py-2.5"><AmountCell row={row} /></div>
                            <div role="cell" className="px-4 py-2.5 min-w-0" onClick={e => e.stopPropagation()}>
                              <MaterialsCell row={row} />
                            </div>
                            <div role="cell" className="px-4 py-2.5 min-w-0" onClick={e => e.stopPropagation()}>
                              <BackupCell row={row} />
                            </div>
                            <div role="cell" className="px-4 py-2.5 min-w-0" onClick={e => e.stopPropagation()}>
                              <CommentCell comment={row.comment} />
                            </div>
                            <div role="cell" className="px-2 py-2 flex items-center justify-center">
                              {clickable && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); handleOpenShoot(row) }}
                                  aria-label="Открыть карточку съёмки в системе"
                                  title="Открыть карточку съёмки"
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-400"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {shoots.length > SHOOTS_TABLE_DEFAULT_LIMIT && (
                  <div className="px-4 py-3 border-t border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setShootsExpanded(v => !v)}
                      className="text-xs text-zinc-400 hover:text-white underline"
                    >
                      {shootsExpanded ? 'Свернуть' : `Показать все съёмки${hiddenShootsCount > 0 ? ` · ещё ${hiddenShootsCount}` : ''}`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {/* Монтаж */}
        {activeTab === 'editing' && (
          <PlaceholderTab
            icon={Film}
            title="Задачи монтажа"
            description="Здесь будут задачи по монтажу: монтажёр, статус, исходники, результат"
          />
        )}

        {/* Финансы */}
        {activeTab === 'finance' && (
          subscriptions.length === 0 && financeOverview.totalReceived === 0 ? (
            <PlaceholderTab
              icon={DollarSign}
              title="Финансовых данных пока нет"
              description="Абонемент или способ оплаты можно указать в карточке записи расписания"
            />
          ) : (
            <div className="space-y-4">
              {/* Итоговые суммы */}
              <div className={METRIC_GRID_CLASSNAME}>
                <MetricCard icon={Wallet} label="Получено всего" value={formatMoneyCompact(financeOverview.totalReceived)} />
                <MetricCard icon={Receipt} label="Возвращено" value={formatMoneyCompact(financeOverview.refundsTotal || null)} />
                <MetricCard icon={DollarSign} label="Чистыми" value={formatMoneyCompact(financeOverview.netReceived)} />
                <MetricCard icon={Calendar} label="Абонементы" value={formatMoneyCompact(financeOverview.subscriptionPurchasesTotal || null)} />
                <MetricCard icon={Clock} label="Разовые оплаты" value={formatMoneyCompact(financeOverview.oneTimePaymentsTotal || null)} />
              </div>

              {/* Кольцевая диаграмма распределения денег */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-white font-semibold text-sm mb-4">Откуда получены деньги</h3>
                <DonutChart
                  emptyLabel="Нет финансовых данных"
                  formatValue={v => formatMoney(v)}
                  data={financeOverview.segments.map((s, i) => ({
                    label: s.date ? `${formatDate(s.date)}${s.label ? ' · ' + s.label : ''}` : s.label,
                    value: s.value,
                    color: CHART_COLORS[i % CHART_COLORS.length],
                  }))}
                />
              </div>

              {/* Список оплат по каждой съёмке — без двойного учёта абонементов:
                  строки с оплатой по абонементу показывают "По абонементу", а не
                  повторяют сумму покупки самого абонемента (ТЗ, часть 7). */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-800">
                  <h3 className="text-white font-semibold text-sm">Оплаты по съёмкам</h3>
                </div>
                <div className="divide-y divide-zinc-800/60">
                  {paymentRows.length === 0 ? (
                    <p className="text-zinc-500 text-sm px-6 py-4">Нет данных об оплатах отдельных съёмок</p>
                  ) : (
                    paymentRows.map(row => (
                      <div key={row.id} className="flex items-center justify-between gap-4 px-6 py-3">
                        <div className="min-w-0">
                          <p className="text-zinc-200 text-sm truncate">{row.format ?? 'Съёмка'}</p>
                          <p className="text-zinc-500 text-xs mt-0.5">
                            {formatDate(row.date)}
                            {row.room && ` · ${row.room}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 flex items-center gap-3">
                          <div>
                            <p className="text-white text-sm font-medium">{formatShootAmount(row)}</p>
                            <p className="text-zinc-500 text-xs mt-0.5">
                              {row.amount.kind === 'amount' && row.paymentMethod ? PAYMENT_METHOD_LABELS[row.paymentMethod] : ' '}
                            </p>
                          </div>
                          {row.calendarEventId && (
                            <button
                              type="button"
                              onClick={() => handleOpenShoot(row)}
                              aria-label="Открыть съёмку"
                              className="text-zinc-500 hover:text-[#00c26b] transition-colors"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {subscriptions.map(sub => {
                const displayStatus = getSubscriptionDisplayStatus(sub)
                return (
                <div key={sub.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-white font-semibold">Абонемент от {formatDate(sub.purchasedAt)}</p>
                      <p className="text-zinc-400 text-sm mt-0.5">
                        {sub.packageHours} часов
                        {sub.paidAmount != null && ` · оплачено ${formatMoney(sub.paidAmount)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                      <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_DISPLAY_STATUS_COLORS[displayStatus]}`}>
                        {SUBSCRIPTION_DISPLAY_STATUS_LABELS[displayStatus]}
                      </Badge>
                      {sub.isArchived && (
                        <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_ARCHIVED_BADGE_CLASS}`}>
                          {SUBSCRIPTION_ARCHIVED_BADGE_LABEL}
                        </Badge>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenSubscriptionId(sub.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 font-medium hover:bg-zinc-700 hover:border-zinc-600 transition-colors"
                      >
                        Открыть
                      </button>
                      <SubscriptionActionsMenu subscription={sub} onChanged={() => router.refresh()} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                    <div>
                      <p className="text-zinc-500 text-xs">Использовано</p>
                      <p className="text-white font-semibold mt-0.5">{sub.usedHours} ч</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Осталось</p>
                      <p className="text-white font-semibold mt-0.5">{sub.remainingHours} ч</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Статус изменён</p>
                      <p className="text-white font-semibold mt-0.5">{formatDate(sub.statusUpdatedAt)}</p>
                    </div>
                  </div>
                  {(sub.adminComment || (sub.status === 'CANCELLED' && sub.cancellationReason) || sub.status === 'REFUNDED') && (
                    <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2 text-sm">
                      {sub.status === 'CANCELLED' && sub.cancellationReason && (
                        <p><span className="text-zinc-500">Причина аннулирования: </span><span className="text-zinc-300">{sub.cancellationReason}</span></p>
                      )}
                      {sub.status === 'REFUNDED' && (
                        <p>
                          <span className="text-zinc-500">Возврат: </span>
                          <span className="text-zinc-300">
                            {sub.refundAmount != null ? formatMoney(sub.refundAmount) : '—'}
                            {sub.refundReason && ` · ${sub.refundReason}`}
                          </span>
                        </p>
                      )}
                      {sub.adminComment && (
                        <p><span className="text-zinc-500">Комментарий администратора: </span><span className="text-zinc-300">{sub.adminComment}</span></p>
                      )}
                    </div>
                  )}
                  {sub.usages.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-zinc-800 space-y-1.5">
                      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">История списаний</p>
                      {sub.usages.map(u => (
                        <div key={u.id} className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300">{formatDate(u.usedAt)} · {u.eventTitle ?? 'Запись'}</span>
                          <span className="text-zinc-400">{u.usedHours} ч</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )
        )}

        {/* Документы */}
        {activeTab === 'documents' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">Документы</h3>
              <button className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-3 py-2 rounded-lg transition-colors">
                <Upload className="w-3.5 h-3.5" />
                Добавить документ
              </button>
            </div>
            {client.documents.length === 0 ? (
              <div className="border border-dashed border-zinc-700 rounded-xl p-10 text-center">
                <FileText className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">Документов пока нет</p>
                <p className="text-zinc-600 text-xs mt-1">Договоры, счета, акты и приложения</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {client.documents.map(doc => (
                  <li key={doc.id} className="flex items-center gap-3 bg-zinc-800 rounded-lg px-4 py-3">
                    <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="text-zinc-200 text-sm flex-1">{doc.fileName}</span>
                    {doc.storageUrl && (
                      <a href={doc.storageUrl} target="_blank" rel="noopener noreferrer"
                        className="text-[#00c26b] text-xs hover:underline">
                        Открыть
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Заметки */}
        {activeTab === 'notes' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
            <h3 className="text-white font-semibold">Внутренние заметки</h3>

            {/* Existing notes */}
            {client.clientNotes.length > 0 && (
              <div className="space-y-3">
                {client.clientNotes.map(note => (
                  <div key={note.id} className="bg-zinc-800 rounded-lg px-4 py-3 space-y-1">
                    <p className="text-zinc-200 text-sm whitespace-pre-wrap">{note.text}</p>
                    <p className="text-zinc-600 text-xs">
                      {new Date(note.createdAt).toLocaleDateString('ru-RU', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* New note input */}
            <div className="pt-2 border-t border-zinc-800 space-y-3">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Добавить заметку..."
                rows={4}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-600 rounded-lg px-4 py-3 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none"
              />
              {noteError && (
                <p className="text-red-400 text-sm">{noteError}</p>
              )}
              <button
                onClick={handleSaveNote}
                disabled={savingNote || !noteText.trim()}
                className="flex items-center gap-2 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                {savingNote ? 'Сохранение...' : 'Добавить заметку'}
              </button>
            </div>
          </div>
        )}
      </div>

      {openVm && (
        <EventCardModal
          vm={openVm}
          onOpenChange={open => { if (!open) setOpenVm(null) }}
          onSaved={() => { setOpenVm(null); router.refresh() }}
        />
      )}

      {openSubscriptionId && (
        <SubscriptionDetailModal
          subscriptionId={openSubscriptionId}
          onOpenChange={open => { if (!open) setOpenSubscriptionId(null) }}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  )
}
