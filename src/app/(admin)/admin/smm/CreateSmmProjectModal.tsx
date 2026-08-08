'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { createSmmProject, type SmmProjectSummaryDTO } from '@/lib/actions/smm'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-10 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const LABEL = 'block text-zinc-400 text-xs mb-1.5'

interface ClientOption { id: string; name: string }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: ClientOption[]
  existingProjects: SmmProjectSummaryDTO[]
  onCreated: (project: SmmProjectSummaryDTO) => void
}

export default function CreateSmmProjectModal({ open, onOpenChange, clients, existingProjects, onCreated }: Props) {
  const [clientId, setClientId] = useState('')
  const [monthlyFee, setMonthlyFee] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [billingPeriodType, setBillingPeriodType] = useState<'CALENDAR_MONTH' | 'CUSTOM'>('CUSTOM')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clientHasActiveProject = existingProjects.some(p => p.clientId === clientId && p.status === 'ACTIVE')

  function reset() {
    setClientId(''); setMonthlyFee(''); setStartDate(new Date().toISOString().slice(0, 10))
    setBillingPeriodType('CUSTOM'); setPaymentTerms(''); setNotes(''); setConfirmDuplicate(false); setError(null)
  }

  async function handleSave() {
    if (!clientId) { setError('Выберите клиента'); return }
    setSaving(true)
    setError(null)
    const result = await createSmmProject({
      clientId,
      monthlyFee: monthlyFee ? parseFloat(monthlyFee) : null,
      startDate,
      billingPeriodType,
      paymentTerms: paymentTerms.trim() || null,
      notes: notes.trim() || null,
      confirmDuplicateForClient: confirmDuplicate,
    })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onCreated({
      ...result.data,
      primaryResponsibleName: null,
      nextPaymentDate: null,
      nextPaymentAmount: null,
      packageDoneCount: 0,
      packageTargetCount: 0,
      hasOverdueContent: false,
    })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={next => { onOpenChange(next); if (!next) reset() }}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Новый SMM-проект</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className={LABEL}>Клиент *</label>
            <select className={SELECT} value={clientId} onChange={e => { setClientId(e.target.value); setConfirmDuplicate(false) }}>
              <option value="">Выберите клиента...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {clientHasActiveProject && (
            <div className="bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2.5 text-xs text-amber-300 space-y-2">
              <p>У этого клиента уже есть активный SMM-проект. Создать ещё один?</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={confirmDuplicate} onChange={e => setConfirmDuplicate(e.target.checked)} />
                Да, создать второй проект
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Стоимость ведения, ₽/мес</label>
              <input className={INPUT} type="number" min="0" placeholder="напр. 185000" value={monthlyFee} onChange={e => setMonthlyFee(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Дата начала</label>
              <input className={INPUT} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={LABEL}>Расчётный период</label>
            <select className={SELECT} value={billingPeriodType} onChange={e => setBillingPeriodType(e.target.value as 'CALENDAR_MONTH' | 'CUSTOM')}>
              <option value="CUSTOM">От даты начала (напр. 08.08–07.09)</option>
              <option value="CALENDAR_MONTH">Календарный месяц</option>
            </select>
          </div>

          <div>
            <label className={LABEL}>Условия оплаты</label>
            <input className={INPUT} placeholder="напр. 2 раза в месяц: аванс 10, остаток 25" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
          </div>

          <div>
            <label className={LABEL}>Комментарий</label>
            <textarea className={INPUT} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <DialogFooter className="bg-zinc-900 border-zinc-800">
          <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Отмена</button>
          <button type="button" onClick={handleSave} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {saving ? 'Создание...' : 'Создать проект'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
