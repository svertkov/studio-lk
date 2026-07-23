'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { updateDocument, type DocumentDTO } from '@/lib/actions/documents'

const INPUT = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm px-3 text-zinc-100 outline-none focus:border-[#00c26b] transition-colors'
const LABEL = 'text-zinc-500 text-xs'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentDTO
  onUpdated: (updated: DocumentDTO) => void
}

// Лёгкий редактор ручного номера счёта/акта — НЕ то же самое, что
// AppendixEditDialog: там номер обязателен и есть переподключение к другому
// договору, здесь номер необязателен (пустая строка возвращает документ к
// вычисляемому workPackageNumber+suffix, см. getDocumentDisplayNumber) и нет
// связанных сущностей для переподключения. Общий сервер — тот же
// updateDocument, что и у приложения (см. AGENTS.md, "документные реквизиты").
export default function DocumentNumberEditDialog({ open, onOpenChange, document, onUpdated }: Props) {
  const [number, setNumber] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      setNumber(document.number ?? '')
      setReason('')
      setError(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [open, document])

  const numberChanged = number.trim() !== (document.number ?? '')
  const typeLabel = document.type === 'INVOICE' ? 'счёта' : 'акта'

  async function handleSave() {
    setSaving(true)
    setError(null)
    const result = await updateDocument({
      id: document.id,
      number: number.trim() || null,
      reason: numberChanged ? (reason.trim() || null) : undefined,
    })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onUpdated(result.data)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Номер {typeLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className={LABEL}>Номер (пусто — вернуться к автоматическому)</label>
            <input className={INPUT} value={number} onChange={e => setNumber(e.target.value)} placeholder="напр. 2026-014" />
          </div>
          {numberChanged && (
            <div className="space-y-1.5">
              <label className={LABEL}>Причина изменения (необязательно)</label>
              <input className={INPUT} value={reason} onChange={e => setReason(e.target.value)} placeholder="напр. опечатка при создании" />
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
