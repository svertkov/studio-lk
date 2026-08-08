'use client'

import { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { createSmmClientPayment, markSmmClientPaymentPaid, type SmmClientPaymentDTO, type SmmProjectDTO } from '@/lib/actions/smm'
import { SMM_CLIENT_PAYMENT_STATUS_LABELS, formatSmmMoney } from '@/lib/smm-model'
import { ORDER_PAYMENT_METHOD_LABELS } from '@/lib/order-model'
import type { PaymentMethod } from '@prisma/client'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

interface Props {
  smmProjectId: string
  clientPayments: SmmClientPaymentDTO[]
  setClientPayments: (updater: (prev: SmmClientPaymentDTO[]) => SmmClientPaymentDTO[]) => void
  project: SmmProjectDTO
  setProject: (updater: (prev: SmmProjectDTO) => SmmProjectDTO) => void
}

export default function SmmProjectFinanceTab({ smmProjectId, clientPayments, setClientPayments, project }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [plannedDate, setPlannedDate] = useState(new Date().toISOString().slice(0, 10))
  const [plannedAmount, setPlannedAmount] = useState(project.monthlyFee != null ? String(project.monthlyFee) : '')
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null)
  const [actualAmountDraft, setActualAmountDraft] = useState('')
  const [actualDateDraft, setActualDateDraft] = useState(new Date().toISOString().slice(0, 10))

  async function handleCreate() {
    if (!plannedAmount) { setError('Укажите сумму'); return }
    setSaving(true)
    setError(null)
    const result = await createSmmClientPayment(smmProjectId, {
      plannedDate, plannedAmount: parseFloat(plannedAmount), method: method || null,
    })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setClientPayments(prev => [...prev, result.data].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)))
    setFormOpen(false)
  }

  function startMarkPaid(p: SmmClientPaymentDTO) {
    setMarkingPaidId(p.id)
    setActualAmountDraft(String(p.plannedAmount))
    setActualDateDraft(new Date().toISOString().slice(0, 10))
  }

  async function handleMarkPaid(id: string) {
    const result = await markSmmClientPaymentPaid(id, actualDateDraft, parseFloat(actualAmountDraft))
    if (result.ok) {
      setClientPayments(prev => prev.map(p => p.id === id ? result.data : p))
      setMarkingPaidId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Платежи клиента</h3>
        <button type="button" onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Плановый платёж
        </button>
      </div>

      {formOpen && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Дата</label>
              <input className={INPUT} type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Сумма, ₽</label>
              <input className={INPUT} type="number" value={plannedAmount} onChange={e => setPlannedAmount(e.target.value)} />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Способ оплаты</label>
              <select className={SELECT} value={method} onChange={e => setMethod(e.target.value as PaymentMethod | '')}>
                <option value="">Не указан</option>
                {(Object.keys(ORDER_PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(m => <option key={m} value={m}>{ORDER_PAYMENT_METHOD_LABELS[m]}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCreate} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors">Отмена</button>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
        {clientPayments.map(p => (
          <div key={p.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-zinc-100 text-sm">{formatSmmMoney(p.plannedAmount)}</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  План: {formatDate(p.plannedDate)} · {SMM_CLIENT_PAYMENT_STATUS_LABELS[p.status]}
                  {p.actualDate && ` · Оплачено ${formatDate(p.actualDate)}${p.actualAmount != null ? ` (${formatSmmMoney(p.actualAmount)})` : ''}`}
                </p>
              </div>
              {p.status !== 'PAID' && p.status !== 'CANCELLED' && markingPaidId !== p.id && (
                <button type="button" onClick={() => startMarkPaid(p)} className="flex items-center gap-1 text-xs text-[#00c26b] hover:underline">
                  <Check className="w-3.5 h-3.5" /> Отметить оплаченным
                </button>
              )}
            </div>
            {markingPaidId === p.id && (
              <div className="mt-2 flex items-end gap-2 flex-wrap bg-zinc-800/40 border border-zinc-800 rounded-lg p-3">
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Дата оплаты</label>
                  <input className={INPUT} type="date" value={actualDateDraft} onChange={e => setActualDateDraft(e.target.value)} />
                </div>
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Сумма</label>
                  <input className={INPUT} type="number" value={actualAmountDraft} onChange={e => setActualAmountDraft(e.target.value)} />
                </div>
                <button type="button" onClick={() => handleMarkPaid(p.id)} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Подтвердить</button>
                <button type="button" onClick={() => setMarkingPaidId(null)} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-2">Отмена</button>
              </div>
            )}
          </div>
        ))}
        {clientPayments.length === 0 && <p className="text-zinc-500 text-sm px-5 py-6">Плановых платежей ещё нет</p>}
      </div>
    </div>
  )
}
