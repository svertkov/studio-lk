'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Film } from 'lucide-react'
import {
  createSmmContentItem, updateSmmContentItem, deleteSmmContentItem, linkSmmContentToMontage, createSmmWorkItem, updateSmmWorkItemStatus,
  type SmmContentItemDTO, type SmmContentItemInput, type SmmWorkItemDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { SMM_SERVICE_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS, SMM_WORK_TYPE_LABELS, formatSmmMoney } from '@/lib/smm-model'
import type { SmmServiceType, SmmContentStatus, SmmWorkType } from '@prisma/client'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

const EMPTY_FORM: SmmContentItemInput = { serviceType: 'SHORT_VIDEO', title: '', description: '', plannedPublishDate: '', deadline: '', status: 'IDEA', responsibleUserId: '', editorId: '', sourceUrl: '', resultUrl: '', publishedUrl: '', indexCode: '', notes: '' }

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'
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

export default function SmmProjectContentTab({ smmProjectId, contentItems, setContentItems, editors, staff, workItems, setWorkItems }: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<SmmContentItemInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workFormFor, setWorkFormFor] = useState<string | null>(null)
  const [workForm, setWorkForm] = useState({ performerId: '', workType: 'EDITING' as SmmWorkType, amount: '', workDate: new Date().toISOString().slice(0, 10), description: '' })

  function startEdit(item: SmmContentItemDTO) {
    setEditingId(item.id)
    setForm({
      serviceType: item.serviceType, customServiceType: item.customServiceType ?? '', title: item.title ?? '',
      description: item.description ?? '', plannedPublishDate: item.plannedPublishDate?.slice(0, 10) ?? '',
      deadline: item.deadline?.slice(0, 10) ?? '', status: item.status, responsibleUserId: item.responsibleUserId ?? '',
      editorId: item.editorId ?? '', sourceUrl: item.sourceUrl ?? '', resultUrl: item.resultUrl ?? '',
      publishedUrl: item.publishedUrl ?? '', indexCode: item.indexCode ?? '', notes: item.notes ?? '',
    })
  }

  function startNew() {
    setEditingId('new')
    setForm(EMPTY_FORM)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    if (editingId === 'new') {
      const result = await createSmmContentItem(smmProjectId, form)
      setSaving(false)
      if (!result.ok) { setError(result.error); return }
      setContentItems(prev => [result.data, ...prev])
    } else if (editingId) {
      const result = await updateSmmContentItem(editingId, form)
      setSaving(false)
      if (!result.ok) { setError(result.error); return }
      setContentItems(prev => prev.map(c => c.id === editingId ? result.data : c))
    }
    setEditingId(null)
  }

  async function handleDelete(id: string) {
    const result = await deleteSmmContentItem(id)
    if (result.ok) setContentItems(prev => prev.filter(c => c.id !== id))
  }

  async function handleLinkMontage(id: string) {
    const result = await linkSmmContentToMontage(id)
    if (result.ok) setContentItems(prev => prev.map(c => c.id === id ? result.data : c))
    else setError(result.error)
  }

  async function handleApproveWork(id: string) {
    const result = await updateSmmWorkItemStatus(id, 'APPROVED')
    if (result.ok) setWorkItems(prev => prev.map(w => w.id === id ? result.data : w))
  }

  async function handleAddWork(contentItemId: string) {
    if (!workForm.performerId || !workForm.amount) return
    const result = await createSmmWorkItem(smmProjectId, {
      performerId: workForm.performerId, contentItemId, workType: workForm.workType,
      amount: parseFloat(workForm.amount), workDate: workForm.workDate, description: workForm.description || undefined,
      status: 'SUBMITTED',
    })
    if (result.ok) {
      setWorkItems(prev => [result.data, ...prev])
      setWorkFormFor(null)
      setWorkForm({ performerId: '', workType: 'EDITING', amount: '', workDate: new Date().toISOString().slice(0, 10), description: '' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Контент</h3>
        <button type="button" onClick={startNew} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Добавить единицу контента
        </button>
      </div>

      {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      {editingId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Тип</label>
              <select className={SELECT} value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value as SmmServiceType }))}>
                {(Object.keys(SMM_SERVICE_TYPE_LABELS) as SmmServiceType[]).map(t => <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Название</label>
              <input className={INPUT} value={form.title ?? ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Описание / ТЗ</label>
            <textarea className={INPUT} rows={2} value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Статус</label>
              <select className={SELECT} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as SmmContentStatus }))}>
                {(Object.keys(SMM_CONTENT_STATUS_LABELS) as SmmContentStatus[]).map(s => <option key={s} value={s}>{SMM_CONTENT_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Дата публикации</label>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Ссылка на исходники</label>
              <input className={INPUT} value={form.sourceUrl ?? ''} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Рабочий индекс</label>
              <input className={INPUT} placeholder="напр. DIA-2026.08.08-AH-017" value={form.indexCode ?? ''} onChange={e => setForm(f => ({ ...f, indexCode: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Ссылка на результат</label>
              <input className={INPUT} value={form.resultUrl ?? ''} onChange={e => setForm(f => ({ ...f, resultUrl: e.target.value }))} />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Ссылка на публикацию</label>
              <input className={INPUT} value={form.publishedUrl ?? ''} onChange={e => setForm(f => ({ ...f, publishedUrl: e.target.value }))} />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={handleSave} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors">Отмена</button>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
        {contentItems.map(item => (
          <div key={item.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-zinc-100 text-sm">
                  {item.title || (item.serviceType === 'OTHER' ? (item.customServiceType || 'Другое') : SMM_SERVICE_TYPE_LABELS[item.serviceType])}
                  {item.indexCode && <span className="text-zinc-500 text-xs ml-2">{item.indexCode}</span>}
                </p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {SMM_CONTENT_STATUS_LABELS[item.status]} · {item.responsibleUserName ?? item.editorName ?? 'Не назначен'}
                  {item.plannedPublishDate && ` · Публикация ${formatDate(item.plannedPublishDate)}`}
                  {item.editingProjectStatusLabel && ` · Монтаж: ${item.editingProjectStatusLabel}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!item.editingProjectId && (
                  <button type="button" onClick={() => handleLinkMontage(item.id)} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200 text-xs transition-colors" title="Передать монтажёру">
                    <Film className="w-3.5 h-3.5" /> В монтаж
                  </button>
                )}
                <button type="button" onClick={() => setWorkFormFor(workFormFor === item.id ? null : item.id)} className="text-zinc-500 hover:text-zinc-200 text-xs transition-colors">+ работа</button>
                <button type="button" onClick={() => startEdit(item)} className="text-zinc-500 hover:text-zinc-300 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => handleDelete(item.id)} className="text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {workFormFor === item.id && (
              <div className="mt-3 bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 flex items-end gap-2 flex-wrap">
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Исполнитель</label>
                  <select className={SELECT} value={workForm.performerId} onChange={e => setWorkForm(f => ({ ...f, performerId: e.target.value }))}>
                    <option value="">Выберите...</option>
                    {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Тип работы</label>
                  <select className={SELECT} value={workForm.workType} onChange={e => setWorkForm(f => ({ ...f, workType: e.target.value as SmmWorkType }))}>
                    {(Object.keys(SMM_WORK_TYPE_LABELS) as SmmWorkType[]).map(t => <option key={t} value={t}>{SMM_WORK_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div className="w-28">
                  <label className="block text-zinc-500 text-[11px] mb-1">Сумма, ₽</label>
                  <input className={INPUT} type="number" value={workForm.amount} onChange={e => setWorkForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Дата</label>
                  <input className={INPUT} type="date" value={workForm.workDate} onChange={e => setWorkForm(f => ({ ...f, workDate: e.target.value }))} />
                </div>
                <button type="button" onClick={() => handleAddWork(item.id)} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Добавить</button>
              </div>
            )}

            {workItems.filter(w => w.contentItemId === item.id).length > 0 && (
              <div className="mt-2 space-y-1">
                {workItems.filter(w => w.contentItemId === item.id).map(w => (
                  <p key={w.id} className="text-zinc-500 text-xs flex items-center gap-2">
                    <span>{w.performerName} — {SMM_WORK_TYPE_LABELS[w.workType]} — {formatSmmMoney(w.amount)} · {w.status === 'APPROVED' ? 'подтверждено' : w.status === 'SUBMITTED' ? 'отправлено' : w.status === 'REJECTED' ? 'отклонено' : 'черновик'}</span>
                    {w.status !== 'APPROVED' && (
                      <button type="button" onClick={() => handleApproveWork(w.id)} className="text-[#00c26b] hover:underline">Подтвердить</button>
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
        {contentItems.length === 0 && <p className="text-zinc-500 text-sm px-5 py-6">Контента пока нет</p>}
      </div>
    </div>
  )
}
