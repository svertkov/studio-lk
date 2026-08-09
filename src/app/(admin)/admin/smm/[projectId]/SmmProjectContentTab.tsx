'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  createSmmContentItem, getSmmContentItemDetail, getSmmProjectContentRows, getSmmContentItems,
  type SmmContentItemDTO, type SmmContentItemInput, type SmmContentItemDetailDTO, type SmmWorkItemDTO, type SmmClientContentRowDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { CONTENT_SERVICE_TYPES, SMM_SERVICE_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS } from '@/lib/smm-model'
import type { SmmContentStatus, SmmServiceType } from '@prisma/client'
import SmmContentItemCard from '@/components/smm/SmmContentItemCard'
import SmmProjectContentTable from './SmmProjectContentTable'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

const EMPTY_FORM: SmmContentItemInput = {
  serviceType: 'SHORT_VIDEO', title: '', description: '', productionBrief: '', plannedPublishDate: '', deadline: '',
  status: 'IDEA', responsibleUserId: '', editorId: '', parentContentId: '', notes: '',
}

interface Props {
  smmProjectId: string
  contentItems: SmmContentItemDTO[]
  setContentItems: (updater: (prev: SmmContentItemDTO[]) => SmmContentItemDTO[]) => void
  initialContentRows: SmmClientContentRowDTO[]
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
  workItems: SmmWorkItemDTO[]
  setWorkItems: (updater: (prev: SmmWorkItemDTO[]) => SmmWorkItemDTO[]) => void
}

// Полноценная таблица контента клиента (следующий этап после 2B,
// docs/business/SMM.md, «Views») — SmmProjectContentTable.tsx, тот же
// SmmContentItem, что в Production. Существующие единицы контента
// открываются в ТОЙ ЖЕ канонической карточке, что и SMM → Производство (ТЗ
// 2B, п.35) — публикации/материалы/монтаж/работы/съёмки живут только там.
// Инлайн-форма ниже — ТОЛЬКО быстрое создание, оставлена как есть (явно
// разрешено ТЗ). contentRows — отдельное состояние от лёгкого contentItems
// (тот нужен другим вкладкам — Обзор/Пакет/Съёмки), обновляется явным
// рефетчем внутри обработчиков событий (create/delete/card-changed), не
// эффектом при монтаже.
export default function SmmProjectContentTab({ smmProjectId, contentItems, setContentItems, initialContentRows, editors, staff, setWorkItems }: Props) {
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<SmmContentItemInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openDetail, setOpenDetail] = useState<SmmContentItemDetailDTO | null>(null)
  const [contentRows, setContentRows] = useState(initialContentRows)

  // Обновляет ОБА состояния (лёгкий список для Обзора/Пакета/Съёмок + богатую
  // таблицу этой вкладки) одним server-refetch каждое — единый источник
  // правды с сервера вместо ручного клиентского маппинга detail→list DTO
  // (который расходился бы при малейшем несовпадении полей).
  async function refetchAll() {
    const [rowsResult, itemsResult] = await Promise.all([getSmmProjectContentRows(smmProjectId), getSmmContentItems(smmProjectId)])
    if (rowsResult.ok) setContentRows(rowsResult.data)
    if (itemsResult.ok) setContentItems(() => itemsResult.data)
  }

  async function handleCreate() {
    setSaving(true)
    setError(null)
    const result = await createSmmContentItem(smmProjectId, form)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setCreating(false)
    setForm(EMPTY_FORM)
    await refetchAll()
  }

  async function openContentItem(id: string) {
    const result = await getSmmContentItemDetail(id)
    if (!result.ok) { setError(result.error); return }
    setOpenDetail(result.data)
  }

  async function handleCardChanged(updated: SmmContentItemDetailDTO) {
    setOpenDetail(updated)
    setWorkItems(prev => [...prev.filter(w => w.contentItemId !== updated.id), ...updated.workItems])
    await refetchAll()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Контент</h3>
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Добавить единицу контента
        </button>
      </div>

      {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      {creating && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Тип</label>
              <select className={SELECT} value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value as SmmServiceType }))}>
                {CONTENT_SERVICE_TYPES.map(t => <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Родительский контент</label>
              <select className={SELECT} value={form.parentContentId ?? ''} onChange={e => setForm(f => ({ ...f, parentContentId: e.target.value }))}>
                <option value="">Нет</option>
                {contentItems.map(c => (
                  <option key={c.id} value={c.id}>{c.title || SMM_SERVICE_TYPE_LABELS[c.serviceType]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Название</label>
            <input className={INPUT} value={form.title ?? ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Описание / идея</label>
            <textarea className={INPUT} rows={2} value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">ТЗ монтажёру</label>
            <textarea className={INPUT} rows={2} placeholder="Монтаж с 2:58. Вставить фрагмент про... Исходники 8931, 8915." value={form.productionBrief ?? ''} onChange={e => setForm(f => ({ ...f, productionBrief: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Статус</label>
              <select className={SELECT} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as SmmContentStatus }))}>
                {(Object.keys(SMM_CONTENT_STATUS_LABELS) as SmmContentStatus[]).map(s => <option key={s} value={s}>{SMM_CONTENT_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Плановая готовность</label>
              <input className={INPUT} type="date" value={form.plannedPublishDate ?? ''} onChange={e => setForm(f => ({ ...f, plannedPublishDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Дедлайн</label>
              <input className={INPUT} type="date" value={form.deadline ?? ''} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Ответственный</label>
              <select className={SELECT} value={form.responsibleUserId ?? ''} onChange={e => setForm(f => ({ ...f, responsibleUserId: e.target.value }))}>
                <option value="">Не назначен</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Монтажёр</label>
              <select className={SELECT} value={form.editorId ?? ''} onChange={e => setForm(f => ({ ...f, editorId: e.target.value }))}>
                <option value="">Не назначен</option>
                {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={handleCreate} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors">Отмена</button>
          </div>
        </div>
      )}

      <SmmProjectContentTable rows={contentRows} onOpen={openContentItem} />

      {openDetail && (
        <SmmContentItemCard
          detail={openDetail}
          editors={editors}
          staff={staff}
          onOpenChange={open => { if (!open) { setOpenDetail(null); refetchAll() } }}
          onChanged={handleCardChanged}
          onOpenContentItem={openContentItem}
        />
      )}
    </div>
  )
}
