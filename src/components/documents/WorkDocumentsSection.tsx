'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Plus, ScrollText, Layers, ChevronUp, ChevronDown, Trash2, Copy } from 'lucide-react'
import GlowPill from '@/components/ui/glow-pill'
import {
  getDocumentsForOrder, getDocumentsForMontageProject, getClientContractSummary, getCurrentUserRole,
  getOrderDocumentFlowType, getMontageDocumentMode,
  createDocument, updateDocument, updateOrderDocumentFlowType, updateMontageDocumentMode,
  addInvoiceLineItem, updateInvoiceLineItem, removeInvoiceLineItem, reorderInvoiceLineItems,
  createActFromInvoice, copyInvoiceLineItemsIntoAct,
  type DocumentDTO, type ClientContractSummary, type InvoiceLineItemDTO,
} from '@/lib/actions/documents'
import AppendixEditDialog from './AppendixEditDialog'
import DocumentNumberEditDialog from './DocumentNumberEditDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getOrder, type OrderDTO } from '@/lib/actions/orders'
import { getMontageProjectsForOrder, type MontageProjectDTO } from '@/lib/actions/montage'
import { orderShootDisplay } from '@/lib/order-model'
import {
  DOCUMENT_FLOW_TYPE_LABELS, MONTAGE_DOCUMENT_MODE_LABELS, DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_OPTIONS_BY_TYPE, INVOICE_PURPOSE_LABELS, DOCUMENT_PAYMENT_STATE_LABELS,
  CLIENT_CONTRACT_STATE_LABELS, getContractStateColor, getDocumentPaymentState,
  INVOICE_LINE_ITEM_UNIT_LABELS, VAT_RATE_LABELS, computeLineItemTotal, computeLineItemsTotal,
  type DocumentFlowType, type MontageDocumentMode, type DocumentType, type DocumentStatus, type InvoicePurpose,
  type InvoiceLineItemUnit, type VatRate,
} from '@/lib/document-model'

