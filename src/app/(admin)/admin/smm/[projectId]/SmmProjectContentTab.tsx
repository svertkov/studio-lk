'use client'

import { useState } from 'react'
import { Plus, Trash2, Film } from 'lucide-react'
import {
  createSmmContentItem, deleteSmmContentItem, getSmmContentItemDetail,
  type SmmContentItemDTO, type SmmContentItemInput, type SmmContentItemDetailDTO, type SmmWorkItemDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { CONTENT_SERVICE_TYPES, SMM_SERVICE_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS } from '@/lib/smm-model'
import type { SmmContentStatus, SmmServiceType } from '@prisma/client'
import SmmContentItemCard from '@/components/smm/SmmContentItemCard'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

const EMPTY_FORM: SmmContentItemInput = {
  serviceType: 'SHORT_VIDEO', title: '', description: '', productionBrief: '', plannedPublishDate: '', deadline: '',
  status: 'IDEA', responsibleUserId: '', editorId: '', parentContentId: '', contentCode: '', notes: '',
}

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'
}

// SmmContentItemDetailDTO (полная карточка) → SmmContentItemDTO (лёгкий
// список этой вкладки) — та же пара DTO, что и в Production (actions/smm.ts,
// «ДВЕ разные модели: список vs карточка», ТЗ 2B п.4). Deprecated-поля
// (scheduleEventId/sourceUrl/resultUrl/publishedUrl, см. SmmContentItemDTO)
// остаются null — их источник правды давно не они (см. комментарии в schema.prisma).
function detailToListItem(d: SmmContentItemDetailDTO): SmmContentItemDTO {
  return {
    id: d.id, smmProjectId: d.smmProjectId, serviceType: d.serviceType, customServiceType: d.customServiceType,
    title: d.title, description: d.description, productionBrief: d.productionBrief,
    plannedPublishDate: d.plannedPublishDate, deadline: d.deadline, status: d.status,
    responsibleUserId: d.responsibleUserId, responsibleUserName: d.responsibleUserName,
    editorId: d.editorId, editorName: d.editorName,
    editingProjectId: d.editingProjectId, editingProjectStatus: d.editingProjectStatus,
    editingProjectStatusLabel: d.editingProjectStatusLabel, editingProjectDeliveryUrl: d.editingProjectDeliveryUrl,
    scheduleEventId: null,
    scheduleEvents: d.scheduleEvents.map(e => ({ linkId: e.linkId, scheduleEventId: e.scheduleEventId, title: e.title, startAt: e.startAt })),
    sourceUrl: null, resultUrl: null, publishedUrl: null,
    contentCode: d.contentCode, parentContentId: d.parentContentId, parentContentTitle: d.parentContentTitle, parentContentCode: d.parentContentCode,
    childContent: d.childContent, publications: d.publications, clientApprovalStatus: d.clientApprovalStatus, notes: d.notes,
    createdAt: d.createdAt, updatedAt: d.updatedAt,
  }
}

interface Props {
  smmProjectId: string
  contentItems: SmmContentItemDTO[]
  setContentItems: (updater: (prev: SmmContentItemDTO[]) => SmmContentItemDTO[]) => void
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
  workItems: SmmWorkItemDTO[]
  setWorkItems: (updater: (prev: SmmWorkItemDTO[]) => SmmWorkItemDTO[]) => void
}

