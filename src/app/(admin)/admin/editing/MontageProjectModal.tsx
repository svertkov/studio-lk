'use client'

import { useMemo, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import Link from 'next/link'
import { ChevronDown, Search, X, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createMontageProject, updateMontageProject, type MontageProjectDTO, type MontageProjectInput } from '@/lib/actions/montage'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { OrderDTO } from '@/lib/actions/orders'
import { getClients } from '@/lib/actions/clients'
import {
  MONTAGE_STATUS_ORDER, MONTAGE_STATUS_LABELS, MONTAGE_CLIENT_PAYMENT_STATUS_LABELS, MONTAGE_EDITOR_PAYMENT_STATUS_LABELS,
  computeMontageDeadline, computeMontageProfit,
  type MontageStatus, type MontageClientPaymentStatus, type MontageEditorPaymentStatus, type MontageDeadlineType,
} from '@/lib/montage-model'

// Те же геометрия/классы полей, что в OrderFormModal.tsx — единый визуальный
// язык форм-карточек платформы (h-10, zinc-800 фон, зелёный focus-border).
const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const SELECT = `${FIELD_BASE} pl-3 pr-9 text-zinc-200 cursor-pointer appearance-none`
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none'
const LABEL = 'block text-zinc-400 text-xs'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}
function FieldLabel({ children }: { children: ReactNode }) {
  return <label className={LABEL}>{children}</label>
}
function SelectField({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={SELECT}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
    </div>
  )
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}
function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  project: MontageProjectDTO | null
  orders: OrderDTO[]
  editors: EditorProfileListItemDTO[]
  // Нужен только чтобы предупредить о дубле при привязке НОВОГО проекта к
  // заказу, у которого уже есть проект(ы) — ТЗ п.18: "предупредить и не
  // создавать дубль без явного подтверждения".
  existingProjects: MontageProjectDTO[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export default function MontageProjectModal({ project, orders, editors, existingProjects, onOpenChange, onSaved }: Props) {
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
  const [contentType, setContentType] = useState(project?.contentType ?? '')
  const [status, setStatus] = useState<MontageStatus>(project?.status ?? 'NEW')

  const [editorId, setEditorId] = useState(project?.editorId ?? '')
  const [additionalEditorIds, setAdditionalEditorIds] = useState<string[]>(project?.additionalEditorIds ?? [])
  const [addEditorPick, setAddEditorPick] = useState('')

  const [sourceReceivedAt, setSourceReceivedAt] = useState(toDateInputValue(project?.sourceReceivedAt ?? null))
  const [startedAt, setStartedAt] = useState(toDateInputValue(project?.startedAt ?? null))
  const [deadlineType, setDeadlineType] = useState<'' | MontageDeadlineType>(project?.deadlineType ?? '')
  const [deadlineDateInput, setDeadlineDateInput] = useState(toDateInputValue(project?.deadlineDate ?? null))
  const [turnaroundDays, setTurnaroundDays] = useState(project?.turnaroundDays != null ? String(project.turnaroundDays) : '')
  const [completedAt, setCompletedAt] = useState(toDateInputValue(project?.completedAt ?? null))
  const [deliveredAt, setDeliveredAt] = useState(toDateInputValue(project?.deliveredAt ?? null))

  const [clientAmount, setClientAmount] = useState(project?.clientAmount != null ? String(project.clientAmount) : '')
  const [editorAmount, setEditorAmount] = useState(project?.editorAmount != null ? String(project.editorAmount) : '')
  const [clientPaymentStatus, setClientPaymentStatus] = useState<MontageClientPaymentStatus>(project?.clientPaymentStatus ?? 'NOT_SPECIFIED')
  const [editorPaymentStatus, setEditorPaymentStatus] = useState<MontageEditorPaymentStatus>(project?.editorPaymentStatus ?? 'NOT_CALCULATED')
  const [clientPaidAt, setClientPaidAt] = useState(toDateInputValue(project?.clientPaidAt ?? null))
  const [editorPaidAt, setEditorPaidAt] = useState(toDateInputValue(project?.editorPaidAt ?? null))
  const [paymentComment, setPaymentComment] = useState(project?.paymentComment ?? '')

  const [sourceMaterialsUrl, setSourceMaterialsUrl] = useState(project?.sourceMaterialsUrl ?? '')
  const [mountedMaterialNasUrl, setMountedMaterialNasUrl] = useState(project?.mountedMaterialNasUrl ?? '')
  const [deliveryUrl, setDeliveryUrl] = useState(project?.deliveryUrl ?? '')
  const [materialsComment, setMaterialsComment] = useState(project?.materialsComment ?? '')

  const [revisionsIncluded, setRevisionsIncluded] = useState(project?.revisionsIncluded != null ? String(project.revisionsIncluded) : '')
  const [revisionsUsed, setRevisionsUsed] = useState(String(project?.revisionsUsed ?? 0))
  const [revisionsComment, setRevisionsComment] = useState(project?.revisionsComment ?? '')

  const [requirements, setRequirements] = useState(project?.requirements ?? '')
  const [internalComment, setInternalComment] = useState(project?.internalComment ?? '')
  const [clientComment, setClientComment] = useState(project?.clientComment ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deadlinePreview = useMemo(() => computeMontageDeadline({
    sourceReceivedAt: sourceReceivedAt || null,
    deadlineType: deadlineType || null,
    deadlineDate: deadlineDateInput || null,
    turnaroundDays: turnaroundDays ? Number(turnaroundDays) : null,
  }), [sourceReceivedAt, deadlineType, deadlineDateInput, turnaroundDays])

  const profitPreview = computeMontageProfit(clientAmount ? Number(clientAmount) : null, editorAmount ? Number(editorAmount) : null)

  const duplicateOrderProjects = !isEdit && selectedOrderId
    ? existingProjects.filter(p => p.orderId === selectedOrderId)
    : []

  function addEditor(id: string) {
    if (!id || additionalEditorIds.includes(id) || id === editorId) return
    setAdditionalEditorIds(prev => [...prev, id])
    setAddEditorPick('')
  }
  function removeEditor(id: string) {
    setAdditionalEditorIds(prev => prev.filter(x => x !== id))
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
      status,
      editorId: editorId || null,
      additionalEditorIds,
      sourceReceivedAt: sourceReceivedAt || null,
      startedAt: startedAt || null,
      deadlineType: deadlineType || null,
      deadlineDate: deadlineDateInput || null,
      turnaroundDays: turnaroundDays ? Number(turnaroundDays) : null,
      completedAt: completedAt || null,
      deliveredAt: deliveredAt || null,
      clientAmount: clientAmount ? Number(clientAmount) : null,
      editorAmount: editorAmount ? Number(editorAmount) : null,
      clientPaymentStatus,
      editorPaymentStatus,
      clientPaidAt: clientPaidAt || null,
      editorPaidAt: editorPaidAt || null,
      paymentComment: paymentComment || undefined,
      sourceMaterialsUrl: sourceMaterialsUrl || null,
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

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-2xl max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0 pr-8">
          <DialogTitle className="text-white text-lg font-semibold">{title2}</DialogTitle>
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

          {((isEdit) || (linkMode === 'standalone' && selectedClientId) || (linkMode === 'order' && selectedOrder)) && (
            <>
              {error && <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 mb-3">{error}</p>}

              <p className={SECTION}>Основное</p>
              <div className="space-y-3">
                <Field>
                  <FieldLabel>Название проекта</FieldLabel>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Например: Монтаж подкаста от 07.10.2025" className={INPUT} />
                </Field>
                <Row>
                  <Field>
                    <FieldLabel>Тип контента</FieldLabel>
                    <input value={contentType} onChange={e => setContentType(e.target.value)} placeholder="Подкаст, рилсы, моушен-дизайн..." className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Статус</FieldLabel>
                    <SelectField value={status} onChange={e => setStatus(e.target.value as MontageStatus)}>
                      {MONTAGE_STATUS_ORDER.map(s => <option key={s} value={s}>{MONTAGE_STATUS_LABELS[s]}</option>)}
                    </SelectField>
                  </Field>
                </Row>
                <Field>
                  <FieldLabel>Описание / ТЗ по монтажу</FieldLabel>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={TEXTAREA} />
                </Field>
                {isEdit && project!.orderId && (
                  <Link href="/admin/crm" className="text-[#00c26b] hover:underline text-xs">Открыть связанный заказ в CRM →</Link>
                )}
              </div>

              <p className={SECTION}>Ответственный монтажёр</p>
              <div className="space-y-3">
                <Field>
                  <FieldLabel>Основной монтажёр</FieldLabel>
                  <SelectField value={editorId} onChange={e => setEditorId(e.target.value)}>
                    <option value="">Не назначен</option>
                    {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
                  </SelectField>
                </Field>
                <Field>
                  <FieldLabel>Дополнительные исполнители</FieldLabel>
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
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
                  <div className="flex gap-2">
                    <SelectField value={addEditorPick} onChange={e => addEditor(e.target.value)}>
                      <option value="">Добавить исполнителя...</option>
                      {editors.filter(ed => ed.id !== editorId && !additionalEditorIds.includes(ed.id)).map(ed => (
                        <option key={ed.id} value={ed.id}>{ed.displayName}</option>
                      ))}
                    </SelectField>
                  </div>
                </Field>
              </div>

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
                    <FieldLabel>Способ задания дедлайна</FieldLabel>
                    <SelectField value={deadlineType} onChange={e => setDeadlineType(e.target.value as '' | MontageDeadlineType)}>
                      <option value="">Не задан</option>
                      <option value="FIXED_DATE">Конкретная дата</option>
                      <option value="DURATION_DAYS">Количество дней от поступления</option>
                    </SelectField>
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
                      <input type="number" min={0} value={turnaroundDays} onChange={e => setTurnaroundDays(e.target.value)} className={INPUT} />
                    </Field>
                  )}
                </Row>
                {deadlinePreview && (
                  <p className="text-zinc-500 text-xs">Рассчитанный дедлайн: {deadlinePreview.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                )}
                <Row>
                  <Field>
                    <FieldLabel>Фактическая дата сдачи</FieldLabel>
                    <input type="date" value={deliveredAt} onChange={e => setDeliveredAt(e.target.value)} className={INPUT} />
                  </Field>
                  <Field>
                    <FieldLabel>Дата завершения работы</FieldLabel>
                    <input type="date" value={completedAt} onChange={e => setCompletedAt(e.target.value)} className={INPUT} />
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
                    <SelectField value={clientPaymentStatus} onChange={e => setClientPaymentStatus(e.target.value as MontageClientPaymentStatus)}>
                      {Object.entries(MONTAGE_CLIENT_PAYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </SelectField>
                  </Field>
                  <Field>
                    <FieldLabel>Выплата монтажёру</FieldLabel>
                    <SelectField value={editorPaymentStatus} onChange={e => setEditorPaymentStatus(e.target.value as MontageEditorPaymentStatus)}>
                      {Object.entries(MONTAGE_EDITOR_PAYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </SelectField>
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

              <p className={SECTION}>Материалы</p>
              <div className="space-y-3">
                <Field>
                  <FieldLabel>Ссылка на исходники {isEdit && project!.orderId && !sourceMaterialsUrl ? '(по умолчанию — со съёмки)' : ''}</FieldLabel>
                  <input value={sourceMaterialsUrl} onChange={e => setSourceMaterialsUrl(e.target.value)} placeholder="https://disk.yandex.ru/..." className={INPUT} />
                </Field>
                <Field>
                  <FieldLabel>Ссылка на NAS (финальный материал)</FieldLabel>
                  <input value={mountedMaterialNasUrl} onChange={e => setMountedMaterialNasUrl(e.target.value)} placeholder="\\\\nas\\..." className={INPUT} />
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

        {((isEdit) || (linkMode === 'standalone' && selectedClientId) || (linkMode === 'order' && selectedOrder)) && (
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
