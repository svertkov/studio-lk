'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Plus, ScrollText, Layers, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import GlowPill from '@/components/ui/glow-pill'
import {
  getDocumentsForOrder, getDocumentsForMontageProject, getClientContractSummary,
  getOrderDocumentFlowType, getMontageDocumentMode,
  createDocument, updateDocument, updateOrderDocumentFlowType, updateMontageDocumentMode,
  addInvoiceLineItem, updateInvoiceLineItem, removeInvoiceLineItem, reorderInvoiceLineItems,
  type DocumentDTO, type ClientContractSummary, type InvoiceLineItemDTO,
} from '@/lib/actions/documents'
import {
  DOCUMENT_FLOW_TYPE_LABELS, MONTAGE_DOCUMENT_MODE_LABELS, DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_OPTIONS_BY_TYPE, INVOICE_PURPOSE_LABELS, DOCUMENT_PAYMENT_STATE_LABELS,
  CLIENT_CONTRACT_STATE_LABELS, getContractStateColor, getDocumentPaymentState,
  INVOICE_LINE_ITEM_UNIT_LABELS, VAT_RATE_LABELS, computeLineItemsTotal,
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

interface CreateFormState {
  issueDate: string
  purpose: InvoicePurpose
  amount: string
  dueDate: string
  comment: string
  serviceDescription: string
}

function defaultCreateForm(): CreateFormState {
  return { issueDate: new Date().toISOString().slice(0, 10), purpose: 'FULL_PAYMENT', amount: '', dueDate: '', comment: '', serviceDescription: '' }
}

const TEXTAREA = 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-[#00c26b] transition-colors w-full resize-none'

interface Props {
  clientId: string | null
  orderId?: string | null
  montageProjectId?: string | null
}

// Общий блок "Документы" для карточки заказа (OrderFormModal/EventCardModal)
// и карточки проекта монтажа (MontageProjectModal) — первый переиспользуемый
// содержательный блок между модалками в проекте (см. AGENTS.md). Полностью
// самодостаточен: сам загружает данные и сохраняет изменения по месту, не
// встроен в Save родительской формы (тот же принцип, что overlay-действия
// MontageProjectModal — пауза/отмена/архив).
export default function WorkDocumentsSection({ clientId, orderId, montageProjectId }: Props) {
  const [documents, setDocuments] = useState<DocumentDTO[] | null>(null)
  const [contractSummary, setContractSummary] = useState<ClientContractSummary | null>(null)
  const [flowType, setFlowType] = useState<DocumentFlowType>('UNKNOWN')
  const [modeType, setModeType] = useState<MontageDocumentMode>('UNKNOWN')
  const [creatingType, setCreatingType] = useState<DocumentType | null>(null)
  const [form, setForm] = useState<CreateFormState>(defaultCreateForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appendixExpanded, setAppendixExpanded] = useState(false)

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
    }
    load()
    return () => { cancelled = true }
  }, [orderId, montageProjectId, clientId])

  async function handleFlowTypeChange(next: DocumentFlowType) {
    setFlowType(next)
    if (orderId) await updateOrderDocumentFlowType(orderId, next)
  }

  async function handleModeChange(next: MontageDocumentMode) {
    setModeType(next)
    if (montageProjectId) await updateMontageDocumentMode(montageProjectId, next)
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
      amount: (type === 'INVOICE' || type === 'APPENDIX') && form.amount ? Number(form.amount) : null,
      dueDate: type === 'INVOICE' && form.dueDate ? form.dueDate : null,
      serviceDescription: form.serviceDescription.trim() || null,
      comment: form.comment.trim() || null,
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
  }

  async function handleStatusChange(doc: DocumentDTO, status: DocumentStatus) {
    const result = await updateDocument({ id: doc.id, status })
    if (result.ok) setDocuments(prev => prev?.map(d => (d.id === doc.id ? result.data : d)) ?? null)
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
                <button type="button" onClick={() => setCreatingType('APPENDIX')} className="flex items-center gap-1 text-[#00c26b] text-xs hover:underline">
                  <Plus className="w-3 h-3" /> Добавить приложение
                </button>
              )}
            </div>
            {appendix && (
              <div className="bg-zinc-800/40 rounded-lg px-3 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-zinc-200 text-xs">{appendix.displayNumber}</p>
                  <p className="text-zinc-500 text-[11px]">{formatDate(appendix.issueDate)} · {formatMoney(appendix.amount)}</p>
                </div>
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
                  <button type="button" onClick={() => setCreatingType(null)} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1.5">Отмена</button>
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
              <button type="button" onClick={() => setCreatingType(creatingType === 'INVOICE' ? null : 'INVOICE')} className="flex items-center gap-1 text-[#00c26b] text-xs hover:underline">
                <Plus className="w-3 h-3" /> Добавить счёт
              </button>
            </div>
            {invoices.map(inv => {
              const paymentState = getDocumentPaymentState(inv.orderPaymentStatus, inv.montagePaymentStatus)
              return (
                <div key={inv.id} className="bg-zinc-800/40 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-zinc-200 text-xs">{inv.displayNumber} {inv.purpose && `· ${INVOICE_PURPOSE_LABELS[inv.purpose]}`}</p>
                      <p className="text-zinc-500 text-[11px] mt-0.5">{formatDate(inv.issueDate)} · {formatMoney(inv.amount)} · {DOCUMENT_PAYMENT_STATE_LABELS[paymentState]}</p>
                    </div>
                    <select className={`${SELECT} flex-shrink-0`} value={inv.status} onChange={e => handleStatusChange(inv, e.target.value as DocumentStatus)}>
                      {DOCUMENT_STATUS_OPTIONS_BY_TYPE.INVOICE.map(s => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <InvoiceLineItemsEditor invoice={inv} onUpdated={doc => setDocuments(prev => prev?.map(d => (d.id === doc.id ? doc : d)) ?? null)} />
                </div>
              )
            })}
            {invoices.length === 0 && creatingType !== 'INVOICE' && <p className="text-zinc-600 text-xs">Счетов нет</p>}
            {creatingType === 'INVOICE' && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className={INPUT} value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
                  <select className={SELECT} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value as InvoicePurpose }))}>
                    {(Object.keys(INVOICE_PURPOSE_LABELS) as InvoicePurpose[]).map(p => <option key={p} value={p}>{INVOICE_PURPOSE_LABELS[p]}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" placeholder="Сумма" className={INPUT} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                  <input type="date" placeholder="Срок оплаты" className={INPUT} value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
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
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setCreatingType(null)} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1.5">Отмена</button>
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
              <button type="button" onClick={() => setCreatingType(creatingType === 'ACT' ? null : 'ACT')} className="flex items-center gap-1 text-[#00c26b] text-xs hover:underline">
                <Plus className="w-3 h-3" /> Добавить акт
              </button>
            </div>
            {acts.map(act => (
              <div key={act.id} className="flex items-center justify-between gap-2 bg-zinc-800/40 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-zinc-200 text-xs">{act.displayNumber}</p>
                  <p className="text-zinc-500 text-[11px] mt-0.5">{formatDate(act.issueDate)}</p>
                </div>
                <select className={`${SELECT} flex-shrink-0`} value={act.status} onChange={e => handleStatusChange(act, e.target.value as DocumentStatus)}>
                  {DOCUMENT_STATUS_OPTIONS_BY_TYPE.ACT.map(s => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
                </select>
              </div>
            ))}
            {acts.length === 0 && creatingType !== 'ACT' && <p className="text-zinc-600 text-xs">Актов нет</p>}
            {creatingType === 'ACT' && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2">
                <input type="date" className={`${INPUT} w-full`} value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
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
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setCreatingType(null)} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1.5">Отмена</button>
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
  )
}

type LineItemPatch = Partial<{ description: string; quantity: number; unit: InvoiceLineItemUnit; unitPrice: number; vatRate: VatRate }>

// Строки счёта — только первый список (добавить/убрать/переставить), без
// "умных" кнопок автозаполнения (отложено по решению пользователя). Полностью
// самодостаточный overlay поверх одного конкретного счёта: сохраняет каждое
// изменение сразу через свои собственные действия, возвращая родителю
// обновлённый DocumentDTO целиком (amount пересчитан сервером — см.
// recomputeDocumentAmount, actions/documents.ts), а не патчит локальный стейт
// вручную, чтобы не разойтись с сервером.
function InvoiceLineItemsEditor({ invoice, onUpdated }: { invoice: DocumentDTO; onUpdated: (doc: DocumentDTO) => void }) {
  const [adding, setAdding] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [newQuantity, setNewQuantity] = useState('1')
  const [newUnit, setNewUnit] = useState<InvoiceLineItemUnit>('SERVICE')
  const [newUnitPrice, setNewUnitPrice] = useState('')
  const [newVatRate, setNewVatRate] = useState<VatRate>('NOT_APPLICABLE')
  const [savingNew, setSavingNew] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handleAdd() {
    if (!newDescription.trim() || !newUnitPrice) return
    setSavingNew(true)
    setError(null)
    const result = await addInvoiceLineItem({
      documentId: invoice.id,
      description: newDescription,
      quantity: Number(newQuantity) || 1,
      unit: newUnit,
      unitPrice: Number(newUnitPrice),
      vatRate: newVatRate,
    })
    setSavingNew(false)
    if (!result.ok) { setError(result.error); return }
    onUpdated(result.data)
    setNewDescription(''); setNewQuantity('1'); setNewUnit('SERVICE'); setNewUnitPrice(''); setNewVatRate('NOT_APPLICABLE')
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
    const items = invoice.lineItems
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= items.length) return
    const reordered = [...items]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    const result = await reorderInvoiceLineItems(invoice.id, reordered.map(i => i.id))
    if (result.ok) onUpdated(result.data)
  }

  const lastIndex = invoice.lineItems.length - 1

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1.5">
      {invoice.lineItems.length === 0 && !adding && (
        <p className="text-zinc-600 text-[11px]">Позиций нет — сумма счёта берётся из поля «Сумма» выше.</p>
      )}
      {invoice.lineItems.map((item, index) => (
        <LineItemRow
          key={item.id}
          item={item}
          index={index}
          lastIndex={lastIndex}
          onSave={patch => handleSave(item.id, patch)}
          onMoveUp={() => handleMove(index, -1)}
          onMoveDown={() => handleMove(index, 1)}
          confirmingDelete={confirmDeleteId === item.id}
          onRequestDelete={() => setConfirmDeleteId(item.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleRemove(item.id)}
        />
      ))}
      {invoice.lineItems.length > 0 && (
        <p className="text-zinc-500 text-[11px] text-right pr-1">Итого по позициям: {formatMoney(computeLineItemsTotal(invoice.lineItems))}</p>
      )}
      {adding ? (
        <div className="bg-zinc-900/60 border border-zinc-700 rounded-lg p-2 space-y-1.5">
          <input placeholder="Наименование услуги" className={`${INPUT} w-full`} value={newDescription} onChange={e => setNewDescription(e.target.value)} />
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
          <Plus className="w-3 h-3" /> Добавить позицию
        </button>
      )}
    </div>
  )
}

interface LineItemRowProps {
  item: InvoiceLineItemDTO
  index: number
  lastIndex: number
  onSave: (patch: LineItemPatch) => void
  onMoveUp: () => void
  onMoveDown: () => void
  confirmingDelete: boolean
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}

// Локальный черновик полей строки — сохраняется по onBlur (не по каждому
// символу), тот же принцип "мгновенно на выбор/список, дебаунс на текст",
// что и в use-autosave.ts, но здесь достаточно простого onBlur без отдельного
// хука — строк счёта немного, а сохранение всей карточки уже не завязано на
// это поле.
function LineItemRow({ item, index, lastIndex, onSave, onMoveUp, onMoveDown, confirmingDelete, onRequestDelete, onCancelDelete, onConfirmDelete }: LineItemRowProps) {
  const [description, setDescription] = useState(item.description)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice))

  return (
    <div className="bg-zinc-900/40 rounded-lg px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5">
        <input
          className={`${INPUT} flex-1 min-w-0`}
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
          type="number" min="0" step="any" className={`${INPUT} w-16`}
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          onBlur={() => { const n = Number(quantity); if (n > 0 && n !== item.quantity) onSave({ quantity: n }) }}
        />
        <select className={SELECT} value={item.unit} onChange={e => onSave({ unit: e.target.value as InvoiceLineItemUnit })}>
          {(Object.keys(INVOICE_LINE_ITEM_UNIT_LABELS) as InvoiceLineItemUnit[]).map(u => <option key={u} value={u}>{INVOICE_LINE_ITEM_UNIT_LABELS[u]}</option>)}
        </select>
        <span className="text-zinc-600 text-[11px]">×</span>
        <input
          type="number" min="0" className={`${INPUT} w-24`}
          value={unitPrice}
          onChange={e => setUnitPrice(e.target.value)}
          onBlur={() => { const n = Number(unitPrice); if (n >= 0 && n !== item.unitPrice) onSave({ unitPrice: n }) }}
        />
        <select className={SELECT} value={item.vatRate} onChange={e => onSave({ vatRate: e.target.value as VatRate })}>
          {(Object.keys(VAT_RATE_LABELS) as VatRate[]).map(v => <option key={v} value={v}>{VAT_RATE_LABELS[v]}</option>)}
        </select>
        <span className="text-zinc-300 text-xs ml-auto">{formatMoney(item.total)}</span>
        {item.migratedFromLegacyAmount && <GlowPill size="sm" color="zinc">перенесено</GlowPill>}
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
  )
}
