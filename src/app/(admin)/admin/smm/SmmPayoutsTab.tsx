'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronLeft, Plus } from 'lucide-react'
import {
  getSmmPayments, createSmmPayment, getSmmPayoutDueList, getSmmRecurringPayouts, createSmmRecurringPayout,
  setSmmRecurringPayoutActive, paySmmRecurringPayoutDue,
  type SmmWorkItemDTO, type SmmPaymentDTO, type SmmPayoutDueItemDTO, type SmmRecurringPayoutDTO, type SmmProjectDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import { formatSmmMoney, SMM_WORK_TYPE_LABELS, SMM_PAYOUT_TYPE_LABELS } from '@/lib/smm-model'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

function formatDate(v: string): string {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }

type Mode = 'calendar' | 'due' | 'history'

interface Props {
  initialUnpaidWork: SmmWorkItemDTO[]
  editors: EditorProfileListItemDTO[]
  projects: SmmProjectDTO[]
}

// SMM → Выплаты — 3 режима (docs/business/SMM.md, «Выплаты»): Календарь
// (что и когда нужно заплатить — сдельные+регулярные обязательства),
// К выплате (подтверждённые неоплаченные сдельные работы, как раньше),
// История (совершённые выплаты). Регулярные выплаты (SmmRecurringPayout) —
// план обязательства, факт — обычный SmmPayment (не второй финансовый
// объект, ТЗ п.41).
export default function SmmPayoutsTab({ initialUnpaidWork, editors, projects }: Props) {
  const [mode, setMode] = useState<Mode>('due')
  const [unpaidWork, setUnpaidWork] = useState(initialUnpaidWork)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<SmmPaymentDTO[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [dueList, setDueList] = useState<SmmPayoutDueItemDTO[]>([])
  const [dueLoading, setDueLoading] = useState(true)
  const [recurringPayouts, setRecurringPayouts] = useState<SmmRecurringPayoutDTO[] | null>(null)
  const [creatingRecurring, setCreatingRecurring] = useState(false)
  const [recurringForm, setRecurringForm] = useState({ performerId: '', smmProjectId: '', amount: '', days: '', startDate: new Date().toISOString().slice(0, 10), notes: '' })

  useEffect(() => {
    getSmmPayments().then(res => setHistory(res.data))
    getSmmRecurringPayouts().then(res => setRecurringPayouts(res.data))
  }, [])

  useEffect(() => {
    if (mode !== 'calendar') return
    getSmmPayoutDueList(startOfMonth(monthAnchor).toISOString(), endOfMonth(monthAnchor).toISOString()).then(res => {
      setDueLoading(false)
      if (res.ok) setDueList(res.data)
    })
  }, [mode, monthAnchor])

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

  async function handlePayDueItem(item: SmmPayoutDueItemDTO) {
    setSaving(item.id)
    setError(null)
    const result = item.kind === 'RECURRING' && item.recurringPayoutId && item.periodDate
      ? await paySmmRecurringPayoutDue(item.recurringPayoutId, item.periodDate, {})
      : item.workItemId ? await createSmmPayment({ performerId: item.performerId, workItemIds: [item.workItemId] }) : null
    setSaving(null)
    if (!result) return
    if (!result.ok) { setError(result.error); return }
    setDueList(prev => prev.filter(d => d.id !== item.id))
    setHistory(prev => prev ? [result.data, ...prev] : [result.data])
    if (item.workItemId) setUnpaidWork(prev => prev.filter(w => w.id !== item.workItemId))
  }

  async function handleCreateRecurring() {
    const days = recurringForm.days.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    if (!recurringForm.performerId || !recurringForm.amount || days.length === 0) { setError('Укажите исполнителя, сумму и хотя бы один день месяца'); return }
    setError(null)
    const result = await createSmmRecurringPayout({
      performerId: recurringForm.performerId, smmProjectId: recurringForm.smmProjectId || null,
      amount: parseFloat(recurringForm.amount), daysOfMonth: days, startDate: recurringForm.startDate, notes: recurringForm.notes || undefined,
    })
    if (!result.ok) { setError(result.error); return }
    setRecurringPayouts(prev => [result.data, ...(prev ?? [])])
    setCreatingRecurring(false)
    setRecurringForm({ performerId: '', smmProjectId: '', amount: '', days: '', startDate: new Date().toISOString().slice(0, 10), notes: '' })
    const dueResult = await getSmmPayoutDueList(startOfMonth(monthAnchor).toISOString(), endOfMonth(monthAnchor).toISOString())
    if (dueResult.ok) setDueList(dueResult.data)
  }

  async function handleDeactivateRecurring(id: string) {
    const result = await setSmmRecurringPayoutActive(id, false)
    if (!result.ok) return
    setRecurringPayouts(prev => (prev ?? []).map(p => (p.id === id ? result.data : p)))
    setDueList(prev => prev.filter(d => d.recurringPayoutId !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
        <button type="button" onClick={() => setMode('calendar')} className={`px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'calendar' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Календарь</button>
        <button type="button" onClick={() => setMode('due')} className={`px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'due' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>К выплате</button>
        <button type="button" onClick={() => setMode('history')} className={`px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'history' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>История</button>
      </div>

      {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      {mode === 'calendar' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <p className="text-zinc-300 text-sm capitalize w-36 text-center">{monthLabel(monthAnchor)}</p>
            <button type="button" onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors">→</button>
          </div>

          {dueLoading ? (
            <p className="text-zinc-500 text-sm">Загрузка...</p>
          ) : dueList.length === 0 ? (
            <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6">На этот месяц обязательств нет</p>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400">Дата</TableHead>
                    <TableHead className="text-zinc-400">Исполнитель</TableHead>
                    <TableHead className="text-zinc-400">Клиент</TableHead>
                    <TableHead className="text-zinc-400">File Code</TableHead>
                    <TableHead className="text-zinc-400">Описание</TableHead>
                    <TableHead className="text-zinc-400">Сумма</TableHead>
                    <TableHead className="text-zinc-400" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dueList.map(item => (
                    <TableRow key={item.id} className="border-zinc-800">
                      <TableCell><span className="text-zinc-300 text-xs">{formatDate(item.date)}</span></TableCell>
                      <TableCell><span className="text-zinc-200 text-sm">{item.performerName}</span></TableCell>
                      <TableCell><span className="text-zinc-400 text-xs">{item.smmProjectClientName ?? '—'}</span></TableCell>
                      <TableCell><span className="text-zinc-400 text-xs font-mono">{item.fileCode ?? '—'}</span></TableCell>
                      <TableCell>
                        <span className="text-zinc-400 text-xs">
                          {item.kind === 'RECURRING' ? 'Регулярная выплата' : SMM_WORK_TYPE_LABELS[item.workType!]}
                          {item.contentItemTitle ? ` — ${item.contentItemTitle}` : ''}
                          {item.description ? ` (${item.description})` : ''}
                        </span>
                      </TableCell>
                      <TableCell><span className="text-zinc-200 text-sm font-medium">{formatSmmMoney(item.amount)}</span></TableCell>
                      <TableCell>
                        <button type="button" onClick={() => handlePayDueItem(item)} disabled={saving === item.id} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                          {saving === item.id ? '...' : 'Оплатить'}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold text-sm">Регулярные обязательства</h3>
              <button type="button" onClick={() => setCreatingRecurring(v => !v)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"><Plus className="w-3.5 h-3.5" /> Добавить</button>
            </div>
            {creatingRecurring && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-3 flex items-end gap-2 flex-wrap">
                <select className="h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b]" value={recurringForm.performerId} onChange={e => setRecurringForm(f => ({ ...f, performerId: e.target.value }))}>
                  <option value="">Исполнитель...</option>
                  {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
                </select>
                <select className="h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b]" value={recurringForm.smmProjectId} onChange={e => setRecurringForm(f => ({ ...f, smmProjectId: e.target.value }))}>
                  <option value="">Без привязки к клиенту</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.clientName ?? 'Без имени'}</option>)}
                </select>
                <input className="h-9 w-28 bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b]" type="number" placeholder="Сумма, ₽" value={recurringForm.amount} onChange={e => setRecurringForm(f => ({ ...f, amount: e.target.value }))} />
                <input className="h-9 w-36 bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b]" placeholder="Дни, напр. 2,17" value={recurringForm.days} onChange={e => setRecurringForm(f => ({ ...f, days: e.target.value }))} />
                <input className="h-9 bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b]" type="date" value={recurringForm.startDate} onChange={e => setRecurringForm(f => ({ ...f, startDate: e.target.value }))} />
                <input className="h-9 flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b]" placeholder="Комментарий" value={recurringForm.notes} onChange={e => setRecurringForm(f => ({ ...f, notes: e.target.value }))} />
                <button type="button" onClick={handleCreateRecurring} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Создать</button>
              </div>
            )}
            {recurringPayouts === null ? (
              <p className="text-zinc-500 text-sm">Загрузка...</p>
            ) : recurringPayouts.filter(p => p.active).length === 0 ? (
              <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6">Регулярных обязательств нет</p>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
                {recurringPayouts.filter(p => p.active).map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="text-zinc-200">{p.performerName}{p.smmProjectClientName ? ` · ${p.smmProjectClientName}` : ''} — {formatSmmMoney(p.amount)} · {p.daysOfMonth.join(', ')} числа</span>
                    <button type="button" onClick={() => handleDeactivateRecurring(p.id)} className="text-zinc-500 hover:text-red-400 text-xs">остановить</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'due' && (
        <div>
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
                            {w.fileCode && <span className="text-zinc-500 font-mono text-xs ml-2">{w.fileCode}</span>}
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
      )}

      {mode === 'history' && (
        <div>
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
                          <p className="text-zinc-100 text-sm">
                            {p.performerName} · {SMM_PAYOUT_TYPE_LABELS[p.type]}
                            {p.recurringPayoutId && <span className="text-[10px] text-blue-300 bg-blue-950/40 border border-blue-800/40 rounded-full px-1.5 py-0.5 ml-2">регулярная</span>}
                          </p>
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
                            <span>{w.smmProjectClientName ?? '—'} — {SMM_WORK_TYPE_LABELS[w.workType]}{w.fileCode && <span className="font-mono ml-2">{w.fileCode}</span>}</span>
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
      )}
    </div>
  )
}
