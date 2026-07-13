'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Search, X, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  createMontageProject, updateMontageProject,
  pauseMontageProject, resumeMontageProject, cancelMontageProject, archiveMontageProject, unarchiveMontageProject,
  type MontageProjectDTO, type MontageProjectInput,
} from '@/lib/actions/montage'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { OrderDTO } from '@/lib/actions/orders'
import { getClients } from '@/lib/actions/clients'
import {
  MONTAGE_STATUS_ORDER, MONTAGE_STATUS_LABELS, MONTAGE_CLIENT_PAYMENT_STATUS_LABELS, MONTAGE_EDITOR_PAYMENT_STATUS_LABELS,
  MONTAGE_CONTENT_TYPE_ORDER, MONTAGE_CONTENT_TYPE_LABELS, MONTAGE_ATTENTION_LABELS, MONTAGE_ARCHIVABLE_STATUSES,
  computeMontageDeadline, computeMontageProfit, isMontageOverdue, montageDeadlineLabel,
  getMontageMaterialsState, getMontageMaterialsMissingFields,
  type MontageStatus, type MontageClientPaymentStatus, type MontageEditorPaymentStatus, type MontageDeadlineType,
  type MontageContentType, type MontageTurnaroundDayType, type MontageAttentionReason,
} from '@/lib/montage-model'

// Те же геометрия/классы полей, что в OrderFormModal.tsx — единый визуальный
// язык форм-карточек платформы (h-10, zinc-800 фон, зелёный focus-border).
const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none'
const LABEL = 'block text-zinc-400 text-xs'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

// Причины "Требует внимания", которые в карточке показываются как
// незаполненность, а НЕ как статус (ТЗ: "Новый" может означать "нет
// монтажёра"/"нет исходников"/"не задан дедлайн" — это отдельные предупреждения,
// а не отдельные значения статуса). Тот же список причин, что дашборд/таблица
// (getMontageAttentionReasons, montage-model.ts) — не second-guessing своей
// версией, только фильтр по подмножеству, релевантному карточке. Остальные
// причины (нет клиента, просрочка, нет NAS, оплата не определена) уже показаны
// в других местах формы (блок привязки клиента, срок сдачи, статусы оплаты) —
// повторять их здесь как generic предупреждение было бы дублированием.
const CARD_WARNING_REASONS: MontageAttentionReason[] = ['NO_EDITOR', 'NO_SOURCE', 'NO_DEADLINE', 'INCOMPLETE_CARD']

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}
function FieldLabel({ children }: { children: ReactNode }) {
  return <label className={LABEL}>{children}</label>
}

interface SelectOption {
  value: string
  label: string
}