const SELECT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-2.5 text-xs outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const INPUT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-2.5 text-xs outline-none focus:border-[#00c26b] transition-colors'

function formatDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

// ============================================================
// ЧЕРНОВИК СТРОК СЧЁТА/АКТА — до 2026-07-23 строки можно было добавлять
// только к УЖЕ созданному документу (см. addInvoiceLineItem). Теперь форма
// создания сама держит массив ещё не сохранённых строк в обычном React
// state (без автосохранения — см. AGENTS.md, тот же принцип, что и у прежних
// create-форм) и отправляет их вместе с реквизитами одним вызовом
// createDocument — сервер создаёт документ и все строки одной транзакцией.
// ============================================================

interface DraftLineItem {
  key: string
  description: string
  quantity: string
  unit: InvoiceLineItemUnit
  customUnitLabel: string
  unitPrice: string
  vatRate: VatRate
}

function makeDraftKey(): string {
  return Math.random().toString(36).slice(2)
}

function emptyDraftLineItem(): DraftLineItem {
  return { key: makeDraftKey(), description: '', quantity: '1', unit: 'SERVICE', customUnitLabel: '', unitPrice: '', vatRate: 'NOT_APPLICABLE' }
}

function lineItemsToDraft(items: InvoiceLineItemDTO[]): DraftLineItem[] {
  return items.map(li => ({
    key: makeDraftKey(),
    description: li.description,
    quantity: String(li.quantity),
    unit: li.unit,
    customUnitLabel: li.customUnitLabel ?? '',
    unitPrice: String(li.unitPrice),
    vatRate: li.vatRate,
  }))
}

function draftLineItemsTotal(items: DraftLineItem[]): number {
  return computeLineItemsTotal(items.map(d => ({ quantity: Number(d.quantity) || 0, unitPrice: Number(d.unitPrice) || 0 })))
}

// Пустые строки (ничего не введено) отбрасываются молча — черновик может
// содержать "лишнюю" пустую строку, которую пользователь так и не заполнил.
function draftLineItemsToInput(items: DraftLineItem[]) {
  return items
    .filter(d => d.description.trim() || Number(d.unitPrice) > 0)
    .map(d => ({
      description: d.description,
      quantity: Number(d.quantity) || 1,
      unit: d.unit,
      customUnitLabel: d.unit === 'OTHER' ? d.customUnitLabel : null,
      unitPrice: Number(d.unitPrice) || 0,
      vatRate: d.vatRate,
    }))
}

// Общие с существующим (пост-создание) быстрым заполнением построители текста
// съёмки/монтажа — раньше жили только внутри DocumentLineItemsEditor, теперь
// нужны и черновику ещё не созданного документа (см. AGENTS.md, единый
// источник данных, не дублировать).
function buildShootDescriptionAndPrice(order: OrderDTO): { description: string; unitPrice: number } {
  const shoot = orderShootDisplay(order)
  const durationLabel = order.durationMinutes ? `${Math.round(order.durationMinutes / 6) / 10} ч.` : null
  const dateLabel = order.plannedStartTime ? formatDate(order.plannedStartTime) : null
  const description = [
    'Видеосъёмка', dateLabel,
    shoot.room && shoot.room !== 'Не указан' ? shoot.room : null,
    shoot.format !== 'Не указан' ? shoot.format : null,
    order.camerasCount ? `${order.camerasCount} кам.` : null,
    durationLabel,
  ].filter(Boolean).join(', ')
  return { description, unitPrice: order.preliminaryAmount ?? 0 }
}

// Клиентская стоимость монтажа (НЕ выплата монтажёру) активного (не
// CANCELLED) проекта — null означает "нет проекта монтажа", кнопка не должна
// ничего добавлять в этом случае.
function findActiveMontageClientAmount(projects: MontageProjectDTO[]): number | null {
  const active = projects.find(p => p.status !== 'CANCELLED')
  return active ? (active.clientAmount ?? 0) : null
}

interface CreateFormState {
  issueDate: string
  purpose: InvoicePurpose
  // Только APPENDIX по-прежнему использует свободную ручную сумму — у INVOICE
  // сумма с 2026-07-23 считается исключительно по строкам (см. handleCreate,
  // AGENTS.md "Реестр документов"), поэтому это поле больше не показывается
  // и не отправляется для типа INVOICE, но само состояние формы общее для
  // обоих create-блоков, как и раньше.
  amount: string
  status: DocumentStatus
  comment: string
  serviceDescription: string
  number: string
}

function defaultCreateForm(): CreateFormState {
  return { issueDate: new Date().toISOString().slice(0, 10), purpose: 'FULL_PAYMENT', amount: '', status: 'DRAFT', comment: '', serviceDescription: '', number: '' }
}

const TEXTAREA = 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#00c26b] transition-colors w-full resize-none'

interface Props {
  clientId: string | null
  orderId?: string | null
  montageProjectId?: string | null
  // Вызывается перед открытием редактора приложения (вложенный Dialog поверх
  // текущей карточки) — родительские модалки с автосохранением передают сюда
  // autosave.flush (тот же приём, что уже используют кнопки "Открыть карточку
  // клиента"/"Создать нового клиента" в OrderFormModal/EventCardModal).
  // MontageProjectModal автосохранения не имеет — там проп просто не передаётся.
  onBeforeEditRelated?: () => unknown | Promise<unknown>
}

// Общий блок "Документы" для карточки заказа (OrderFormModal/EventCardModal)
// и карточки проекта монтажа (MontageProjectModal) — первый переиспользуемый
// содержательный блок между модалками в проекте (см. AGENTS.md). Полностью
// самодостаточен: сам загружает данные и сохраняет изменения по месту, не
// встроен в Save родительской формы (тот же принцип, что overlay-действия
// MontageProjectModal — пауза/отмена/архив).
export default function WorkDocumentsSection({ clientId, orderId, montageProjectId, onBeforeEditRelated }: Props) {
  const [documents, setDocuments] = useState<DocumentDTO[] | null>(null)
  const [contractSummary, setContractSummary] = useState<ClientContractSummary | null>(null)
  const [flowType, setFlowType] = useState<DocumentFlowType>('UNKNOWN')
  const [modeType, setModeType] = useState<MontageDocumentMode>('UNKNOWN')
  const [creatingType, setCreatingType] = useState<DocumentType | null>(null)
  const [form, setForm] = useState<CreateFormState>(defaultCreateForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appendixExpanded, setAppendixExpanded] = useState(false)
  const [canEditAppendix, setCanEditAppendix] = useState(false)
  const [appendixEditOpen, setAppendixEditOpen] = useState(false)
  const [appendixUpdatedFlash, setAppendixUpdatedFlash] = useState(false)
  const [editingNumberDoc, setEditingNumberDoc] = useState<DocumentDTO | null>(null)
  const [creatingActFromInvoiceId, setCreatingActFromInvoiceId] = useState<string | null>(null)
  const [createExtraExpanded, setCreateExtraExpanded] = useState(false)
  const [draftLineItems, setDraftLineItems] = useState<DraftLineItem[]>([])
  // Подтверждение "заменить/добавить/отмена" при повторном выборе счёта,
  // когда в черновике акта (ещё не созданного) уже есть непустые строки.
  const [pendingCopyInvoiceForDraft, setPendingCopyInvoiceForDraft] = useState<DocumentDTO | null>(null)
  // То же самое, но для УЖЕ существующего акта — здесь нужен реальный
  // серверный вызов (copyInvoiceLineItemsIntoAct), а не правка локального
  // массива, поэтому состояние держит и акт, и выбранный счёт.
  const [copyIntoActState, setCopyIntoActState] = useState<{ act: DocumentDTO; invoice: DocumentDTO } | null>(null)
  const [copyingIntoActId, setCopyingIntoActId] = useState<string | null>(null)

  const workRef = orderId ? { orderId } : montageProjectId ? { montageProjectId } : null

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (orderId) {
        const [docsResult, flowResult] = await Promise.all([getDocumentsForOrder(orderId), getOrderDocumentFlowType(orderId)])
        if (!cancelled) {
          setDocuments(docsResult.data)
          if (flowResult.ok) setFlowType(flowResult.data)
        }
      } else if (montageProjectId) {
        const [docsResult, modeResult] = await Promise.all([getDocumentsForMontageProject(montageProjectId), getMontageDocumentMode(montageProjectId)])
        if (!cancelled) {
          setDocuments(docsResult.data)
          if (modeResult.ok) setModeType(modeResult.data)
        }
      }
      if (clientId) {
        const result = await getClientContractSummary(clientId)
        if (!cancelled && result.ok) setContractSummary(result.data)
      }
      // Кнопка "Редактировать" у приложения — только OWNER/ADMIN (см.
      // AGENTS.md). Реальная проверка всё равно на сервере в updateDocument —
      // это только скрытие кнопки, не единственная защита.
      const role = await getCurrentUserRole()
      if (!cancelled) setCanEditAppendix(role === 'OWNER' || role === 'ADMIN')
    }
    load()
    return () => { cancelled = true }
  }, [orderId, montageProjectId, clientId])

  function handleAppendixUpdated(doc: DocumentDTO) {
    setDocuments(prev => prev?.map(d => (d.id === doc.id ? doc : d)) ?? null)
    setAppendixUpdatedFlash(true)
    setTimeout(() => setAppendixUpdatedFlash(false), 2000)
  }

  async function handleOpenAppendixEdit() {
    await onBeforeEditRelated?.()
    setAppendixEditOpen(true)
  }

  async function handleFlowTypeChange(next: DocumentFlowType) {
    setFlowType(next)
    if (orderId) await updateOrderDocumentFlowType(orderId, next)
  }

  async function handleModeChange(next: MontageDocumentMode) {
    setModeType(next)
    if (montageProjectId) await updateMontageDocumentMode(montageProjectId, next)
  }

  // Открытие/закрытие create-формы — один хелпер вместо трёх копий
  // setCreatingType(...), т.к. теперь нужно параллельно сбрасывать/сеять
  // черновик строк и выставлять статус по умолчанию для конкретного типа
  // (NOT_PREPARED для акта, DRAFT для счёта — ACT никогда не наследует
  // статус-по-умолчанию счёта и наоборот).
  function handleToggleCreating(type: DocumentType) {
    if (creatingType === type) {
      setCreatingType(null)
      setDraftLineItems([])
      setCreateExtraExpanded(false)
      setError(null)
      return
    }
    setCreatingType(type)
    setDraftLineItems(type === 'INVOICE' || type === 'ACT' ? [emptyDraftLineItem()] : [])
    setCreateExtraExpanded(false)
    setError(null)
    setForm(f => ({ ...f, status: type === 'ACT' ? 'NOT_PREPARED' : type === 'INVOICE' ? 'DRAFT' : f.status }))
  }

  async function handleCreate(type: DocumentType) {
    const activeContractId = contractSummary?.activeContractId ?? null
    if (type === 'APPENDIX' && !activeContractId) return
    if (type !== 'APPENDIX' && !workRef) return
    setSaving(true)
    setError(null)
    const result = await createDocument({
      type,
      ...(workRef ?? {}),
      contractId: type === 'APPENDIX' ? activeContractId : undefined,
      issueDate: form.issueDate,
      purpose: type === 'INVOICE' ? form.purpose : undefined,
      status: type === 'INVOICE' || type === 'ACT' ? form.status : undefined,
      // INVOICE больше не принимает ручную сумму при создании — с 2026-07-23
      // Document.amount для счёта/акта формируется исключительно строками
      // (InvoiceLineItem, см. lineItems ниже) через recomputeDocumentAmount,
      // отдельного ручного источника-дублёра быть не должно (см. AGENTS.md,
      // "Реестр документов"). APPENDIX по-прежнему без строк — сумма
      // остаётся ручной.
      amount: type === 'APPENDIX' && form.amount ? Number(form.amount) : null,
      serviceDescription: form.serviceDescription.trim() || null,
      comment: form.comment.trim() || null,
      number: (type === 'INVOICE' || type === 'ACT') && form.number.trim() ? form.number.trim() : undefined,
      lineItems: type === 'INVOICE' || type === 'ACT' ? draftLineItemsToInput(draftLineItems) : undefined,
    })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    // Полный перезапрос, а не просто добавление нового элемента в локальный
    // стейт: создание второго счёта задним числом присваивает суффикс "1"
    // первому (см. assignInvoiceSuffixIfNeeded, actions/documents.ts) — если
    // не перезапросить список, УЖЕ показанный первый счёт продолжит отображать
    // устаревший номер без суффикса до перезагрузки страницы.
    if (orderId) {
      const refreshed = await getDocumentsForOrder(orderId)
      setDocuments(refreshed.data)
    } else if (montageProjectId) {
      const refreshed = await getDocumentsForMontageProject(montageProjectId)
      setDocuments(refreshed.data)
    }
    setCreatingType(null)
    setForm(defaultCreateForm())
    setCreateExtraExpanded(false)
    setDraftLineItems([])
  }

  // Выбор счёта для копирования в ЧЕРНОВИК ещё не созданного акта — целиком
  // на клиенте (черновик и так живёт в draftLineItems), новый сервер не
  // нужен (см. AGENTS.md, "услуги — обязательная часть счёта/акта"). Если в
  // черновике уже есть непустые строки — сначала спросить, что делать.
  function handlePickInvoiceForActDraft(invoice: DocumentDTO) {
    const hasContent = draftLineItems.some(d => d.description.trim() || Number(d.unitPrice) > 0)
    if (!hasContent) {
      applyInvoiceCopyToDraft(invoice, 'REPLACE')
      return
    }
    setPendingCopyInvoiceForDraft(invoice)
  }

  function applyInvoiceCopyToDraft(invoice: DocumentDTO, mode: 'REPLACE' | 'APPEND') {
    const copied = lineItemsToDraft(invoice.lineItems)
    setDraftLineItems(prev => (mode === 'REPLACE' ? copied : [...prev, ...copied]))
    setForm(f => ({
      ...f,
      number: f.number.trim() ? f.number : (invoice.displayNumber === 'Без номера' ? f.number : invoice.displayNumber.replace(/^№/, '')),
      serviceDescription: f.serviceDescription.trim() ? f.serviceDescription : (invoice.serviceDescription ?? f.serviceDescription),
    }))
    setPendingCopyInvoiceForDraft(null)
  }

  // То же самое действие, но для УЖЕ созданного акта — здесь нужен реальный
  // серверный вызов (см. copyInvoiceLineItemsIntoAct, actions/documents.ts),
  // локальным стейтом уже не обойтись.
  function handlePickInvoiceForExistingAct(act: DocumentDTO, invoice: DocumentDTO) {
    if (act.lineItems.length === 0) {
      void applyServerCopyIntoAct(act.id, invoice.id, 'REPLACE')
      return
    }
    setCopyIntoActState({ act, invoice })
  }

  async function applyServerCopyIntoAct(actId: string, invoiceId: string, mode: 'REPLACE' | 'APPEND') {
    setCopyingIntoActId(actId)
    const result = await copyInvoiceLineItemsIntoAct({ invoiceId, actId, mode })
    setCopyingIntoActId(null)
    setCopyIntoActState(null)
    if (result.ok) setDocuments(prev => prev?.map(d => (d.id === actId ? result.data : d)) ?? null)
  }

  async function handleStatusChange(doc: DocumentDTO, status: DocumentStatus) {
    const result = await updateDocument({ id: doc.id, status })
    if (result.ok) setDocuments(prev => prev?.map(d => (d.id === doc.id ? result.data : d)) ?? null)
  }

  // Одноразовый snapshot (см. createActFromInvoice, actions/documents.ts) —
  // не живая синхронизация. Полный перезапрос списка, а не просто добавление
  // локально, по той же причине, что и у handleCreate выше (номер/суффиксы
  // могут затронуть уже отображённые документы).
  async function handleCreateActFromInvoice(invoiceId: string) {
    setCreatingActFromInvoiceId(invoiceId)
    setError(null)
    const result = await createActFromInvoice(invoiceId)
    setCreatingActFromInvoiceId(null)
    if (!result.ok) { setError(result.error); return }
    if (orderId) {
      const refreshed = await getDocumentsForOrder(orderId)
      setDocuments(refreshed.data)
    } else if (montageProjectId) {
      const refreshed = await getDocumentsForMontageProject(montageProjectId)
      setDocuments(refreshed.data)
    }
  }

  if (documents === null) {
    return <div className="text-zinc-500 text-xs py-2">Загрузка документов…</div>
  }

  const invoices = documents.filter(d => d.type === 'INVOICE')
  const acts = documents.filter(d => d.type === 'ACT')
  // Приложение этой конкретной работы — компонент встроен в один
  // заказ/проект монтажа за раз, поэтому берём первое найденное (в
  // подавляющем большинстве случаев оно единственное).
  const appendix = documents.find(d => d.type === 'APPENDIX') ?? null
  const invoiceWithDescription = invoices.find(i => i.serviceDescription) ?? null

  return (
    <>
    <div className="space-y-4">
      <h3 className="text-white font-semibold text-sm flex items-center gap-2">
        <FileText className="w-4 h-4 text-zinc-500" />
        Документы
      </h3>

      {/* Основание работы — договор клиента, только чтение + ссылка */}
      {clientId && contractSummary && (
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ScrollText className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
            <GlowPill size="sm" color={getContractStateColor(contractSummary.clientType, contractSummary.contractState)}>
              {CLIENT_CONTRACT_STATE_LABELS[contractSummary.contractState as keyof typeof CLIENT_CONTRACT_STATE_LABELS]}
            </GlowPill>
            {contractSummary.activeContractDisplayNumber && (
              <span className="text-zinc-300 text-xs">Договор {contractSummary.activeContractDisplayNumber}</span>
            )}
          </div>
          <Link href={`/admin/clients/${clientId}?tab=documents`} className="text-[#00c26b] text-xs hover:underline">
            Документы клиента →
          </Link>
        </div>
      )}

      {/* Режим документооборота работы */}
      {orderId && (
        <div className="flex items-center gap-2">
          <label className="text-zinc-400 text-xs flex-shrink-0">Документы для этой работы:</label>
          <select className={SELECT} value={flowType} onChange={e => handleFlowTypeChange(e.target.value as DocumentFlowType)}>
            {(Object.keys(DOCUMENT_FLOW_TYPE_LABELS) as DocumentFlowType[]).map(v => (
              <option key={v} value={v}>{DOCUMENT_FLOW_TYPE_LABELS[v]}</option>
            ))}
          </select>
        </div>
      )}
      {montageProjectId && (
        <div className="flex items-center gap-2">
          <label className="text-zinc-400 text-xs flex-shrink-0">Документы монтажа:</label>
          <select className={SELECT} value={modeType} onChange={e => handleModeChange(e.target.value as MontageDocumentMode)}>
            {(Object.keys(MONTAGE_DOCUMENT_MODE_LABELS) as MontageDocumentMode[]).map(v => (
              <option key={v} value={v}>{MONTAGE_DOCUMENT_MODE_LABELS[v]}</option>
            ))}
          </select>
        </div>
      )}

      {(montageProjectId ? modeType !== 'INCLUDED_IN_ORDER' : true) && (montageProjectId ? modeType !== 'NOT_REQUIRED' : true) && (
        <>
          {/* Приложение к договору — промежуточное звено между договором и
              счётом/актом; номер сквозной в рамках договора, а не этой работы
              (см. document-model.ts). Одноразовое копирование описания услуги
              в формы счёта/акта ниже — не постоянная синхронизация. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-zinc-400 text-xs uppercase tracking-wide flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Приложение
              </p>
              {!appendix && creatingType !== 'APPENDIX' && contractSummary?.activeContractId && (
                <button type="button" onClick={() => handleToggleCreating('APPENDIX')} className="flex items-center gap-1 text-[#00c26b] text-xs hover:underline">
                  <Plus className="w-3 h-3" /> Добавить приложение
                </button>
              )}
            </div>
            {appendix && (
              <div className="bg-zinc-800/40 rounded-lg px-3 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-zinc-200 text-xs flex-shrink-0">{appendix.displayNumber}</p>
                    <p className="text-zinc-500 text-[11px] truncate">{formatDate(appendix.issueDate)} · {formatMoney(appendix.amount)}</p>
                  </div>
                  {canEditAppendix && (
                    <button type="button" onClick={handleOpenAppendixEdit}
                      title="Редактировать приложение"
                      className="text-zinc-400 hover:text-[#00c26b] text-[11px] underline underline-offset-2 flex-shrink-0 transition-colors">
                      Редактировать
                    </button>
                  )}
                </div>
                {appendixUpdatedFlash && <p className="text-[#00c26b] text-[11px]">Приложение обновлено</p>}
                {appendix.serviceDescription && (
                  <div>
                    <p className={`text-zinc-400 text-[11px] leading-snug whitespace-pre-wrap break-words ${!appendixExpanded && appendix.serviceDescription.length > 140 ? 'line-clamp-2' : ''}`}>
                      {appendix.serviceDescription}
                    </p>
                    {appendix.serviceDescription.length > 140 && (
                      <button type="button" onClick={() => setAppendixExpanded(v => !v)} className="text-[#00c26b] text-[11px] hover:underline mt-0.5">
                        {appendixExpanded ? 'Свернуть' : 'Показать полностью'}
                      </button>
                    )}
                  </div>
                )}
                {appendix.comment && <p className="text-zinc-500 text-[11px]">{appendix.comment}</p>}
              </div>
            )}
            {!appendix && creatingType !== 'APPENDIX' && (
              <p className="text-zinc-600 text-xs">
                {contractSummary?.activeContractId ? 'Приложений нет' : 'Сначала оформите договор клиенту'}
              </p>
            )}
            {creatingType === 'APPENDIX' && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className={INPUT} value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
                  <input type="number" placeholder="Сумма" className={INPUT} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <textarea rows={2} placeholder="Описание услуги" className={TEXTAREA} value={form.serviceDescription} onChange={e => setForm(f => ({ ...f, serviceDescription: e.target.value }))} />
                <input placeholder="Комментарий" className={`${INPUT} w-full`} value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} />
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => handleToggleCreating('APPENDIX')} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1.5">Отмена</button>
                  <button type="button" disabled={saving} onClick={() => handleCreate('APPENDIX')} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                    {saving ? 'Сохранение…' : 'Создать приложение'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Счета */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-zinc-400 text-xs uppercase tracking-wide">Счета</p>
              <button type="button" onClick={() => handleToggleCreating('INVOICE')} className="flex items-center gap-1 text-[#00c26b] text-xs hover:underline">
                <Plus className="w-3 h-3" /> Добавить счёт
              </button>
            </div>
            {invoices.map(inv => {
              const paymentState = getDocumentPaymentState(inv.orderPaymentStatus, inv.montagePaymentStatus)
              return (
                <div key={inv.id} className="bg-zinc-800/40 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-zinc-200 text-xs flex items-center gap-1.5">
                        {inv.displayNumber} {inv.purpose && `· ${INVOICE_PURPOSE_LABELS[inv.purpose]}`}
                        {canEditAppendix && (
                          <button type="button" onClick={() => setEditingNumberDoc(inv)} className="text-zinc-500 hover:text-[#00c26b] text-[11px] underline underline-offset-2 transition-colors">
                            Изменить номер
                          </button>
                        )}
                      </p>
                      <p className="text-zinc-500 text-[11px] mt-0.5">{formatDate(inv.issueDate)} · {formatMoney(inv.amount)} · Оплата: {DOCUMENT_PAYMENT_STATE_LABELS[paymentState]}</p>
                    </div>
                    <select className={`${SELECT} flex-shrink-0`} value={inv.status} onChange={e => handleStatusChange(inv, e.target.value as DocumentStatus)}>
                      {DOCUMENT_STATUS_OPTIONS_BY_TYPE.INVOICE.map(s => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <DocumentLineItemsEditor
                    document={inv}
                    orderId={orderId ?? null}
                    appendix={appendix}
                    onUpdated={doc => setDocuments(prev => prev?.map(d => (d.id === doc.id ? doc : d)) ?? null)}
                  />
                  {acts.length === 0 && inv.status !== 'CANCELLED' && (
                    <button type="button" disabled={creatingActFromInvoiceId === inv.id} onClick={() => handleCreateActFromInvoice(inv.id)}
                      className="mt-2 flex items-center gap-1 text-[#00c26b] text-[11px] hover:underline disabled:opacity-50">
                      <Plus className="w-3 h-3" /> {creatingActFromInvoiceId === inv.id ? 'Создаём акт…' : `Создать акт на основании счёта ${inv.displayNumber}`}
                    </button>
                  )}
                </div>
              )
            })}
            {invoices.length === 0 && creatingType !== 'INVOICE' && <p className="text-zinc-600 text-xs">Счетов нет</p>}
            {creatingType === 'INVOICE' && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-zinc-500 text-[11px]">Дата счёта</label>
                    <input type="date" className={`${INPUT} w-full`} value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-zinc-500 text-[11px]">Номер счёта (необязательно)</label>
                    <input placeholder="напр. 2026-014" className={`${INPUT} w-full`} value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-zinc-500 text-[11px]">Назначение платежа</label>
                    <select className={`${SELECT} w-full`} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value as InvoicePurpose }))}>
                      {(Object.keys(INVOICE_PURPOSE_LABELS) as InvoicePurpose[]).map(p => <option key={p} value={p}>{INVOICE_PURPOSE_LABELS[p]}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-zinc-500 text-[11px]">Статус счёта</label>
                    <select className={`${SELECT} w-full`} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as DocumentStatus }))}>
                      {DOCUMENT_STATUS_OPTIONS_BY_TYPE.INVOICE.map(s => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                </div>
                <p className="text-zinc-400 text-xs uppercase tracking-wide">Товары и услуги</p>
                <DraftLineItemsSection items={draftLineItems} onChangeItems={setDraftLineItems} orderId={orderId ?? null} appendix={appendix} />
                <button type="button" onClick={() => setCreateExtraExpanded(v => !v)} className="text-zinc-400 hover:text-[#00c26b] text-[11px] hover:underline">
                  {createExtraExpanded ? 'Скрыть дополнительно' : 'Дополнительно (описание, комментарий)'}
                </button>
                {createExtraExpanded && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-zinc-500 text-[11px]">Описание услуги</label>
                        {appendix?.serviceDescription && (
                          <button type="button" onClick={() => setForm(f => ({ ...f, serviceDescription: appendix.serviceDescription ?? '' }))} className="text-[#00c26b] text-[11px] hover:underline">
                            Заполнить из приложения
                          </button>
                        )}
                      </div>
                      <textarea rows={2} className={TEXTAREA} value={form.serviceDescription} onChange={e => setForm(f => ({ ...f, serviceDescription: e.target.value }))} />
                    </div>
                    <input placeholder="Комментарий" className={`${INPUT} w-full`} value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} />
                  </div>
                )}
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => handleToggleCreating('INVOICE')} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1.5">Отмена</button>
                  <button type="button" disabled={saving} onClick={() => handleCreate('INVOICE')} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                    {saving ? 'Сохранение…' : 'Создать счёт'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Акты */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-zinc-400 text-xs uppercase tracking-wide">Акты</p>
              <button type="button" onClick={() => handleToggleCreating('ACT')} className="flex items-center gap-1 text-[#00c26b] text-xs hover:underline">
                <Plus className="w-3 h-3" /> Добавить акт
              </button>
            </div>
            {acts.map(act => (
              <div key={act.id} className="bg-zinc-800/40 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-zinc-200 text-xs flex items-center gap-1.5">
                      {act.displayNumber}
                      {canEditAppendix && (
                        <button type="button" onClick={() => setEditingNumberDoc(act)} className="text-zinc-500 hover:text-[#00c26b] text-[11px] underline underline-offset-2 transition-colors">
                          Изменить номер
                        </button>
                      )}
                    </p>
                    <p className="text-zinc-500 text-[11px] mt-0.5">
                      {formatDate(act.issueDate)}
                      {act.sourceInvoiceId && ` · из счёта ${invoices.find(i => i.id === act.sourceInvoiceId)?.displayNumber ?? ''}`}
                    </p>
                  </div>
                  <select className={`${SELECT} flex-shrink-0`} value={act.status} onChange={e => handleStatusChange(act, e.target.value as DocumentStatus)}>
                    {DOCUMENT_STATUS_OPTIONS_BY_TYPE.ACT.map(s => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <DocumentLineItemsEditor
                  document={act}
                  orderId={orderId ?? null}
                  appendix={appendix}
                  onUpdated={doc => setDocuments(prev => prev?.map(d => (d.id === doc.id ? doc : d)) ?? null)}
                />
                {invoices.length > 0 && (
                  <div className="mt-1">
                    <InvoiceCopySourcePicker
                      invoices={invoices}
                      disabled={copyingIntoActId === act.id}
                      onPick={inv => handlePickInvoiceForExistingAct(act, inv)}
                    />
                  </div>
                )}
              </div>
            ))}
            {acts.length === 0 && creatingType !== 'ACT' && <p className="text-zinc-600 text-xs">Актов нет</p>}
            {creatingType === 'ACT' && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-zinc-500 text-[11px]">Дата акта</label>
                    <input type="date" className={`${INPUT} w-full`} value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-zinc-500 text-[11px]">Номер акта (необязательно)</label>
                    <input placeholder="напр. 2026-014" className={`${INPUT} w-full`} value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-zinc-500 text-[11px]">Статус акта</label>
                  <select className={`${SELECT} w-full`} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as DocumentStatus }))}>
                    {DOCUMENT_STATUS_OPTIONS_BY_TYPE.ACT.map(s => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <p className="text-zinc-400 text-xs uppercase tracking-wide">Товары и услуги</p>
                <DraftLineItemsSection
                  items={draftLineItems}
                  onChangeItems={setDraftLineItems}
                  orderId={orderId ?? null}
                  appendix={appendix}
                  extraQuickActions={invoices.length > 0 ? <InvoiceCopySourcePicker invoices={invoices} onPick={handlePickInvoiceForActDraft} /> : undefined}
                />
                <button type="button" onClick={() => setCreateExtraExpanded(v => !v)} className="text-zinc-400 hover:text-[#00c26b] text-[11px] hover:underline">
                  {createExtraExpanded ? 'Скрыть дополнительно' : 'Дополнительно (описание, комментарий)'}
                </button>
                {createExtraExpanded && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <label className="text-zinc-500 text-[11px]">Описание услуги</label>
                        <div className="flex items-center gap-2">
                          {invoiceWithDescription && (
                            <button type="button" onClick={() => setForm(f => ({ ...f, serviceDescription: invoiceWithDescription.serviceDescription ?? '' }))} className="text-[#00c26b] text-[11px] hover:underline">
                              Заполнить из счёта
                            </button>
                          )}
                          {appendix?.serviceDescription && (
                            <button type="button" onClick={() => setForm(f => ({ ...f, serviceDescription: appendix.serviceDescription ?? '' }))} className="text-[#00c26b] text-[11px] hover:underline">
                              Заполнить из приложения
                            </button>
                          )}
                        </div>
                      </div>
                      <textarea rows={2} className={TEXTAREA} value={form.serviceDescription} onChange={e => setForm(f => ({ ...f, serviceDescription: e.target.value }))} />
                    </div>
                    <input placeholder="Комментарий" className={`${INPUT} w-full`} value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} />
                  </div>
                )}
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => handleToggleCreating('ACT')} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1.5">Отмена</button>
                  <button type="button" disabled={saving} onClick={() => handleCreate('ACT')} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                    {saving ? 'Сохранение…' : 'Создать акт'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {montageProjectId && modeType === 'INCLUDED_IN_ORDER' && (
        <p className="text-zinc-500 text-xs">Документы монтажа включены в комплект основного заказа — отдельные счёт/акт не требуются.</p>
      )}
      {montageProjectId && modeType === 'NOT_REQUIRED' && (
        <p className="text-zinc-500 text-xs">Документы для этого проекта не требуются.</p>
      )}
    </div>
    {appendix && (
      <AppendixEditDialog
        open={appendixEditOpen}
        onOpenChange={setAppendixEditOpen}
        appendix={appendix}
        clientId={clientId}
        onUpdated={handleAppendixUpdated}
      />
    )}
    {editingNumberDoc && (
      <DocumentNumberEditDialog
        open={!!editingNumberDoc}
        onOpenChange={next => { if (!next) setEditingNumberDoc(null) }}
        document={editingNumberDoc}
        onUpdated={doc => { setDocuments(prev => prev?.map(d => (d.id === doc.id ? doc : d)) ?? null); setEditingNumberDoc(null) }}
      />
    )}
    {pendingCopyInvoiceForDraft && (
      <LineItemsCopyChoiceDialog
        open={!!pendingCopyInvoiceForDraft}
        onOpenChange={next => { if (!next) setPendingCopyInvoiceForDraft(null) }}
        invoiceLabel={pendingCopyInvoiceForDraft.displayNumber}
        onReplace={() => applyInvoiceCopyToDraft(pendingCopyInvoiceForDraft, 'REPLACE')}
        onAppend={() => applyInvoiceCopyToDraft(pendingCopyInvoiceForDraft, 'APPEND')}
      />
    )}
    {copyIntoActState && (
      <LineItemsCopyChoiceDialog
        open={!!copyIntoActState}
        onOpenChange={next => { if (!next) setCopyIntoActState(null) }}
        invoiceLabel={copyIntoActState.invoice.displayNumber}
        onReplace={() => applyServerCopyIntoAct(copyIntoActState.act.id, copyIntoActState.invoice.id, 'REPLACE')}
        onAppend={() => applyServerCopyIntoAct(copyIntoActState.act.id, copyIntoActState.invoice.id, 'APPEND')}
      />
    )}
    </>
  )
}

