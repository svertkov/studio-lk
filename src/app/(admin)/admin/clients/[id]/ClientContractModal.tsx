'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import GlowPill from '@/components/ui/glow-pill'
import { createDocument, getNextContractNumberPreview } from '@/lib/actions/documents'
import { updateClientContractState } from '@/lib/actions/documents'
import { CLIENT_CONTRACT_STATE_LABELS, type ClientContractState } from '@/lib/document-model'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const LABEL = 'block text-zinc-400 text-xs mb-1.5'

const STATE_OPTIONS: ClientContractState[] = ['ACTIVE', 'PREPARING', 'NO_CONTRACT', 'ARCHIVED', 'UNSPECIFIED']

interface Props {
  clientId: string
  contractState: ClientContractState
  contractStateComment: string | null
  contractPlannedDate: string | null
  hasActiveContractDocument: boolean
  triggerClassName: string
  triggerLabel: string
}

// Договор клиента (ТЗ разд.5/7): смена договорного состояния — управляемая,
// не файловая. "ACTIVE" без ещё существующего Document(type=CONTRACT) требует
// либо создать номер (авто/исторический), либо это уже действующий договор,
// заведённый ранее — hasActiveContractDocument решает, какую ветку показать.
export default function ClientContractModal({
  clientId, contractState, contractStateComment, contractPlannedDate, hasActiveContractDocument, triggerClassName, triggerLabel,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ClientContractState>(contractState)
  const [comment, setComment] = useState(contractStateComment ?? '')
  const [plannedDate, setPlannedDate] = useState(contractPlannedDate ? contractPlannedDate.slice(0, 10) : '')
  const [createNumber, setCreateNumber] = useState(!hasActiveContractDocument)
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  // Номер договора — свободный текст (2026-07-27): поддерживает составные
  // форматы вроде "20-02.26" или "14/2026", не только целые числа (см.
  // Document.number в schema.prisma — String, не Int, ровно по этой причине).
  // Пусто -> автоматический номер по счётчику; заполнено (вручную или
  // выбором подсказки ниже) -> сохраняется как есть, isHistorical=true.
  const [historicalNumber, setHistoricalNumber] = useState('')
  const [nextNumber, setNextNumber] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsNewContractDoc = state === 'ACTIVE' && !hasActiveContractDocument && createNumber

  // Подсказка "следующий номер по порядку" — только чтение (см.
  // getNextContractNumberPreview), счётчик не трогает, поэтому открыть и
  // закрыть диалог несколько раз не пропускает номера.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    getNextContractNumberPreview().then(res => {
      if (!cancelled && res.ok) setNextNumber(res.data)
    })
    return () => { cancelled = true }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'NO_CONTRACT' && !comment.trim()) {
      setError('Добавьте короткий комментарий — почему работа без договора')
      return
    }
    setLoading(true)
    setError(null)

    if (needsNewContractDoc) {
      const trimmedNumber = historicalNumber.trim()
      const result = await createDocument({
        type: 'CONTRACT',
        clientId,
        issueDate,
        isHistorical: !!trimmedNumber,
        historicalNumber: trimmedNumber || null,
        comment: comment.trim() || null,
      })
      setLoading(false)
      if (!result.ok) { setError(result.error); return }
    } else {
      const result = await updateClientContractState({
        clientId,
        contractState: state,
        contractStateComment: comment.trim() || null,
        contractPlannedDate: state === 'PREPARING' && plannedDate ? plannedDate : null,
      })
      setLoading(false)
      if (!result.ok) { setError(result.error); return }
    }

    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{triggerLabel}</DialogTrigger>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Договор клиента</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={LABEL}>Состояние</label>
            <select className={SELECT} value={state} onChange={e => setState(e.target.value as ClientContractState)}>
              {STATE_OPTIONS.map(s => <option key={s} value={s}>{CLIENT_CONTRACT_STATE_LABELS[s]}</option>)}
            </select>
          </div>

          {state === 'ACTIVE' && !hasActiveContractDocument && (
            <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2.5">
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={createNumber} onChange={e => setCreateNumber(e.target.checked)} className="accent-[#00c26b]" />
                Присвоить номер договора сейчас
              </label>
              {createNumber && (
                <>
                  <div>
                    <label className={LABEL}>Дата договора</label>
                    <input type="date" className={INPUT} value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL}>Номер договора</label>
                    <input
                      type="text" className={INPUT} placeholder="Например, 20-02.26 или 14"
                      value={historicalNumber} onChange={e => setHistoricalNumber(e.target.value)}
                    />
                    {nextNumber != null && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-zinc-500 text-[11px]">Быстрый выбор:</span>
                        <GlowPill
                          as="button" color="zinc" size="sm"
                          onClick={() => setHistoricalNumber(String(nextNumber))}
                          title="Подставить следующий номер по порядку"
                          ariaLabel={`Подставить номер ${nextNumber} по порядку`}
                        >
                          №{nextNumber} по порядку
                        </GlowPill>
                      </div>
                    )}
                    <p className="text-zinc-500 text-xs mt-1.5">
                      {historicalNumber.trim()
                        ? 'Номер будет сохранён именно так, как введён.'
                        : 'Оставьте пустым — номер присвоится автоматически, по порядку.'}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {state === 'PREPARING' && (
            <div>
              <label className={LABEL}>Плановая дата подготовки</label>
              <input type="date" className={INPUT} value={plannedDate} onChange={e => setPlannedDate(e.target.value)} />
            </div>
          )}

          <div>
            <label className={LABEL}>
              Комментарий {state === 'NO_CONTRACT' && <span className="text-red-400">*</span>}
            </label>
            <textarea
              className={`${INPUT} min-h-[70px] resize-none`}
              placeholder={state === 'NO_CONTRACT' ? 'Почему работа ведётся без договора' : 'Необязательно'}
              value={comment} onChange={e => setComment(e.target.value)}
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              Отмена
            </button>
            <button
              type="submit" disabled={loading}
              className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