// Единственный кастомный dropdown карточки — тёмная тема поверх
// @/components/ui/select (base-ui), переиспользуется для ВСЕХ выпадающих
// списков этой формы вместо системного/белого <select> (ТЗ: заменить нативный
// dropdown на тёмный компонент платформы). Классы shadcn-варианта в самом
// ui/select.tsx рассчитаны на CSS-переменные (--popover, --accent и т.п.),
// которых в тёмной админке нет (см. globals.css — тема только светлая для
// публичных страниц), поэтому здесь везде явные zinc-классы поверх базовых.
function DarkSelect({
  value, onValueChange, options, placeholder = 'Не выбрано',
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
}) {
  const labelByValue = useMemo(() => new Map(options.map(o => [o.value, o.label])), [options])
  return (
    <Select value={value} onValueChange={v => onValueChange((v as string | null) ?? '')}>
      <SelectTrigger
        className={`${FIELD_BASE} w-full justify-between px-3 text-zinc-200 data-[popup-open]:border-[#00c26b]`}
      >
        <SelectValue placeholder={placeholder}>
          {(v: string) => (v ? (labelByValue.get(v) ?? v) : placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-zinc-800 border border-zinc-700 text-zinc-200 shadow-xl rounded-lg">
        {options.map(o => (
          <SelectItem
            key={o.value || '__empty__'}
            value={o.value}
            className="text-zinc-300 rounded-md cursor-pointer data-[highlighted]:bg-zinc-700 data-[highlighted]:text-white data-[selected]:text-[#00c26b]"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}
function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}
function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
}

interface Props {
  project: MontageProjectDTO | null
  orders: OrderDTO[]
  editors: EditorProfileListItemDTO[]
  // Нужен только чтобы предупредить о дубле при привязке НОВОГО проекта к
  // заказу, у которого уже есть проект(ы) — ТЗ п.18: "предупредить и не
  // создавать дубль без явного подтверждения".
  existingProjects: MontageProjectDTO[]
  // Карточка открыта кликом по предупреждению материалов в таблице — при
  // монтаже прокручиваем к разделу "Материалы" и ставим focus на первое
  // отсутствующее поле (ТЗ п.7). Обычное открытие карточки этот проп не задаёт.
  focusMaterialsOnOpen?: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export default function MontageProjectModal({ project, orders, editors, existingProjects, focusMaterialsOnOpen, onOpenChange, onSaved }: Props) {
  const isEdit = !!project

  // ---- Шаг 1 (только при создании): привязать к заказу или самостоятельный (ТЗ п.18) ----
  const [linkMode, setLinkMode] = useState<'order' | 'standalone' | null>(isEdit ? (project!.orderId ? 'order' : 'standalone') : null)
  const [orderSearch, setOrderSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(project?.orderId ?? null)
  const [confirmDuplicateOrder, setConfirmDuplicateOrder] = useState(false)

  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderId) ?? null, [orders, selectedOrderId])
  const orderMatches = useMemo(() => {
    if (!orderSearch.trim()) return orders.slice(0, 20)
    const q = orderSearch.trim().toLowerCase()
    return orders.filter(o => [o.title, o.clientName, o.companyName].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 20)
  }, [orders, orderSearch])

  // ---- Клиент для самостоятельного проекта (ТЗ п.18: "Самостоятельный
  // проект" всё равно требует привязки к реальному клиенту — не создаём
  // фиктивный заказ, но и не оставляем проект вовсе без клиента). ----
  const [clientSearch, setClientSearch] = useState('')
  const [clientMatches, setClientMatches] = useState<{ id: string; name: string; companyName: string | null }[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string | null>(isEdit && !project!.orderId ? project!.clientId : null)
  const [selectedClientLabel, setSelectedClientLabel] = useState<string | null>(isEdit && !project!.orderId ? project!.clientName : null)

  async function searchClients(q: string) {
    setClientSearch(q)
    if (!q.trim()) { setClientMatches([]); return }
    const res = await getClients({ search: q.trim() })
    if (res.ok) setClientMatches(res.data.slice(0, 20).map(c => ({ id: c.id, name: c.name, companyName: c.companyName })))
  }

  // ---- Поля карточки ----
  const [title, setTitle] = useState(project?.title ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [contentType, setContentType] = useState<MontageContentType | ''>(project?.contentType ?? '')
  const [customContentType, setCustomContentType] = useState(project?.customContentType ?? '')
  const [status, setStatus] = useState<MontageStatus>(project?.status ?? 'NEW')

  const [editorId, setEditorId] = useState(project?.editorId ?? '')
  const [additionalEditorIds, setAdditionalEditorIds] = useState<string[]>(project?.additionalEditorIds ?? [])
  const [addEditorPick, setAddEditorPick] = useState('')

  const [sourceReceivedAt, setSourceReceivedAt] = useState(toDateInputValue(project?.sourceReceivedAt ?? null))
  const [startedAt, setStartedAt] = useState(toDateInputValue(project?.startedAt ?? null))
  const [deadlineType, setDeadlineType] = useState<'' | MontageDeadlineType>(project?.deadlineType ?? '')
  const [deadlineDateInput, setDeadlineDateInput] = useState(toDateInputValue(project?.deadlineDate ?? null))
  const [turnaroundDays, setTurnaroundDays] = useState(project?.turnaroundDays != null ? String(project.turnaroundDays) : '')
  const [turnaroundDayType, setTurnaroundDayType] = useState<'' | MontageTurnaroundDayType>(project?.turnaroundDayType ?? '')
  const [deliveredAt, setDeliveredAt] = useState(toDateInputValue(project?.deliveredAt ?? null))
  // completedAt намеренно НЕ поле формы — технический таймстамп, проставляется
  // сервером автоматически при переходе в "Сдан" (см. MontageProjectDTO.completedAt,
  // actions/montage.ts). Раньше здесь дублировал "Фактическую дату сдачи" и
  // путал (ТЗ: "убрать путаницу с датой завершения работы").

  const [clientAmount, setClientAmount] = useState(project?.clientAmount != null ? String(project.clientAmount) : '')
  const [editorAmount, setEditorAmount] = useState(project?.editorAmount != null ? String(project.editorAmount) : '')
  const [clientPaymentStatus, setClientPaymentStatus] = useState<MontageClientPaymentStatus>(project?.clientPaymentStatus ?? 'NOT_SPECIFIED')
  const [editorPaymentStatus, setEditorPaymentStatus] = useState<MontageEditorPaymentStatus>(project?.editorPaymentStatus ?? 'NOT_CALCULATED')
  const [clientPaidAt, setClientPaidAt] = useState(toDateInputValue(project?.clientPaidAt ?? null))
  const [editorPaidAt, setEditorPaidAt] = useState(toDateInputValue(project?.editorPaidAt ?? null))
  const [paymentComment, setPaymentComment] = useState(project?.paymentComment ?? '')

  const [sourceMaterialsUrl, setSourceMaterialsUrl] = useState(project?.sourceMaterialsUrl ?? '')
  // Контроль материалов на NAS (ТЗ "точечно доработать контроль материалов") —
  // отдельное от sourceMaterialsUrl поле, см. комментарий у
  // MontageProject.sourceMaterialsNasUrl в схеме: "чем сейчас пользуется
  // монтажёр" (обычно Яндекс.Диск) — не то же самое, что "сохранено на NAS".
  const [sourceMaterialsNasUrl, setSourceMaterialsNasUrl] = useState(project?.sourceMaterialsNasUrl ?? '')
  const [mountedMaterialNasUrl, setMountedMaterialNasUrl] = useState(project?.mountedMaterialNasUrl ?? '')
  const [deliveryUrl, setDeliveryUrl] = useState(project?.deliveryUrl ?? '')
  const [materialsComment, setMaterialsComment] = useState(project?.materialsComment ?? '')

  const materialsSectionRef = useRef<HTMLParagraphElement>(null)
  const sourceMaterialsNasInputRef = useRef<HTMLInputElement>(null)
  const mountedMaterialNasInputRef = useRef<HTMLInputElement>(null)

  // Прокрутка + focus при открытии карточки кликом по предупреждению
  // материалов в таблице (ТЗ п.7) — один раз при монтаже, читает НАЧАЛЬНЫЕ
  // значения из project (не текущее состояние формы), поэтому зависимости
  // эффекта стабильны и не перезапускают его при каждом вводе в поле.
  useEffect(() => {
    if (!focusMaterialsOnOpen || !project) return
    // Диалог (@base-ui/react/dialog) сам ставит начальный focus при открытии
    // (плюс своя transition, см. data-open:animate-in в dialog.tsx) — если
    // сфокусировать поле сразу, эта внутренняя логика диалога срабатывает
    // ПОСЛЕ и перехватывает focus обратно на дефолтный элемент. Небольшая
    // задержка (дольше duration-100 диалога) даёт её логике отработать первой.
    const timer = setTimeout(() => {
      materialsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const target = !project.sourceMaterialsNasUrl
        ? sourceMaterialsNasInputRef.current
        : !project.mountedMaterialNasUrl
          ? mountedMaterialNasInputRef.current
          : null
      target?.focus({ preventScroll: true })
    }, 150)
    return () => clearTimeout(timer)
  }, [focusMaterialsOnOpen, project])

  const [revisionsIncluded, setRevisionsIncluded] = useState(project?.revisionsIncluded != null ? String(project.revisionsIncluded) : '')
  const [revisionsUsed, setRevisionsUsed] = useState(String(project?.revisionsUsed ?? 0))
  const [revisionsComment, setRevisionsComment] = useState(project?.revisionsComment ?? '')

  const [requirements, setRequirements] = useState(project?.requirements ?? '')
  const [internalComment, setInternalComment] = useState(project?.internalComment ?? '')
  const [clientComment, setClientComment] = useState(project?.clientComment ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- Пауза / отмена / архив — служебные действия, отдельные от Сохранить
  // (ТЗ: "не статус, не дропдаун — отдельное действие с подтверждением").
  // Каждое действие мутирует сразу (свой вызов сервера), а не копится в
  // общий input формы. ----
  const [confirmingAction, setConfirmingAction] = useState<'pause' | 'cancel' | 'archive' | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [actionSaving, setActionSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const deadlinePreview = useMemo(() => computeMontageDeadline({
    sourceReceivedAt: sourceReceivedAt || null,
    deadlineType: deadlineType || null,
    deadlineDate: deadlineDateInput || null,
    turnaroundDays: turnaroundDays ? Number(turnaroundDays) : null,
    turnaroundDayType: turnaroundDayType || null,
  }), [sourceReceivedAt, deadlineType, deadlineDateInput, turnaroundDays, turnaroundDayType])

  // "Осталось N дней" / "Просрочено" / "Сдано вовремя" и т.п. — единственный
  // источник этого текста уже есть (montageDeadlineLabel, montage-model.ts),
  // используется таблицей/дашбордом; здесь просто вызывается с текущими
  // (ещё не сохранёнными) значениями формы, а не пересчитывается заново.
  const deadlineStateForLabel = useMemo(() => ({
    deadlineDate: deadlinePreview, status, deliveredAt: deliveredAt || null,
    isArchived: isEdit ? project!.isArchived : false,
  }), [deadlinePreview, status, deliveredAt, isEdit, project])
  const deadlineStatusLabel = montageDeadlineLabel(deadlineStateForLabel)
  const deadlineIsOverduePreview = isMontageOverdue(deadlineStateForLabel)

  const profitPreview = computeMontageProfit(clientAmount ? Number(clientAmount) : null, editorAmount ? Number(editorAmount) : null)

  // Контроль материалов (ТЗ п.8) — та же функция, что таблица/"Требует
  // внимания" (getMontageMaterialsState, montage-model.ts), с текущими (ещё
  // не сохранёнными) значениями формы, чтобы предупреждение исчезало сразу,
  // как только вставлена вторая ссылка, без ожидания сохранения.
  const materialsStatePreview = useMemo(() => getMontageMaterialsState({
    status, sourceReceivedAt: sourceReceivedAt || null,
    sourceMaterialsNasUrl: sourceMaterialsNasUrl || null, mountedMaterialNasUrl: mountedMaterialNasUrl || null,
    isArchived: isEdit ? project!.isArchived : false,
  }), [status, sourceReceivedAt, sourceMaterialsNasUrl, mountedMaterialNasUrl, isEdit, project])
  const materialsMissingPreview = useMemo(() => getMontageMaterialsMissingFields({
    status, sourceMaterialsNasUrl: sourceMaterialsNasUrl || null, mountedMaterialNasUrl: mountedMaterialNasUrl || null,
  }), [status, sourceMaterialsNasUrl, mountedMaterialNasUrl])

  const duplicateOrderProjects = !isEdit && selectedOrderId
    ? existingProjects.filter(p => p.orderId === selectedOrderId)
    : []

  const cardWarnings = isEdit ? project!.attentionReasons.filter(r => CARD_WARNING_REASONS.includes(r)) : []

  function addEditor(id: string) {
    if (!id || additionalEditorIds.includes(id) || id === editorId) return
    setAdditionalEditorIds(prev => [...prev, id])
    setAddEditorPick('')
  }
  function removeEditor(id: string) {
    setAdditionalEditorIds(prev => prev.filter(x => x !== id))
  }

  // Переход в "В работе"/"Сдан" подсказывает сегодняшнюю дату, только если
  // соответствующее поле ещё пусто — никогда не перезаписывает молча уже
  // заполненную дату (ТЗ п.11/12). Обычный обработчик события, не useEffect
  // (см. AGENTS.md-конвенцию этого репозитория про react-hooks/set-state-in-effect).
  function handleStatusChange(next: MontageStatus) {
    setStatus(next)
    const today = toDateInputValue(new Date().toISOString())
    if (next === 'IN_PROGRESS' && !startedAt) setStartedAt(today)
    if (next === 'DELIVERED' && !deliveredAt) setDeliveredAt(today)
  }

  function handleContentTypeChange(next: string) {
    const typed = next as MontageContentType | ''
    setContentType(typed)
    if (typed !== 'OTHER') setCustomContentType('')
  }

  function handleDeadlineTypeChange(next: string) {
    const typed = next as '' | MontageDeadlineType
    setDeadlineType(typed)
    if (typed === 'DURATION_DAYS' && !turnaroundDayType) setTurnaroundDayType('CALENDAR')
  }

  async function runProjectAction(action: 'pause' | 'resume' | 'cancel' | 'archive' | 'unarchive') {
    if (!project) return
    setActionSaving(true)
    setActionError(null)
    const reason = actionReason.trim() || null
    const result = await (
      action === 'pause' ? pauseMontageProject(project.id, reason)
      : action === 'resume' ? resumeMontageProject(project.id)
      : action === 'cancel' ? cancelMontageProject(project.id, reason)
      : action === 'archive' ? archiveMontageProject(project.id)
      : unarchiveMontageProject(project.id)
    )
    setActionSaving(false)
    if (!result.ok) { setActionError(result.error); return }
    setConfirmingAction(null)
    setActionReason('')
    onSaved()
  }

  async function handleSave() {
    if (!isEdit && linkMode === 'order' && !selectedOrderId) {
      setError('Выберите заказ для привязки')
      return
    }
    if (!isEdit && linkMode === 'standalone' && !title.trim()) {
      setError('Укажите название самостоятельного проекта')
      return
    }
    if (!isEdit && linkMode === 'standalone' && !selectedClientId) {
      setError('Выберите клиента для самостоятельного проекта')
      return
    }
    if (!isEdit && duplicateOrderProjects.length > 0 && !confirmDuplicateOrder) {
      setError('Подтвердите создание ещё одного проекта для этого заказа')
      return
    }

    const input: MontageProjectInput = {
      orderId: isEdit ? undefined : (linkMode === 'order' ? selectedOrderId : null),
      // При редактировании самостоятельного проекта clientId можно менять
      // (единственный способ довязать клиента к строкам исторического
      // импорта, помеченным "!" — см. блок выбора клиента выше). Для
      // проектов, привязанных к заказу (linkMode === 'order'), clientId не
      // трогаем — источник правды там order.clientId, а не это поле.
      clientId: linkMode === 'standalone' ? selectedClientId : undefined,
      title: title || undefined,
      description: description || undefined,
      contentType: contentType || undefined,
      customContentType: contentType === 'OTHER' ? (customContentType || undefined) : undefined,
      status,
      editorId: editorId || null,
      additionalEditorIds,
      sourceReceivedAt: sourceReceivedAt || null,
      startedAt: startedAt || null,
      deadlineType: deadlineType || null,
      deadlineDate: deadlineDateInput || null,
      turnaroundDays: turnaroundDays ? Number(turnaroundDays) : null,
      turnaroundDayType: turnaroundDayType || null,
      deliveredAt: deliveredAt || null,
      clientAmount: clientAmount ? Number(clientAmount) : null,
      editorAmount: editorAmount ? Number(editorAmount) : null,
      clientPaymentStatus,
      editorPaymentStatus,
      clientPaidAt: clientPaidAt || null,
      editorPaidAt: editorPaidAt || null,
      paymentComment: paymentComment || undefined,
      sourceMaterialsUrl: sourceMaterialsUrl || null,
      sourceMaterialsNasUrl: sourceMaterialsNasUrl || null,
      mountedMaterialNasUrl: mountedMaterialNasUrl || null,
      deliveryUrl: deliveryUrl || null,
      materialsComment: materialsComment || undefined,
      revisionsIncluded: revisionsIncluded ? Number(revisionsIncluded) : null,
      revisionsUsed: Number(revisionsUsed || 0),
      revisionsComment: revisionsComment || undefined,
      requirements: requirements || undefined,
      internalComment: internalComment || undefined,
      clientComment: clientComment || undefined,
      confirmDuplicateForOrder: confirmDuplicateOrder,
    }

    setSaving(true)
    setError(null)
    const result = isEdit ? await updateMontageProject(project!.id, input) : await createMontageProject(input)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onSaved()
  }

  const title2 = isEdit ? (project!.title ?? 'Проект монтажа') : 'Новый проект монтажа'
  const showForm = isEdit || (linkMode === 'standalone' && selectedClientId) || (linkMode === 'order' && selectedOrder)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl sm:max-w-[662px] max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0 pr-8">
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-white text-lg font-semibold">{title2}</DialogTitle>
            {isEdit && project!.isArchived && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">В архиве</span>
            )}
            {isEdit && !project!.isArchived && project!.status === 'CANCELLED' && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-red-900/60 text-red-300 px-2 py-0.5 rounded-full">Отменён</span>
            )}
            {isEdit && !project!.isArchived && project!.isPaused && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-900/60 text-amber-300 px-2 py-0.5 rounded-full">Приостановлен</span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!isEdit && linkMode === null && (
            <div className="space-y-3">
              <p className="text-zinc-400 text-sm">Как создать проект?</p>
              <button type="button" onClick={() => setLinkMode('order')} className="w-full text-left bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 transition-colors">
                <p className="text-zinc-100 text-sm font-medium">Привязать к существующему заказу</p>
                <p className="text-zinc-500 text-xs mt-0.5">Клиент, дата и исходники подтянутся из заказа</p>
              </button>
              <button type="button" onClick={() => setLinkMode('standalone')} className="w-full text-left bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 transition-colors">
                <p className="text-zinc-100 text-sm font-medium">Самостоятельный проект</p>
                <p className="text-zinc-500 text-xs mt-0.5">Монтаж, не связанный со съёмкой студии</p>
              </button>
            </div>
          )}

          {!isEdit && linkMode === 'order' && !selectedOrderId && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Поиск заказа по клиенту, названию..." className={`${INPUT} pl-9`} />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {orderMatches.map(o => (
                  <button key={o.id} type="button" onClick={() => setSelectedOrderId(o.id)} className="w-full text-left bg-zinc-800/60 hover:bg-zinc-800 rounded-lg px-3 py-2 transition-colors">
                    <p className="text-zinc-200 text-sm truncate">{o.title ?? o.clientName ?? 'Без названия'}</p>
                    <p className="text-zinc-500 text-xs truncate">{o.clientName}{o.companyName ? ` · ${o.companyName}` : ''}</p>
                  </button>
                ))}
                {orderMatches.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">Заказы не найдены</p>}
              </div>
              <button type="button" onClick={() => setLinkMode(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">← Назад</button>
            </div>
          )}

          {!isEdit && linkMode === 'order' && selectedOrder && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-zinc-200 text-sm truncate">{selectedOrder.title ?? selectedOrder.clientName}</p>
                <p className="text-zinc-500 text-xs truncate">{selectedOrder.clientName}</p>
              </div>
              <button type="button" onClick={() => setSelectedOrderId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs flex-shrink-0">Изменить</button>
            </div>
          )}

          {linkMode === 'standalone' && !selectedClientId && (
            <div className="space-y-3 mb-4">
              {isEdit && (
                <p className="text-amber-300 text-xs flex items-center gap-1.5 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Клиент не привязан{project?.clientName ? ` — в исходных данных: "${project.clientName}"` : ''}. Найдите и выберите клиента ниже.
                </p>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input value={clientSearch} onChange={e => searchClients(e.target.value)} placeholder="Поиск клиента по имени, компании, телефону..." className={`${INPUT} pl-9`} />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {clientMatches.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setSelectedClientId(c.id); setSelectedClientLabel(c.name) }}
                    className="w-full text-left bg-zinc-800/60 hover:bg-zinc-800 rounded-lg px-3 py-2 transition-colors"
                  >
                    <p className="text-zinc-200 text-sm truncate">{c.name}</p>
                    {c.companyName && <p className="text-zinc-500 text-xs truncate">{c.companyName}</p>}
                  </button>
                ))}
                {clientSearch.trim() && clientMatches.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">Клиенты не найдены</p>}
                {!clientSearch.trim() && <p className="text-zinc-500 text-xs text-center py-4">Начните вводить имя или компанию клиента</p>}
              </div>
              {!isEdit && (
                <button type="button" onClick={() => setLinkMode(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">← Назад</button>
              )}
            </div>
          )}

          {linkMode === 'standalone' && selectedClientId && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
              <p className="text-zinc-200 text-sm truncate">{selectedClientLabel}</p>
              <button type="button" onClick={() => { setSelectedClientId(null); setSelectedClientLabel(null) }} className="text-zinc-500 hover:text-zinc-300 text-xs flex-shrink-0">Изменить</button>
            </div>
          )}

          {!isEdit && duplicateOrderProjects.length > 0 && (
            <div className="mb-4 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2.5 space-y-2">
              <p className="text-amber-300 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                У этого заказа уже есть {duplicateOrderProjects.length === 1 ? 'проект монтажа' : `проекты монтажа (${duplicateOrderProjects.length})`}: {duplicateOrderProjects.map(p => p.title ?? 'без названия').join(', ')}
              </p>
              <label className="flex items-center gap-1.5 text-xs text-amber-200 cursor-pointer select-none">
                <input type="checkbox" checked={confirmDuplicateOrder} onChange={e => setConfirmDuplicateOrder(e.target.checked)} className="accent-amber-500" />
                Да, создать ещё один проект для этого заказа
              </label>
            </div>
          )}

          {showForm && (
            <>
              {error && <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 mb-3">{error}</p>}

              {cardWarnings.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {cardWarnings.map(r => (
                    <span key={r} className="inline-flex items-center gap-1 bg-amber-950/20 border border-amber-600/40 text-amber-300 text-xs rounded-full px-2.5 py-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      {MONTAGE_ATTENTION_LABELS[r]}
                    </span>
                  ))}
                </div>
              )}

              <p className={SECTION}>Основное</p>
              <div className="space-y-3">
                <Row>
                  <Field>
                    <FieldLabel>Название проекта</FieldLabel>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Например: Монтаж подкаста от 07.10.2025" className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Тип контента</FieldLabel>
                    <DarkSelect
                      value={contentType}
                      onValueChange={handleContentTypeChange}
                      placeholder="Не указан"
                      options={[
                        { value: '', label: 'Не указан' },
                        ...MONTAGE_CONTENT_TYPE_ORDER.map(t => ({ value: t, label: MONTAGE_CONTENT_TYPE_LABELS[t] })),
                      ]}
                    />
                  </Field>
                </Row>
                {contentType === 'OTHER' && (
                  <Field>
                    <FieldLabel>Уточните тип контента</FieldLabel>
                    <input value={customContentType} onChange={e => setCustomContentType(e.target.value)} placeholder="Например: репортаж с мероприятия" className={INPUT} />
                  </Field>
                )}
                <Field>
                  <FieldLabel>Описание / ТЗ по монтажу</FieldLabel>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={TEXTAREA} />
                </Field>
                {isEdit && project!.orderId && (
                  <Link href="/admin/crm" className="text-[#00c26b] hover:underline text-xs">Открыть связанный заказ в CRM →</Link>
                )}
              </div>

              <p className={SECTION}>Ответственный монтажёр</p>
              <Row>
                <Field>
                  <FieldLabel>Основной монтажёр</FieldLabel>
                  <DarkSelect
                    value={editorId}
                    onValueChange={setEditorId}
                    placeholder="Не назначен"
                    options={[{ value: '', label: 'Не назначен' }, ...editors.map(ed => ({ value: ed.id, label: ed.displayName }))]}
                  />
                </Field>
                <Field>
                  <FieldLabel>Дополнительные исполнители</FieldLabel>
                  <div className="flex flex-wrap gap-1.5 mb-1.5 empty:mb-0">
                    {additionalEditorIds.map(id => {
                      const ed = editors.find(e => e.id === id)
                      return (
                        <span key={id} className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-zinc-300">
                          {ed?.displayName ?? id}
                          <button type="button" onClick={() => removeEditor(id)} className="text-zinc-500 hover:text-zinc-200"><X className="w-3 h-3" /></button>
                        </span>
                      )
                    })}
                  </div>
                  <DarkSelect
                    value={addEditorPick}
                    onValueChange={id => { if (id) addEditor(id) }}
                    placeholder="Добавить исполнителя..."
                    options={editors.filter(ed => ed.id !== editorId && !additionalEditorIds.includes(ed.id)).map(ed => ({ value: ed.id, label: ed.displayName }))}
                  />
                </Field>
              </Row>

              <p className={SECTION}>Статус</p>
              <Row>
                <Field>
                  <FieldLabel>Статус</FieldLabel>
                  {status === 'CANCELLED' ? (
                    <div className="h-10 flex items-center px-3 bg-red-950/20 border border-red-800/40 rounded-lg text-red-300 text-sm">Отменён</div>
                  ) : (
                    <DarkSelect
                      value={status}
                      onValueChange={v => handleStatusChange(v as MontageStatus)}
                      options={MONTAGE_STATUS_ORDER.map(s => ({ value: s, label: MONTAGE_STATUS_LABELS[s] }))}
                    />
                  )}
                </Field>
                <Field>
                  <FieldLabel>Служебные действия</FieldLabel>
                  {!isEdit ? (
                    <p className="text-zinc-600 text-xs h-10 flex items-center">Доступно после создания проекта</p>
                  ) : project!.isArchived ? (
                    <div className="space-y-2">
                      <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2">
                        <p className="text-zinc-400 text-xs">В архиве{project!.archivedAt ? ` с ${formatDate(project!.archivedAt)}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => runProjectAction('unarchive')} disabled={actionSaving} className="w-full text-xs text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                        Вернуть из архива
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {status === 'CANCELLED' ? (
                        <div className="bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2">
                          <p className="text-red-300 text-xs font-medium">Отменён{project!.cancelledAt ? ` ${formatDate(project!.cancelledAt)}` : ''}</p>
                          {project!.cancelReason && <p className="text-red-300/70 text-xs mt-0.5">{project!.cancelReason}</p>}
                        </div>
                      ) : project!.isPaused ? (
                        <div className="flex items-center justify-between gap-2 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-amber-300 text-xs font-medium">Приостановлен</p>
                            {project!.pauseReason && <p className="text-amber-300/70 text-xs truncate">{project!.pauseReason}</p>}
                          </div>
                          <button type="button" onClick={() => runProjectAction('resume')} disabled={actionSaving} className="text-xs text-zinc-200 hover:text-white bg-zinc-700 hover:bg-zinc-600 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50">
                            Возобновить
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirmingAction('pause')} className="w-full text-left text-xs text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 rounded-lg transition-colors">
                          Приостановить проект
                        </button>
                      )}

                      {status !== 'CANCELLED' && (
                        <button type="button" onClick={() => setConfirmingAction('cancel')} className="w-full text-left text-xs text-red-300 hover:text-red-200 bg-red-950/10 hover:bg-red-950/20 border border-red-900/40 px-3 py-2 rounded-lg transition-colors">
                          Отменить проект
                        </button>
                      )}

                      {MONTAGE_ARCHIVABLE_STATUSES.includes(status) && (
                        <button type="button" onClick={() => setConfirmingAction('archive')} className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 px-3 py-2 rounded-lg transition-colors">
                          Отправить в архив
                        </button>
                      )}
                    </div>
                  )}
                </Field>
              </Row>

              {confirmingAction && (
                <div className="mt-3 bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 space-y-2">
                  <p className="text-zinc-200 text-sm font-medium">
                    {confirmingAction === 'pause' && 'Приостановить проект?'}
                    {confirmingAction === 'cancel' && 'Отменить проект?'}
                    {confirmingAction === 'archive' && 'Отправить проект в архив?'}
                  </p>
                  {(confirmingAction === 'pause' || confirmingAction === 'cancel') && (
                    <textarea
                      value={actionReason}
                      onChange={e => setActionReason(e.target.value)}
                      placeholder={confirmingAction === 'cancel' ? 'Причина отмены (обязательно)' : 'Причина паузы (необязательно)'}
                      rows={2}
                      className={TEXTAREA}
                    />
                  )}
                  {actionError && <p className="text-red-400 text-xs">{actionError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runProjectAction(confirmingAction)}
                      disabled={actionSaving || (confirmingAction === 'cancel' && !actionReason.trim())}
                      className={`flex-1 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors ${confirmingAction === 'cancel' ? 'bg-red-600 hover:bg-red-500' : 'bg-zinc-700 hover:bg-zinc-600'}`}
                    >
                      {actionSaving ? 'Применяю...' : 'Подтвердить'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setConfirmingAction(null); setActionReason(''); setActionError(null) }}
                      className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              <p className={SECTION}>Сроки</p>
              <div className="space-y-3">
                <Row>
                  <Field>
                    <FieldLabel>Дата поступления в монтаж</FieldLabel>
                    <input type="date" value={sourceReceivedAt} onChange={e => setSourceReceivedAt(e.target.value)} className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Дата начала работы</FieldLabel>
                    <input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} className={INPUT} />
                  </Field>
                </Row>
                <Row>
                  <Field>
                    <FieldLabel>Плановый срок сдачи — способ задания</FieldLabel>
                    <DarkSelect
                      value={deadlineType}
                      onValueChange={handleDeadlineTypeChange}
                      options={[
                        { value: '', label: 'Не задан' },
                        { value: 'FIXED_DATE', label: 'Конкретная дата' },
                        { value: 'DURATION_DAYS', label: 'Количество дней от поступления' },
                      ]}
                    />
                  </Field>
                  {deadlineType === 'FIXED_DATE' && (
                    <Field>
                      <FieldLabel>Дедлайн</FieldLabel>
                      <input type="date" value={deadlineDateInput} onChange={e => setDeadlineDateInput(e.target.value)} className={INPUT} />
                    </Field>
                  )}
                  {deadlineType === 'DURATION_DAYS' && (
                    <Field>
                      <FieldLabel>Дней на монтаж</FieldLabel>
                      <div className="flex gap-2">
                        <input type="number" min={0} value={turnaroundDays} onChange={e => setTurnaroundDays(e.target.value)} className={`${INPUT} flex-1 min-w-0`} />
                        <div className="w-[9.5rem] flex-shrink-0">
                          <DarkSelect
                            value={turnaroundDayType || 'CALENDAR'}
                            onValueChange={v => setTurnaroundDayType(v as MontageTurnaroundDayType)}
                            options={[{ value: 'CALENDAR', label: 'Календарные' }, { value: 'BUSINESS', label: 'Рабочие' }]}
                          />
                        </div>
                      </div>
                    </Field>
                  )}
                </Row>
                {deadlinePreview && (
                  <p className="text-zinc-500 text-xs">Плановый срок сдачи: <span className="text-zinc-300 font-medium">{formatDate(deadlinePreview.toISOString())}</span></p>
                )}
                <Row>
                  <Field>
                    <FieldLabel>Фактическая дата сдачи</FieldLabel>
                    <input type="date" value={deliveredAt} onChange={e => setDeliveredAt(e.target.value)} className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Статус по срокам</FieldLabel>
                    <div className="h-10 flex items-center px-3 bg-zinc-800/60 border border-zinc-700 rounded-lg text-sm">
                      <span className={deadlineIsOverduePreview ? 'text-red-400' : status === 'DELIVERED' ? 'text-green-400' : 'text-zinc-300'}>
                        {deadlineStatusLabel ?? '—'}
                      </span>
                    </div>
                  </Field>
                </Row>
              </div>

              <p className={SECTION}>Финансы</p>
              <div className="space-y-3">
                <Row>
                  <Field>
                    <FieldLabel>Сумма от клиента</FieldLabel>
                    <input type="number" min={0} value={clientAmount} onChange={e => setClientAmount(e.target.value)} placeholder="0" className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Выплата монтажёру</FieldLabel>
                    <input type="number" min={0} value={editorAmount} onChange={e => setEditorAmount(e.target.value)} placeholder="0" className={INPUT} />
                  </Field>
                </Row>
                <p className="text-zinc-500 text-xs">Прибыль студии: <span className="text-zinc-300 font-medium">{formatMoney(profitPreview)}</span></p>
                <Row>
                  <Field>
                    <FieldLabel>Оплата клиента</FieldLabel>
                    <DarkSelect
                      value={clientPaymentStatus}
                      onValueChange={v => setClientPaymentStatus(v as MontageClientPaymentStatus)}
                      options={Object.entries(MONTAGE_CLIENT_PAYMENT_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Выплата монтажёру</FieldLabel>
                    <DarkSelect
                      value={editorPaymentStatus}
                      onValueChange={v => setEditorPaymentStatus(v as MontageEditorPaymentStatus)}
                      options={Object.entries(MONTAGE_EDITOR_PAYMENT_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                    />
                  </Field>
                </Row>
                <Row>
                  <Field>
                    <FieldLabel>Дата оплаты клиентом</FieldLabel>
                    <input type="date" value={clientPaidAt} onChange={e => setClientPaidAt(e.target.value)} className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Дата выплаты монтажёру</FieldLabel>
                    <input type="date" value={editorPaidAt} onChange={e => setEditorPaidAt(e.target.value)} className={INPUT} />
                  </Field>
                </Row>
                <Field>
                  <FieldLabel>Комментарий по оплате</FieldLabel>
                  <input value={paymentComment} onChange={e => setPaymentComment(e.target.value)} className={INPUT} />
                </Field>
              </div>

              <p ref={materialsSectionRef} className={SECTION}>Материалы</p>
              <div className="space-y-3">
                {materialsStatePreview === 'MISSING' && (
                  <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                    <p className="text-red-300 text-xs">Материалы не прикреплены: отсутствуют исходники и готовая работа.</p>
                  </div>
                )}
                {materialsStatePreview === 'PARTIAL' && (
                  <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
                    <p className="text-amber-300 text-xs">
                      {materialsMissingPreview.missingSource ? 'Не прикреплена ссылка на исходники на NAS.' : 'Не прикреплена ссылка на готовый материал на NAS.'}
                    </p>
                  </div>
                )}
                <Field>
                  <FieldLabel>Ссылка на исходники {isEdit && project!.orderId && !sourceMaterialsUrl ? '(по умолчанию — со съёмки)' : ''}</FieldLabel>
                  <input value={sourceMaterialsUrl} onChange={e => setSourceMaterialsUrl(e.target.value)} placeholder="https://disk.yandex.ru/..." className={INPUT} />
                </Field>
                <Field>
                  <FieldLabel>Ссылка на исходники на NAS</FieldLabel>
                  <input
                    ref={sourceMaterialsNasInputRef}
                    value={sourceMaterialsNasUrl}
                    onChange={e => setSourceMaterialsNasUrl(e.target.value)}
                    placeholder="\\\\nas\\..."
                    className={INPUT}
                  />
                </Field>
                <Field>
                  <FieldLabel>Ссылка на NAS (финальный материал)</FieldLabel>
                  <input
                    ref={mountedMaterialNasInputRef}
                    value={mountedMaterialNasUrl}
                    onChange={e => setMountedMaterialNasUrl(e.target.value)}
                    placeholder="\\\\nas\\..."
                    className={INPUT}
                  />
                </Field>
                <Field>
                  <FieldLabel>Ссылка на превью / отдачу клиенту</FieldLabel>
                  <input value={deliveryUrl} onChange={e => setDeliveryUrl(e.target.value)} className={INPUT} />
                </Field>
                <Field>
                  <FieldLabel>Комментарий по материалам</FieldLabel>
                  <input value={materialsComment} onChange={e => setMaterialsComment(e.target.value)} className={INPUT} />
                </Field>
              </div>

              <p className={SECTION}>Правки</p>
              <div className="space-y-3">
                <Row>
                  <Field>
                    <FieldLabel>Включено итераций</FieldLabel>
                    <input type="number" min={0} value={revisionsIncluded} onChange={e => setRevisionsIncluded(e.target.value)} className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Использовано итераций</FieldLabel>
                    <input type="number" min={0} value={revisionsUsed} onChange={e => setRevisionsUsed(e.target.value)} className={INPUT} />
                  </Field>
                </Row>
                <Field>
                  <FieldLabel>Комментарий по текущим правкам</FieldLabel>
                  <textarea value={revisionsComment} onChange={e => setRevisionsComment(e.target.value)} rows={2} className={TEXTAREA} />
                </Field>
              </div>

              <p className={SECTION}>Комментарии</p>
              <div className="space-y-3">
                <Field>
                  <FieldLabel>Требования к монтажу</FieldLabel>
                  <textarea value={requirements} onChange={e => setRequirements(e.target.value)} rows={2} className={TEXTAREA} />
                </Field>
                <Field>
                  <FieldLabel>Внутренний комментарий</FieldLabel>
                  <textarea value={internalComment} onChange={e => setInternalComment(e.target.value)} rows={2} className={TEXTAREA} />
                </Field>
                <Field>
                  <FieldLabel>Комментарий клиенту</FieldLabel>
                  <textarea value={clientComment} onChange={e => setClientComment(e.target.value)} rows={2} className={TEXTAREA} />
                </Field>
              </div>
            </>
          )}
        </div>

        {showForm && (
          <div className="px-6 py-4 border-t border-zinc-800 flex-shrink-0 flex items-center gap-3">
            <button type="button" onClick={handleSave} disabled={saving} className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
              Отмена
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