// Существующие единицы контента открываются в ТОЙ ЖЕ канонической карточке,
// что и SMM → Производство (ТЗ 2B, п.35: "не создавать вторую UI-реализацию
// редактирования ContentItem") — публикации/материалы/монтаж/работы/съёмки
// живут только там. Инлайн-форма ниже — ТОЛЬКО быстрое создание, оставлена
// как есть (явно разрешено ТЗ).
export default function SmmProjectContentTab({ smmProjectId, contentItems, setContentItems, editors, staff, workItems, setWorkItems }: Props) {
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<SmmContentItemInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openDetail, setOpenDetail] = useState<SmmContentItemDetailDTO | null>(null)

  async function handleCreate() {
    setSaving(true)
    setError(null)
    const result = await createSmmContentItem(smmProjectId, form)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setContentItems(prev => [result.data, ...prev])
    setCreating(false)
    setForm(EMPTY_FORM)
  }

  async function handleDelete(id: string) {
    const result = await deleteSmmContentItem(id)
    if (result.ok) setContentItems(prev => prev.filter(c => c.id !== id))
  }

  async function openContentItem(id: string) {
    const result = await getSmmContentItemDetail(id)
    if (!result.ok) { setError(result.error); return }
    setOpenDetail(result.data)
  }

  function handleCardChanged(updated: SmmContentItemDetailDTO) {
    setOpenDetail(updated)
    setContentItems(prev => prev.map(c => (c.id === updated.id ? detailToListItem(updated) : c)))
    setWorkItems(prev => [...prev.filter(w => w.contentItemId !== updated.id), ...updated.workItems])
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Тип</label>
              <select className={SELECT} value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value as SmmServiceType }))}>
                {CONTENT_SERVICE_TYPES.map(t => <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Content Code</label>
              <input className={INPUT} placeholder="напр. Д186" value={form.contentCode ?? ''} onChange={e => setForm(f => ({ ...f, contentCode: e.target.value }))} />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Родительский контент</label>
              <select className={SELECT} value={form.parentContentId ?? ''} onChange={e => setForm(f => ({ ...f, parentContentId: e.target.value }))}>
                <option value="">Нет</option>
                {contentItems.map(c => (
                  <option key={c.id} value={c.id}>{c.contentCode ? `${c.contentCode} — ` : ''}{c.title || SMM_SERVICE_TYPE_LABELS[c.serviceType]}</option>
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

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
        {contentItems.map(item => {
          const itemWorkCount = workItems.filter(w => w.contentItemId === item.id).length
          return (
            <div key={item.id} onClick={() => openContentItem(item.id)} className="px-5 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-zinc-100 text-sm">
                    {item.title || (item.serviceType === 'OTHER' ? (item.customServiceType || 'Другое') : SMM_SERVICE_TYPE_LABELS[item.serviceType])}
                    {item.contentCode && <span className="text-zinc-500 text-xs ml-2">{item.contentCode}</span>}
                    {item.parentContentTitle && <span className="text-zinc-600 text-xs ml-2">← {item.parentContentCode || item.parentContentTitle}</span>}
                  </p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    {SMM_CONTENT_STATUS_LABELS[item.status]} · {item.responsibleUserName ?? item.editorName ?? 'Не назначен'}
                    {item.plannedPublishDate && ` · Готовность ${formatDate(item.plannedPublishDate)}`}
                    {item.editingProjectStatusLabel && ` · Монтаж: ${item.editingProjectStatusLabel}`}
                    {item.scheduleEvents.length > 0 && ` · Съёмок: ${item.scheduleEvents.length}`}
                    {item.publications.length > 0 && ` · Публикаций: ${item.publications.length}`}
                    {itemWorkCount > 0 && ` · Работ: ${itemWorkCount}`}
                    {item.childContent.length > 0 && ` · Дочерних: ${item.childContent.length}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  {!item.editingProjectId && <Film className="w-3.5 h-3.5 text-zinc-600" aria-label="В монтаж пока не передано" />}
                  <button type="button" onClick={() => handleDelete(item.id)} className="text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          )
        })}
        {contentItems.length === 0 && <p className="text-zinc-500 text-sm px-5 py-6">Контента пока нет</p>}
      </div>

      {openDetail && (
        <SmmContentItemCard
          detail={openDetail}
          editors={editors}
          staff={staff}
          onOpenChange={open => { if (!open) setOpenDetail(null) }}
          onChanged={handleCardChanged}
          onOpenContentItem={openContentItem}
        />
      )}
    </div>
  )
}
