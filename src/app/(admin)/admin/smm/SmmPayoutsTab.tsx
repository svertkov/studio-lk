'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getSmmPayments, createSmmPayment, type SmmWorkItemDTO, type SmmPaymentDTO } from '@/lib/actions/smm'
import { formatSmmMoney, SMM_WORK_TYPE_LABELS, SMM_PAYOUT_TYPE_LABELS } from '@/lib/smm-model'

function formatDate(v: string): string {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface Props {
  initialUnpaidWork: SmmWorkItemDTO[]
}

export default function SmmPayoutsTab({ initialUnpaidWork }: Props) {
  const [unpaidWork, setUnpaidWork] = useState(initialUnpaidWork)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<SmmPaymentDTO[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSmmPayments().then(res => setHistory(res.data))
  }, [])

  const byPerformer = useMemo(() => {
    const map = new Map<string, { name: string; items: SmmWorkItemDTO[] }>()
    for (const w of unpaidWork) {
      const entry = map.get(w.performerId) ?? { name: w.performerName, items: [] }
      entry.items.push(w)
      map.set(w.performerId, entry)
    }
    return [...map.entries()]
  }, [unpaidWork])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handlePay(performerId: string, items: SmmWorkItemDTO[]) {
    const chosen = items.filter(i => selected.has(i.id))
    const workItemIds = chosen.length > 0 ? chosen.map(i => i.id) : items.map(i => i.id)
    setSaving(performerId)
    setError(null)
    const result = await createSmmPayment({ performerId, workItemIds })
    setSaving(null)
    if (!result.ok) { setError(result.error); return }
    setUnpaidWork(prev => prev.filter(w => !workItemIds.includes(w.id)))
    setSelected(prev => { const next = new Set(prev); workItemIds.forEach(id => next.delete(id)); return next })
    setHistory(prev => prev ? [result.data, ...prev] : [result.data])
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      <div>
        <h3 className="text-white font-semibold text-sm mb-3">К выплате</h3>
        {byPerformer.length === 0 ? (
          <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6">Нет подтверждённых неоплаченных работ</p>
        ) : (
          <div className="space-y-3">
            {byPerformer.map(([performerId, { name, items }]) => {
              const total = items.reduce((sum, i) => sum + i.amount, 0)
              return (
                <div key={performerId} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-zinc-800">
                    <p className="text-white font-medium text-sm">{name}</p>
                    <div className="flex items-center gap-3">
                      <p className="text-zinc-300 text-sm font-medium">Итого: {formatSmmMoney(total)}</p>
                      <button
                        type="button"
                        onClick={() => handlePay(performerId, items)}
                        disabled={saving === performerId}
                        className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {saving === performerId ? 'Формирование...' : 'Отметить выплаченным'}
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-zinc-800/60">
                    {items.map(w => (
                      <label key={w.id} className="flex items-center gap-3 px-5 py-2 text-sm cursor-pointer hover:bg-zinc-800/30">
                        <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)} />
                        <span className="text-zinc-300 flex-1">
                          {w.smmProjectClientName ?? '—'} — {SMM_WORK_TYPE_LABELS[w.workType]} {w.description ? `(${w.description})` : ''}
                        </span>
                        <span className="text-zinc-500 text-xs">{formatDate(w.workDate)}</span>
                        <span className="text-zinc-200 font-medium w-20 text-right">{formatSmmMoney(w.amount)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-white font-semibold text-sm mb-3">История выплат</h3>
        {history === null ? (
          <p className="text-zinc-500 text-sm">Загрузка...</p>
        ) : history.length === 0 ? (
          <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6">Выплат ещё не было</p>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
            {history.map(p => {
              const isOpen = expanded.has(p.id)
              return (
                <div key={p.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next })}
                    className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                      <div>
                        <p className="text-zinc-100 text-sm">{p.performerName} · {SMM_PAYOUT_TYPE_LABELS[p.type]}</p>
                        <p className="text-zinc-500 text-xs mt-0.5">{formatDate(p.paidAt)}{p.method ? ` · ${p.method}` : ''}</p>
                      </div>
                    </div>
                    <p className="text-zinc-200 text-sm font-medium">{formatSmmMoney(p.amount)}</p>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-3 pl-11 space-y-1.5">
                      {p.comment && <p className="text-zinc-400 text-xs mb-2">{p.comment}</p>}
                      {p.workItems.length === 0 ? (
                        <p className="text-zinc-500 text-xs">Не связана с отдельными работами</p>
                      ) : p.workItems.map(w => (
                        <div key={w.id} className="flex items-center justify-between text-xs text-zinc-400">
                          <span>{w.smmProjectClientName ?? '—'} — {SMM_WORK_TYPE_LABELS[w.workType]}</span>
                          <span>{formatSmmMoney(w.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
