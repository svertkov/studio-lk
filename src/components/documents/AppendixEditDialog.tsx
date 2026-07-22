'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { updateDocument, getContractsForClient, type DocumentDTO, type ClientContractOptionDTO } from '@/lib/actions/documents'

const INPUT = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm px-3 text-zinc-100 outline-none focus:border-[#00c26b] transition-colors'
const LABEL = 'text-zinc-500 text-xs'
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-zinc-500 transition-colors resize-none'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  appendix: DocumentDTO
  // Клиент, которому принадлежит договор приложения — тот же clientId, что
  // уже есть у WorkDocumentsSection (сам Document.clientId для APPENDIX
  // всегда null, см. AGENTS.md, "Клиент приложения не хранится напрямую").
  // Нужен только для списка "другие договоры этого же клиента" — без него
  // (клиент не привязан) переподключение просто не предлагается.
  clientId: string | null
  onUpdated: (updated: DocumentDTO) => void
}

// Единственная форма редактирования документа-приложения — переиспользуется
// везде, где уже встроен WorkDocumentsSection (карточка заказа, карточка
// монтажа), а не дублируется под каждый контекст отдельно. Полностью
// самодостаточна: сама грузит список договоров клиента и сохраняет через
// existing updateDocument (обновляет запись, не создаёт новую), тот же
// overlay-паттерн, что OrderFinanceBlock/MontageDisableChoiceDialog.
export default function AppendixEditDialog({ open, onOpenChange, appendix, clientId, onUpdated }: Props) {
  const [number, setNumber] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [amount, setAmount] = useState('')
  const [serviceDescription, setServiceDescription] = useState('')
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [otherContracts, setOtherContracts] = useState<ClientContractOptionDTO[] | null>(null)
  const [changingContract, setChangingContract] = useState(false)
  const [selectedContractId, setSelectedContractId] = useState('')

  // setState отложен через setTimeout(…, 0) — react-hooks/set-state-in-effect
  // не разрешает синхронный setState в теле эффекта (см. память проекта).
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      setNumber(appendix.number ?? '')
      setIssueDate(appendix.issueDate.slice(0, 10))
      setAmount(appendix.amount != null ? String(appendix.amount) : '')
      setServiceDescription(appendix.serviceDescription ?? '')
      setComment(appendix.comment ?? '')
      setReason('')
      setError(null)
      setChangingContract(false)
      setSelectedContractId(appendix.contractId ?? '')
    }, 0)
    return () => clearTimeout(timer)
  }, [open, appendix])

  useEffect(() => {
    if (!open || !clientId) {
      const timer = setTimeout(() => setOtherContracts(null), 0)
      return () => clearTimeout(timer)
    }
    let cancelled = false
    getContractsForClient(clientId).then(res => {
      if (cancelled || !res.ok) return
      setOtherContracts(res.data.filter(c => c.id !== appendix.contractId))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId])

  const numberChanged = number.trim() !== (appendix.number ?? '')

  async function handleSave() {
    if (!number.trim()) { setError('Укажите номер приложения'); return }
    setSaving(true)
    setError(null)
    const result = await updateDocument({
      id: appendix.id,
      number,
      issueDate,
      amount: amount.trim() ? parseFloat(amount) : null,
      serviceDescription: serviceDescription.trim() || null,
      comment: comment.trim() || null,
      contractId: changingContract && selectedContractId && selectedContractId !== appendix.contractId ? selectedContractId : undefined,
      reason: numberChanged ? (reason.trim() || null) : undefined,
    })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onUpdated(result.data)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Приложение к договору</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={LABEL}>Номер приложения</label>
              <input className={INPUT} value={number} onChange={e => setNumber(e.target.value)} placeholder="напр. 1 или 1-А" />
            </div>
            <div className="space-y-1.5">
              <label className={LABEL}>Дата</label>
              <input className={INPUT} type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={LABEL}>Сумма, ₽</label>
            <input className={INPUT} type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="напр. 50000" />
          </div>
          <div className="space-y-1.5">
            <label className={LABEL}>Описание услуги</label>
            <textarea className={TEXTAREA} rows={3} value={serviceDescription} onChange={e => setServiceDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className={LABEL}>Комментарий</label>
            <input className={INPUT} value={comment} onChange={e => setComment(e.target.value)} />
          </div>

          {numberChanged && (
            <div className="space-y-1.5">
              <label className={LABEL}>Причина изменения номера (необязательно)</label>
              <input className={INPUT} value={reason} onChange={e => setReason(e.target.value)} placeholder="напр. опечатка при создании" />
            </div>
          )}

          {otherContracts !== null && otherContracts.length > 0 && (
            <div className="space-y-1.5">
              {!changingContract ? (
                <button type="button" className="text-zinc-500 text-xs underline hover:text-zinc-300" onClick={() => setChangingContract(true)}>
                  Изменить договор
                </button>
              ) : (
                <>
                  <label className={LABEL}>Договор</label>
                  <select className={`${INPUT} cursor-pointer`} value={selectedContractId} onChange={e => setSelectedContractId(e.target.value)}>
                    {appendix.contractId && <option value={appendix.contractId}>Оставить текущий</option>}
                    {otherContracts.map(c => <option key={c.id} value={c.id}>{c.displayNumber}</option>)}
                  </select>
                  <p className="text-zinc-600 text-[11px]">Можно перевыбрать только договор того же клиента.</p>
                </>
              )}
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
        <DialogFooter className="bg-zinc-900 border-zinc-800">
          <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Отмена
          </button>
          <button type="button" disabled={saving} onClick={handleSave}
            className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
