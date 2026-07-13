'use client'

import Link from 'next/link'
import { FileText, ScrollText, Receipt, ClipboardCheck } from 'lucide-react'
import GlowPill from '@/components/ui/glow-pill'
import ClientContractModal from './ClientContractModal'
import type { DocumentDTO } from '@/lib/actions/documents'
import {
  CLIENT_CONTRACT_STATE_LABELS, getContractStateColor, DOCUMENT_STATUS_LABELS,
  DOCUMENT_PAYMENT_STATE_LABELS, getDocumentPaymentState, INVOICE_PURPOSE_LABELS,
  type ClientContractState,
} from '@/lib/document-model'
import type { ClientType } from '@prisma/client'

function formatDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function workHref(doc: DocumentDTO): string | null {
  // Раздел "Документы" не имеет своей формы редактирования — переход всегда
  // ведёт туда, где документ реально создаётся/меняется (ТЗ разд.9/16).
  if (doc.orderId) return '/admin/orders'
  if (doc.montageProjectId) return '/admin/editing'
  return null
}

interface Props {
  clientId: string
  clientType: string
  contractState: ClientContractState
  contractStateComment: string | null
  contractPlannedDate: string | null
  documents: DocumentDTO[]
}

export default function ClientDocumentsTab({
  clientId, clientType, contractState, contractStateComment, contractPlannedDate, documents,
}: Props) {
  const contracts = documents.filter(d => d.type === 'CONTRACT')
  const invoices = documents.filter(d => d.type === 'INVOICE')
  const acts = documents.filter(d => d.type === 'ACT')
  const hasActiveContractDocument = contracts.some(c => c.status === 'ACTIVE')

  const unpaidInvoices = invoices.filter(inv => {
    const state = getDocumentPaymentState(inv.orderPaymentStatus, inv.montagePaymentStatus)
    return state === 'PENDING' || state === 'PARTIALLY_PAID'
  })
  const totalDebt = unpaidInvoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0)
  const isLegal = clientType === 'LLC' || clientType === 'IP'

  return (
    <div className="space-y-4">
      {/* Договор — заметный блок сверху, ТЗ разд.7 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <GlowPill color={getContractStateColor(clientType as ClientType, contractState)} icon={ScrollText}>
              {CLIENT_CONTRACT_STATE_LABELS[contractState]}
            </GlowPill>
            {hasActiveContractDocument && (
              <span className="text-zinc-300 text-sm">
                Договор {contracts.find(c => c.status === 'ACTIVE')?.displayNumber} от {formatDate(contracts.find(c => c.status === 'ACTIVE')?.issueDate ?? null)}
              </span>
            )}
            {contractState === 'UNSPECIFIED' && isLegal && (
              <span className="text-red-400 text-xs">Не указан статус договора</span>
            )}
          </div>
          <ClientContractModal
            clientId={clientId}
            contractState={contractState}
            contractStateComment={contractStateComment}
            contractPlannedDate={contractPlannedDate}
            hasActiveContractDocument={hasActiveContractDocument}
            triggerClassName="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-3 py-2 rounded-lg transition-colors flex-shrink-0"
            triggerLabel="Изменить"
          />
        </div>
        {contractStateComment && <p className="text-zinc-500 text-xs mt-2">{contractStateComment}</p>}
        {contractState === 'PREPARING' && contractPlannedDate && (
          <p className="text-amber-400/80 text-xs mt-2">Плановая дата: {formatDate(contractPlannedDate)}</p>
        )}
      </div>

      {/* Быстрые показатели — ТЗ разд.6/19 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Договоров</p>
          <p className="text-white text-lg font-semibold">{contracts.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Счетов</p>
          <p className="text-white text-lg font-semibold">{invoices.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Неоплачено</p>
          <p className={`text-lg font-semibold ${unpaidInvoices.length > 0 ? 'text-red-400' : 'text-white'}`}>{unpaidInvoices.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Задолженность</p>
          <p className={`text-lg font-semibold ${totalDebt > 0 ? 'text-red-400' : 'text-white'}`}>{formatMoney(totalDebt || null)}</p>
        </div>
      </div>

      {/* Счета */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-zinc-500" />
          <h3 className="text-white font-semibold text-sm">Счета</h3>
        </div>
        {invoices.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-6">Счетов пока нет</p>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {invoices.map(inv => {
              const paymentState = getDocumentPaymentState(inv.orderPaymentStatus, inv.montagePaymentStatus)
              const href = workHref(inv)
              const content = (
                <div className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-zinc-200 text-sm">{inv.displayNumber} {inv.purpose && `· ${INVOICE_PURPOSE_LABELS[inv.purpose]}`}</p>
                    <p className="text-zinc-500 text-xs mt-0.5 truncate">{formatDate(inv.issueDate)} · {inv.workTitle ?? '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white text-sm">{formatMoney(inv.amount)}</p>
                    <p className={`text-xs mt-0.5 ${paymentState === 'PAID' ? 'text-green-400' : paymentState === 'PENDING' || paymentState === 'PARTIALLY_PAID' ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {DOCUMENT_PAYMENT_STATE_LABELS[paymentState]}
                    </p>
                  </div>
                </div>
              )
              return href ? (
                <Link key={inv.id} href={href} className="block hover:bg-zinc-800/40 transition-colors">{content}</Link>
              ) : <div key={inv.id}>{content}</div>
            })}
          </div>
        )}
      </div>

      {/* Акты */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-zinc-500" />
          <h3 className="text-white font-semibold text-sm">Акты</h3>
        </div>
        {acts.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-6">Актов пока нет</p>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {acts.map(act => {
              const href = workHref(act)
              const content = (
                <div className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-zinc-200 text-sm">{act.displayNumber}</p>
                    <p className="text-zinc-500 text-xs mt-0.5 truncate">{formatDate(act.issueDate)} · {act.workTitle ?? '—'}</p>
                  </div>
                  <p className="text-zinc-300 text-xs flex-shrink-0">{DOCUMENT_STATUS_LABELS[act.status]}</p>
                </div>
              )
              return href ? (
                <Link key={act.id} href={href} className="block hover:bg-zinc-800/40 transition-colors">{content}</Link>
              ) : <div key={act.id}>{content}</div>
            })}
          </div>
        )}
      </div>

      {contracts.length === 0 && invoices.length === 0 && acts.length === 0 && (
        <div className="border border-dashed border-zinc-700 rounded-xl p-10 text-center">
          <FileText className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Документов пока нет</p>
        </div>
      )}
    </div>
  )
}