type LineItemPatch = Partial<{ description: string; quantity: number; unit: InvoiceLineItemUnit; customUnitLabel: string | null; unitPrice: number; vatRate: VatRate }>

// Строки счёта/акта — список (добавить/убрать/переставить) + кнопки быстрого
// заполнения (ТЗ, ранее отложено пользователем — см. AGENTS.md/память,
// теперь запрошено явно). Полностью самодостаточный overlay поверх одного
// конкретного документа: сохраняет каждое изменение сразу через свои
// собственные действия, возвращая родителю обновлённый DocumentDTO целиком
// (amount пересчитан сервером — см. recomputeDocumentAmount,
// actions/documents.ts), а не патчит локальный стейт вручную, чтобы не
// разойтись с сервером. 2026-07-23: переименован из InvoiceLineItemsEditor —
// компонент и раньше был type-agnostic (addInvoiceLineItem и т.п. работают
// по documentId, не по типу), теперь рендерится и для ACT, а не только для
// INVOICE, старое имя стало вводить в заблуждение.
function DocumentLineItemsEditor({
  document: doc, orderId, appendix, onUpdated,
}: {
  document: DocumentDTO
  orderId: string | null
  appendix: DocumentDTO | null
  onUpdated: (doc: DocumentDTO) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [newQuantity, setNewQuantity] = useState('1')
  const [newUnit, setNewUnit] = useState<InvoiceLineItemUnit>('SERVICE')
  const [newCustomUnitLabel, setNewCustomUnitLabel] = useState('')
  const [newUnitPrice, setNewUnitPrice] = useState('')
  const [newVatRate, setNewVatRate] = useState<VatRate>('NOT_APPLICABLE')
  const [savingNew, setSavingNew] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [quickFilling, setQuickFilling] = useState(false)

  // Все четыре кнопки переиспользуют уже существующие данные (заказ/монтаж/
  // приложение) — ничего не дублируется и не хранится отдельным полем "только
  // для этой кнопки" (см. AGENTS.md, единый источник данных). Не гейтим по
  // типу документа — та же съёмка/монтаж одинаково осмысленны и в составе
  // акта, а не только счёта.
  async function handleQuickFillShoot() {
    if (!orderId) return
    setQuickFilling(true)
    const result = await getOrder(orderId)
    setQuickFilling(false)
    if (!result.ok) return
    const { description, unitPrice } = buildShootDescriptionAndPrice(result.data)
    await submitQuickFill(description, unitPrice)
  }

  // Клиентская стоимость монтажа (НЕ выплата монтажёру — та же граница, что
  // уже проведена в OrderFinanceBlock между "Клиент платит"/"Выплата
  // монтажёру"). Проект без активного (не CANCELLED) монтажа — кнопка просто
  // ничего не делает молча не показываясь (см. условие рендера ниже).
  async function handleQuickFillMontage() {
    if (!orderId) return
    setQuickFilling(true)
    const result = await getMontageProjectsForOrder(orderId)
    setQuickFilling(false)
    const amount = findActiveMontageClientAmount(result.data)
    if (amount == null) return
    await submitQuickFill('Монтаж', amount)
  }

  // Идемпотентно (ТЗ): повторный клик не дублирует строку, если описание уже
  // совпадает с уже добавленной ранее из приложения строкой.
  async function handleQuickFillFromAppendix() {
    if (!appendix?.serviceDescription) return
    if (doc.lineItems.some(li => li.description === appendix.serviceDescription)) return
    await submitQuickFill(appendix.serviceDescription, appendix.amount ?? 0)
  }

  async function handleQuickFillExtra() {
    await submitQuickFill('Дополнительная услуга', 0)
  }

  async function submitQuickFill(description: string, unitPrice: number) {
    setQuickFilling(true)
    const result = await addInvoiceLineItem({ documentId: doc.id, description, quantity: 1, unit: 'SERVICE', unitPrice, vatRate: 'NOT_APPLICABLE' })
    setQuickFilling(false)
    if (result.ok) onUpdated(result.data)
  }

  async function handleAdd() {
    if (!newDescription.trim() || !newUnitPrice) return
    setSavingNew(true)
    setError(null)
    const result = await addInvoiceLineItem({
      documentId: doc.id,
      description: newDescription,
      quantity: Number(newQuantity) || 1,
      unit: newUnit,
      customUnitLabel: newUnit === 'OTHER' ? newCustomUnitLabel : null,
      unitPrice: Number(newUnitPrice),
      vatRate: newVatRate,
    })
    setSavingNew(false)
    if (!result.ok) { setError(result.error); return }
    onUpdated(result.data)
    setNewDescription(''); setNewQuantity('1'); setNewUnit('SERVICE'); setNewCustomUnitLabel(''); setNewUnitPrice(''); setNewVatRate('NOT_APPLICABLE')
    setAdding(false)
  }

  async function handleSave(id: string, patch: LineItemPatch) {
    const result = await updateInvoiceLineItem({ id, ...patch })
    if (result.ok) onUpdated(result.data)
  }

  async function handleRemove(id: string) {
    const result = await removeInvoiceLineItem(id)
    setConfirmDeleteId(null)
    if (result.ok) onUpdated(result.data)
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const items = doc.lineItems
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= items.length) return
    const reordered = [...items]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    const result = await reorderInvoiceLineItems(doc.id, reordered.map(i => i.id))
    if (result.ok) onUpdated(result.data)
  }

  const lastIndex = doc.lineItems.length - 1

  async function handleDuplicate(item: InvoiceLineItemDTO) {
    const result = await addInvoiceLineItem({
      documentId: doc.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      customUnitLabel: item.customUnitLabel,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
    })
    if (result.ok) onUpdated(result.data)
  }

  const kindGenitive = doc.type === 'ACT' ? 'акта' : 'счёта'

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1.5">
      {doc.lineItems.length === 0 && !adding && (
        <p className="text-zinc-600 text-[11px]">
          {doc.amount != null
            ? `Позиций нет — сумма ${kindGenitive} (${formatMoney(doc.amount)}) указана вручную и не изменится, пока не добавлены позиции.`
            : `Позиций нет — добавьте товары или услуги, чтобы сформировать сумму ${kindGenitive}.`}
        </p>
      )}
      {doc.lineItems.length > 0 && <LineItemsTableHeader />}
      {doc.lineItems.map((item, index) => (
        <LineItemRow
          key={item.id}
          item={item}
          index={index}
          lastIndex={lastIndex}
          onSave={patch => handleSave(item.id, patch)}
          onMoveUp={() => handleMove(index, -1)}
          onMoveDown={() => handleMove(index, 1)}
          onDuplicate={() => handleDuplicate(item)}
          confirmingDelete={confirmDeleteId === item.id}
          onRequestDelete={() => setConfirmDeleteId(item.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleRemove(item.id)}
        />
      ))}
      {doc.lineItems.length > 0 && (
        <p className="text-zinc-500 text-[11px] text-right pr-1">Итого по позициям: {formatMoney(computeLineItemsTotal(doc.lineItems))}</p>
      )}
      {!adding && (
        <div className="flex items-center gap-2 flex-wrap">
          {orderId && (
            <button type="button" disabled={quickFilling} onClick={handleQuickFillShoot} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
              + Добавить съёмку
            </button>
          )}
          {orderId && (
            <button type="button" disabled={quickFilling} onClick={handleQuickFillMontage} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
              + Добавить монтаж
            </button>
          )}
          {appendix?.serviceDescription && (
            <button type="button" disabled={quickFilling} onClick={handleQuickFillFromAppendix} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
              Заполнить из приложения
            </button>
          )}
          <button type="button" disabled={quickFilling} onClick={handleQuickFillExtra} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
            + Добавить доп. услугу
          </button>
        </div>
      )}
      {adding ? (
        <div className="bg-zinc-900/60 border border-zinc-700 rounded-lg p-2 space-y-1.5">
          <textarea rows={2} placeholder="Наименование товара или услуги" className={`${TEXTAREA} w-full`} value={newDescription} onChange={e => setNewDescription(e.target.value)} />
          <div className="grid grid-cols-4 gap-1.5">
            <input type="number" min="0" step="any" placeholder="Кол-во" className={INPUT} value={newQuantity} onChange={e => setNewQuantity(e.target.value)} />
            <select className={SELECT} value={newUnit} onChange={e => setNewUnit(e.target.value as InvoiceLineItemUnit)}>
              {(Object.keys(INVOICE_LINE_ITEM_UNIT_LABELS) as InvoiceLineItemUnit[]).map(u => <option key={u} value={u}>{INVOICE_LINE_ITEM_UNIT_LABELS[u]}</option>)}
            </select>
            <input type="number" min="0" placeholder="Цена" className={INPUT} value={newUnitPrice} onChange={e => setNewUnitPrice(e.target.value)} />
            <select className={SELECT} value={newVatRate} onChange={e => setNewVatRate(e.target.value as VatRate)}>
              {(Object.keys(VAT_RATE_LABELS) as VatRate[]).map(v => <option key={v} value={v}>{VAT_RATE_LABELS[v]}</option>)}
            </select>
          </div>
          {newUnit === 'OTHER' && (
            <input placeholder="Название единицы измерения" className={`${INPUT} w-full`} value={newCustomUnitLabel} onChange={e => setNewCustomUnitLabel(e.target.value)} />
          )}
          {error && <p className="text-red-400 text-[11px]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setError(null) }} className="text-zinc-400 hover:text-zinc-200 text-[11px] px-2 py-1">Отмена</button>
            <button type="button" disabled={savingNew} onClick={handleAdd} className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-100 text-[11px] font-medium px-2.5 py-1 rounded-lg">
              {savingNew ? 'Сохранение…' : 'Добавить'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-[#00c26b] text-[11px] hover:underline">
          <Plus className="w-3 h-3" /> Добавить товар или услугу
        </button>
      )}
    </div>
  )
}

// Общая шапка колонок — переиспользуется и уже созданным документом
// (DocumentLineItemsEditor), и черновиком ещё не созданного (DraftLineItemsSection).
// Ширины совпадают с полями строки в LineItemRow/DraftLineItemRow — держать
// в синхроне при правке.
function LineItemsTableHeader() {
  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2 text-zinc-500 text-[10px] uppercase tracking-wide">
      <span className="flex-1 min-w-0">Наименование</span>
      <span className="w-16 text-center flex-shrink-0">Кол-во</span>
      <span className="w-20 text-center flex-shrink-0">Ед.</span>
      <span className="w-24 text-center flex-shrink-0">Цена</span>
      <span className="w-20 text-center flex-shrink-0">НДС</span>
      <span className="w-20 text-right flex-shrink-0">Сумма</span>
      <span className="w-14 flex-shrink-0" />
    </div>
  )
}

// Черновик строк создаваемого (ещё не сохранённого) счёта/акта — живёт
// целиком в состоянии родителя (WorkDocumentsSection), ничего не сохраняет
// само по себе: каждое изменение сразу отражается в массиве draftLineItems,
// отправляемом одним вызовом createDocument при финальном сохранении (см.
// AGENTS.md, "услуги — обязательная часть счёта/акта"). extraQuickActions —
// место для ACT-специфичной кнопки "Скопировать из счёта".
function DraftLineItemsSection({
  items, onChangeItems, orderId, appendix, extraQuickActions,
}: {
  items: DraftLineItem[]
  onChangeItems: (items: DraftLineItem[]) => void
  orderId: string | null
  appendix: DocumentDTO | null
  extraQuickActions?: React.ReactNode
}) {
  const [quickFilling, setQuickFilling] = useState(false)

  function addItem(item: DraftLineItem) { onChangeItems([...items, item]) }
  function updateItem(index: number, patch: Partial<DraftLineItem>) {
    onChangeItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function removeItem(index: number) { onChangeItems(items.filter((_, i) => i !== index)) }
  function duplicateItem(index: number) {
    const copy = { ...items[index], key: makeDraftKey() }
    onChangeItems([...items.slice(0, index + 1), copy, ...items.slice(index + 1)])
  }
  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChangeItems(next)
  }

  async function handleQuickFillShoot() {
    if (!orderId) return
    setQuickFilling(true)
    const result = await getOrder(orderId)
    setQuickFilling(false)
    if (!result.ok) return
    const { description, unitPrice } = buildShootDescriptionAndPrice(result.data)
    addItem({ ...emptyDraftLineItem(), description, unitPrice: String(unitPrice) })
  }

  async function handleQuickFillMontage() {
    if (!orderId) return
    setQuickFilling(true)
    const result = await getMontageProjectsForOrder(orderId)
    setQuickFilling(false)
    const amount = findActiveMontageClientAmount(result.data)
    if (amount == null) return
    addItem({ ...emptyDraftLineItem(), description: 'Монтаж', unitPrice: String(amount) })
  }

  function handleQuickFillFromAppendix() {
    if (!appendix?.serviceDescription) return
    if (items.some(d => d.description === appendix.serviceDescription)) return
    addItem({ ...emptyDraftLineItem(), description: appendix.serviceDescription, unitPrice: String(appendix.amount ?? 0) })
  }

  function handleQuickFillExtra() {
    addItem({ ...emptyDraftLineItem(), description: 'Дополнительная услуга' })
  }

  const lastIndex = items.length - 1

  return (
    <div className="space-y-1.5">
      {items.length > 0 && <LineItemsTableHeader />}
      {items.map((item, index) => (
        <DraftLineItemRow
          key={item.key}
          item={item}
          index={index}
          lastIndex={lastIndex}
          onChange={patch => updateItem(index, patch)}
          onMoveUp={() => moveItem(index, -1)}
          onMoveDown={() => moveItem(index, 1)}
          onDuplicate={() => duplicateItem(index)}
          onRemove={() => removeItem(index)}
        />
      ))}
      {items.length > 0 && (
        <p className="text-zinc-500 text-[11px] text-right pr-1">Итого: {formatMoney(draftLineItemsTotal(items))}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {orderId && (
          <button type="button" disabled={quickFilling} onClick={handleQuickFillShoot} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
            + Добавить съёмку
          </button>
        )}
        {orderId && (
          <button type="button" disabled={quickFilling} onClick={handleQuickFillMontage} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
            + Добавить монтаж
          </button>
        )}
        {appendix?.serviceDescription && (
          <button type="button" onClick={handleQuickFillFromAppendix} className="text-zinc-400 hover:text-[#00c26b] text-[11px] hover:underline transition-colors">
            Заполнить из приложения
          </button>
        )}
        <button type="button" onClick={handleQuickFillExtra} className="text-zinc-400 hover:text-[#00c26b] text-[11px] hover:underline transition-colors">
          + Добавить доп. услугу
        </button>
        {extraQuickActions}
        <button type="button" onClick={() => addItem(emptyDraftLineItem())} className="flex items-center gap-1 text-[#00c26b] text-[11px] hover:underline">
          <Plus className="w-3 h-3" /> Добавить ещё одну услугу
        </button>
      </div>
    </div>
  )
}

interface DraftLineItemRowProps {
  item: DraftLineItem
  index: number
  lastIndex: number
  onChange: (patch: Partial<DraftLineItem>) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
  onRemove: () => void
}

// Визуально повторяет LineItemRow (те же ширины полей, шапка), но пишет
// напрямую в родительский draftLineItems при каждом изменении — ничего не
// сохраняется на сервер до финального "Создать счёт"/"Создать акт", поэтому
// не нужен ни onBlur-дебаунс, ни подтверждение удаления строки.
function DraftLineItemRow({ item, index, lastIndex, onChange, onMoveUp, onMoveDown, onDuplicate, onRemove }: DraftLineItemRowProps) {
  return (
    <div className="bg-zinc-900/40 rounded-lg px-2 py-1.5 space-y-1">
      <div className="flex items-start gap-1.5">
        <textarea
          rows={2}
          placeholder="Наименование товара или услуги"
          className={`${TEXTAREA} flex-1 min-w-0`}
          value={item.description}
          onChange={e => onChange({ description: e.target.value })}
        />
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" disabled={index === 0} onClick={onMoveUp} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-20 p-0.5">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={index === lastIndex} onClick={onMoveDown} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-20 p-0.5">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          type="number" min="0" step="any" className={`${INPUT} w-16 flex-shrink-0 text-center`}
          value={item.quantity}
          onChange={e => onChange({ quantity: e.target.value })}
        />
        <select
          className={`${SELECT} w-20 flex-shrink-0`}
          value={item.unit}
          onChange={e => {
            const nextUnit = e.target.value as InvoiceLineItemUnit
            onChange({ unit: nextUnit, customUnitLabel: nextUnit === 'OTHER' ? item.customUnitLabel : '' })
          }}
        >
          {(Object.keys(INVOICE_LINE_ITEM_UNIT_LABELS) as InvoiceLineItemUnit[]).map(u => <option key={u} value={u}>{INVOICE_LINE_ITEM_UNIT_LABELS[u]}</option>)}
        </select>
        <input
          type="number" min="0" className={`${INPUT} w-24 flex-shrink-0`}
          value={item.unitPrice}
          onChange={e => onChange({ unitPrice: e.target.value })}
        />
        <select className={`${SELECT} w-20 flex-shrink-0`} value={item.vatRate} onChange={e => onChange({ vatRate: e.target.value as VatRate })}>
          {(Object.keys(VAT_RATE_LABELS) as VatRate[]).map(v => <option key={v} value={v}>{VAT_RATE_LABELS[v]}</option>)}
        </select>
        <span className="text-zinc-300 text-xs w-20 flex-shrink-0 text-right">
          {formatMoney(computeLineItemTotal({ quantity: Number(item.quantity) || 0, unitPrice: Number(item.unitPrice) || 0 }))}
        </span>
        <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
          <button type="button" onClick={onDuplicate} title="Дублировать строку" className="text-zinc-600 hover:text-zinc-300 p-0.5">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onRemove} className="text-zinc-500 hover:text-red-400 p-0.5">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {item.unit === 'OTHER' && (
        <input
          placeholder="Название единицы измерения"
          className={`${INPUT} w-full`}
          value={item.customUnitLabel}
          onChange={e => onChange({ customUnitLabel: e.target.value })}
        />
      )}
    </div>
  )
}

// Выбор счёта-источника для копирования состава в акт — один счёт: кнопка
// сразу копирует; несколько — компактный список для выбора (тот же приём
// input+список кнопок, что уже используется в EditorAssignField.tsx).
// Используется и при создании нового акта (копия в локальный черновик), и на
// уже существующем акте (копия через copyInvoiceLineItemsIntoAct) — сам
// компонент не знает, какой из двух путей вызовет onPick.
function InvoiceCopySourcePicker({ invoices, onPick, disabled }: { invoices: DocumentDTO[]; onPick: (invoice: DocumentDTO) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  if (invoices.length === 0) return null
  if (invoices.length === 1) {
    return (
      <button type="button" disabled={disabled} onClick={() => onPick(invoices[0])} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
        Скопировать из счёта {invoices[0].displayNumber}
      </button>
    )
  }
  return (
    <div className="relative inline-block">
      <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)} className="text-zinc-400 hover:text-[#00c26b] disabled:opacity-50 text-[11px] hover:underline transition-colors">
        Скопировать из счёта…
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {invoices.map(inv => (
            <button key={inv.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onPick(inv); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors border-b border-zinc-700/60 last:border-0">
              <div>{inv.displayNumber} · {formatMoney(inv.amount)}</div>
              <div className="text-zinc-500 text-[11px]">{formatDate(inv.issueDate)} · {DOCUMENT_STATUS_LABELS[inv.status]}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Подтверждение "заменить/добавить/отмена" при повторном копировании из
// счёта, когда в акте (черновике или уже созданном) уже есть непустые
// строки — один общий диалог для обоих путей (создание и уже существующий
// акт), сама "заменить или добавить" логика — на стороне вызывающего кода.
function LineItemsCopyChoiceDialog({
  open, onOpenChange, invoiceLabel, onReplace, onAppend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceLabel: string
  onReplace: () => void
  onAppend: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Заменить текущие услуги данными из счёта {invoiceLabel}?</DialogTitle>
        </DialogHeader>
        <p className="text-zinc-400 text-sm">В документе уже есть заполненные позиции. Что сделать с данными из счёта?</p>
        <DialogFooter className="bg-zinc-900 border-zinc-800 flex-col sm:flex-col gap-2">
          <button type="button" onClick={onReplace} className="w-full bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Заменить
          </button>
          <button type="button" onClick={onAppend} className="w-full bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Добавить к текущим
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className="w-full text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors">
            Отмена
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface LineItemRowProps {
  item: InvoiceLineItemDTO
  index: number
  lastIndex: number
  onSave: (patch: LineItemPatch) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
  confirmingDelete: boolean
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}

// Локальный черновик полей строки — сохраняется по onBlur (не по каждому
// символу), тот же принцип "мгновенно на выбор/список, дебаунс на текст",
// что и в use-autosave.ts, но здесь достаточно простого onBlur без отдельного
// хука — строк счёта немного, а сохранение всей карточки уже не завязано на
// это поле. Ширины полей количества/единицы/цены/НДС/суммы совпадают с
// шапкой колонок в InvoiceLineItemsEditor — держать в синхроне при правке.
function LineItemRow({ item, index, lastIndex, onSave, onMoveUp, onMoveDown, onDuplicate, confirmingDelete, onRequestDelete, onCancelDelete, onConfirmDelete }: LineItemRowProps) {
  const [description, setDescription] = useState(item.description)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice))
  const [customUnitLabel, setCustomUnitLabel] = useState(item.customUnitLabel ?? '')

  return (
    <div className="bg-zinc-900/40 rounded-lg px-2 py-1.5 space-y-1">
      <div className="flex items-start gap-1.5">
        <textarea
          rows={2}
          className={`${TEXTAREA} flex-1 min-w-0`}
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={() => { if (description.trim() && description !== item.description) onSave({ description }) }}
        />
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" disabled={index === 0} onClick={onMoveUp} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-20 p-0.5">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={index === lastIndex} onClick={onMoveDown} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-20 p-0.5">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          type="number" min="0" step="any" className={`${INPUT} w-16 flex-shrink-0 text-center`}
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          onBlur={() => { const n = Number(quantity); if (n > 0 && n !== item.quantity) onSave({ quantity: n }) }}
        />
        <select
          className={`${SELECT} w-20 flex-shrink-0`}
          value={item.unit}
          onChange={e => {
            const nextUnit = e.target.value as InvoiceLineItemUnit
            onSave(nextUnit === 'OTHER' ? { unit: nextUnit, customUnitLabel: customUnitLabel || null } : { unit: nextUnit, customUnitLabel: null })
          }}
        >
          {(Object.keys(INVOICE_LINE_ITEM_UNIT_LABELS) as InvoiceLineItemUnit[]).map(u => <option key={u} value={u}>{INVOICE_LINE_ITEM_UNIT_LABELS[u]}</option>)}
        </select>
        <input
          type="number" min="0" className={`${INPUT} w-24 flex-shrink-0`}
          value={unitPrice}
          onChange={e => setUnitPrice(e.target.value)}
          onBlur={() => { const n = Number(unitPrice); if (n >= 0 && n !== item.unitPrice) onSave({ unitPrice: n }) }}
        />
        <select className={`${SELECT} w-20 flex-shrink-0`} value={item.vatRate} onChange={e => onSave({ vatRate: e.target.value as VatRate })}>
          {(Object.keys(VAT_RATE_LABELS) as VatRate[]).map(v => <option key={v} value={v}>{VAT_RATE_LABELS[v]}</option>)}
        </select>
        <span className="text-zinc-300 text-xs w-20 flex-shrink-0 text-right">{formatMoney(item.total)}</span>
        {item.migratedFromLegacyAmount && <GlowPill size="sm" color="zinc">перенесено</GlowPill>}
        <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
          <button type="button" onClick={onDuplicate} title="Дублировать строку" className="text-zinc-600 hover:text-zinc-300 p-0.5">
            <Copy className="w-3.5 h-3.5" />
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-1">
              <button type="button" onClick={onConfirmDelete} className="text-red-400 hover:text-red-300 text-[11px] underline">Удалить</button>
              <button type="button" onClick={onCancelDelete} className="text-zinc-500 hover:text-zinc-300 text-[11px] underline">Отмена</button>
            </span>
          ) : (
            <button type="button" onClick={onRequestDelete} className="text-zinc-500 hover:text-red-400 p-0.5">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {item.unit === 'OTHER' && (
        <input
          placeholder="Название единицы измерения"
          className={`${INPUT} w-full`}
          value={customUnitLabel}
          onChange={e => setCustomUnitLabel(e.target.value)}
          onBlur={() => { if (customUnitLabel.trim() && customUnitLabel !== item.customUnitLabel) onSave({ unit: 'OTHER', customUnitLabel }) }}
        />
      )}
    </div>
  )
}
