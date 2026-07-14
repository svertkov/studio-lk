'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Plus, ScrollText, Layers } from 'lucide-react'
import GlowPill from '@/components/ui/glow-pill'
import {
  getDocumentsForOrder, getDocumentsForMontageProject, getClientContractSummary,
  getOrderDocumentFlowType, getMontageDocumentMode,
  createDocument, updateDocument, updateOrderDocumentFlowType, updateMontageDocumentMode,
  type DocumentDTO, type ClientContractSummary,
} from '@/lib/actions/documents'
import {
  DOCUMENT_FLOW_TYPE_LABELS, MONTAGE_DOCUMENT_MODE_LABELS, DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_OPTIONS_BY_TYPE, INVOICE_PURPOSE_LABELS, DOCUMENT_PAYMENT_STATE_LABELS,
  CLIENT_CONTRACT_STATE_LABELS, getContractStateColor, getDocumentPaymentState,
  type DocumentFlowType, type MontageDocumentMode, type DocumentType, type DocumentStatus, type InvoicePurpose,
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
                <div key={inv.id} className="flex items-center justify-between gap-2 bg-zinc-800/40 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-zinc-200 text-xs">{inv.displayNumber} {inv.purpose && `· ${INVOICE_PURPOSE_LABELS[inv.purpose]}`}</p>
                    <p className="text-zinc-500 text-[11px] mt-0.5">{formatDate(inv.issueDate)} · {formatMoney(inv.amount)} · {DOCUMENT_PAYMENT_STATE_LABELS[paymentState]}</p>
                  </div>
                  <select className={`${SELECT} flex-shrink-0`} value={inv.status} onChange={e => handleStatusChange(inv, e.target.value as DocumentStatus)}>
                    {DOCUMENT_STATUS_OPTIONS_BY_TYPE.INVOICE.map(s => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
                  </select>
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
