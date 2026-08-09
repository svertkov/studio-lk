'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createSmmContentItem, type SmmProjectDTO } from '@/lib/actions/smm'
import { CONTENT_SERVICE_TYPES, SMM_SERVICE_TYPE_LABELS } from '@/lib/smm-model'
import type { SmmServiceType } from '@prisma/client'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

interface Props {
  projects: SmmProjectDTO[]
  onOpenChange: (open: boolean) => void
  onCreated: (contentItemId: string) => void
}

// Быстрое создание единицы контента прямо из Production (ТЗ 2B, п.36) — не
// заставляет сначала заходить в карточку клиента: пикер SMM-проекта здесь
// же. Использует ТОТ ЖЕ createSmmContentItem, что и вкладка «Контент»
// карточки проекта — не вторая реализация создания.
export default function SmmContentItemCreateModal({ projects, onOpenChange, onCreated }: Props) {
  const [smmProjectId, setSmmProjectId] = useState('')
  const [serviceType, setServiceType] = useState<SmmServiceType>('SHORT_VIDEO')
  const [contentCode, setContentCode] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [productionBrief, setProductionBrief] = useState('')
  const [plannedPublishDate, setPlannedPublishDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeProjects = projects.filter(p => p.status === 'ACTIVE')

  async function handleCreate() {
    if (!smmProjectId) { setError('Выберите клиента / SMM-проект'); return }
    setSaving(true)
    setError(null)
    const result = await createSmmContentItem(smmProjectId, {
      serviceType, contentCode: contentCode || undefined, title: title || undefined,
      description: description || undefined, productionBrief: productionBrief || undefined,
      plannedPublishDate: plannedPublishDate || undefined,
    })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onCreated(result.data.id)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Новая единица контента</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Клиент / SMM-проект *</label>
            <select className={SELECT} value={smmProjectId} onChange={e => setSmmProjectId(e.target.value)}>
              <option value="">Выберите...</option>
              {activeProjects.map(p => <option key={p.id} value={p.id}>{p.clientName ?? 'Без имени'}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Тип</label>
              <select className={SELECT} value={serviceType} onChange={e => setServiceType(e.target.value as SmmServiceType)}>
                {CONTENT_SERVICE_TYPES.map(t => <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Content Code</label>
              <input className={INPUT} placeholder="напр. Д186" value={contentCode} onChange={e => setContentCode(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Название</label>
            <input className={INPUT} value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Описание / идея</label>
            <textarea className={INPUT} rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">ТЗ монтажёру</label>
            <textarea className={INPUT} rows={2} value={productionBrief} onChange={e => setProductionBrief(e.target.value)} />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Плановая готовность</label>
            <input className={INPUT} type="date" value={plannedPublishDate} onChange={e => setPlannedPublishDate(e.target.value)} />
          </div>
          {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={handleCreate} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving ? 'Создание...' : 'Создать'}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors">Отмена</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
