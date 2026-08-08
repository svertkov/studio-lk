'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { linkSmmScheduleEvent, unlinkSmmScheduleEvent, type SmmScheduleLinkDTO, type SmmContentItemDTO } from '@/lib/actions/smm'
import { EVENT_TYPE_LABELS } from '@/lib/event-type'

const SELECT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

function formatDateTime(v: string | null): string {
  return v ? new Date(v).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

interface Props {
  smmProjectId: string
  scheduleLinks: SmmScheduleLinkDTO[]
  setScheduleLinks: (updater: (prev: SmmScheduleLinkDTO[]) => SmmScheduleLinkDTO[]) => void
  contentItems: SmmContentItemDTO[]
  unlinkedScheduleEvents: { id: string; title: string | null; startAt: string | null }[]
}

export default function SmmProjectShootsTab({ smmProjectId, scheduleLinks, setScheduleLinks, contentItems, unlinkedScheduleEvents }: Props) {
  const [selectedEventId, setSelectedEventId] = useState('')
  const [includedInPackage, setIncludedInPackage] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkedIds = new Set(scheduleLinks.map(l => l.scheduleEventId))
  const available = unlinkedScheduleEvents.filter(e => !linkedIds.has(e.id))

  async function handleLink() {
    if (!selectedEventId) return
    setSaving(true)
    setError(null)
    const result = await linkSmmScheduleEvent(smmProjectId, selectedEventId, includedInPackage)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setScheduleLinks(prev => [result.data, ...prev])
    setSelectedEventId('')
  }

  async function handleUnlink(id: string) {
    const result = await unlinkSmmScheduleEvent(id)
    if (result.ok) setScheduleLinks(prev => prev.filter(l => l.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-zinc-400 text-xs mb-1.5">Привязать существующую съёмку клиента</label>
          <select className={`${SELECT} w-full`} value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
            <option value="">Выберите съёмку...</option>
            {available.map(e => (
              <option key={e.id} value={e.id}>{e.title ?? 'Без названия'} — {formatDateTime(e.startAt)}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300 pb-2 cursor-pointer">
          <input type="checkbox" checked={includedInPackage} onChange={e => setIncludedInPackage(e.target.checked)} />
          Входит в пакет
        </label>
        <button type="button" onClick={handleLink} disabled={saving || !selectedEventId} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Привязать
        </button>
      </div>
      {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
      {available.length === 0 && (
        <p className="text-zinc-500 text-xs">У клиента нет свободных записей в расписании для привязки — сначала создайте заказ/запись в CRM или Расписании.</p>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
        {scheduleLinks.map(link => {
          const relatedContent = contentItems.filter(c => c.scheduleEventId === link.scheduleEventId)
          return (
            <div key={link.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-zinc-100 text-sm">{link.eventTitle ?? 'Без названия'}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    {formatDateTime(link.eventStartAt)} · {EVENT_TYPE_LABELS[link.eventType]}
                    {link.eventRoom && ` · ${link.eventRoom}`}
                    {link.includedInPackage ? ' · в пакете' : ' · отдельно'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {link.orderId && (
                    <Link href={`/admin/crm?openOrderId=${link.orderId}`} className="text-xs text-zinc-400 hover:text-white underline">Открыть заказ</Link>
                  )}
                  <button type="button" onClick={() => handleUnlink(link.id)} className="text-zinc-500 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {relatedContent.length > 0 && (
                <p className="text-zinc-500 text-xs mt-1.5">Снято: {relatedContent.map(c => c.title ?? 'Без названия').join(', ')}</p>
              )}
            </div>
          )
        })}
        {scheduleLinks.length === 0 && <p className="text-zinc-500 text-sm px-5 py-6">Съёмки ещё не привязаны</p>}
      </div>
    </div>
  )
}
