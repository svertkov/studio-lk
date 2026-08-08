'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Film, Camera, Share2, X, BarChart3 } from 'lucide-react'
import {
  createSmmContentItem, updateSmmContentItem, deleteSmmContentItem, linkSmmContentToMontage, createSmmWorkItem, updateSmmWorkItemStatus,
  addSmmPublication, deleteSmmPublication, addSmmPublicationMetric, deleteSmmPublicationMetric,
  getClientScheduleEventsForContentLink, addSmmContentScheduleLink, removeSmmContentScheduleLink,
  type SmmContentItemDTO, type SmmContentItemInput, type SmmWorkItemDTO, type SmmPublicationInput, type SmmPublicationMetricInput,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import {
  CONTENT_SERVICE_TYPES, SMM_SERVICE_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS, SMM_WORK_TYPE_LABELS,
  SMM_PUBLICATION_PLATFORM_LABELS, SMM_PUBLICATION_STATUS_LABELS, SMM_METRIC_TYPE_LABELS, SMM_METRIC_SOURCE_LABELS,
  formatSmmMoney, getLatestMetricByType,
} from '@/lib/smm-model'
import type { SmmContentStatus, SmmWorkType, SmmPublicationPlatform, SmmPublicationStatus, SmmMetricType, SmmMetricSource, SmmServiceType } from '@prisma/client'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

const EMPTY_FORM: SmmContentItemInput = {
  serviceType: 'SHORT_VIDEO', title: '', description: '', productionBrief: '', plannedPublishDate: '', deadline: '',
  status: 'IDEA', responsibleUserId: '', editorId: '', parentContentId: '', contentCode: '', notes: '',
}

const EMPTY_PUB_FORM = { platform: 'INSTAGRAM' as SmmPublicationPlatform, customPlatform: '', status: 'PLANNED' as SmmPublicationStatus, plannedPublishAt: '', publishedAt: '', url: '' }
const EMPTY_METRIC_FORM = { metricType: 'VIEWS' as SmmMetricType, value: '', capturedAt: new Date().toISOString().slice(0, 10), source: 'MANUAL' as SmmMetricSource }

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'
}

interface Props {
  smmProjectId: string
  clientId: string
  contentItems: SmmContentItemDTO[]
  setContentItems: (updater: (prev: SmmContentItemDTO[]) => SmmContentItemDTO[]) => void
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
  workItems: SmmWorkItemDTO[]
  setWorkItems: (updater: (prev: SmmWorkItemDTO[]) => SmmWorkItemDTO[]) => void
}

export default function SmmProjectContentTab({ smmProjectId, clientId, contentItems, setContentItems, editors, staff, workItems, setWorkItems }: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<SmmContentItemInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workFormFor, setWorkFormFor] = useState<string | null>(null)
  const [workForm, setWorkForm] = useState({ performerId: '', workType: 'EDITING' as SmmWorkType, amount: '', workDate: new Date().toISOString().slice(0, 10), description: '' })
  const [pubFormFor, setPubFormFor] = useState<string | null>(null)
  const [pubForm, setPubForm] = useState(EMPTY_PUB_FORM)
  const [schedPanelFor, setSchedPanelFor] = useState<string | null>(null)
  const [schedOptions, setSchedOptions] = useState<{ id: string; title: string | null; startAt: string | null }[]>([])
  const [schedSelected, setSchedSelected] = useState('')
  const [metricFormFor, setMetricFormFor] = useState<string | null>(null)
  const [metricForm, setMetricForm] = useState(EMPTY_METRIC_FORM)

  function replaceItem(id: string, next: SmmContentItemDTO) {
    setContentItems(prev => prev.map(c => (c.id === id ? next : c)))
  }

  function startEdit(item: SmmContentItemDTO) {
    setEditingId(item.id)
    setForm({
      serviceType: item.serviceType, customServiceType: item.customServiceType ?? '', title: item.title ?? '',
      description: item.description ?? '', productionBrief: item.productionBrief ?? '',
      plannedPublishDate: item.plannedPublishDate?.slice(0, 10) ?? '', deadline: item.deadline?.slice(0, 10) ?? '',
      status: item.status, responsibleUserId: item.responsibleUserId ?? '', editorId: item.editorId ?? '',
      parentContentId: item.parentContentId ?? '', contentCode: item.contentCode ?? '', notes: item.notes ?? '',
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
      replaceItem(editingId, result.data)
    }
    setEditingId(null)
  }

  async function handleDelete(id: string) {
    const result = await deleteSmmContentItem(id)
    if (result.ok) setContentItems(prev => prev.filter(c => c.id !== id))
  }

  async function handleLinkMontage(id: string) {
    const result = await linkSmmContentToMontage(id)
    if (result.ok) replaceItem(id, result.data)
    else setError(result.error)
  }

  async function handleApproveWork(id: string) {
    const result = await updateSmmWorkItemStatus(id, 'APPROVED')
    if (result.ok) setWorkItems(prev => prev.map(w => (w.id === id ? result.data : w)))
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

  async function handleAddPublication(item: SmmContentItemDTO) {
    const input: SmmPublicationInput = {
      platform: pubForm.platform,
      customPlatform: pubForm.customPlatform || undefined,
      status: pubForm.status,
      plannedPublishAt: pubForm.plannedPublishAt || undefined,
      publishedAt: pubForm.publishedAt || undefined,
      url: pubForm.url || undefined,
    }
    const result = await addSmmPublication(item.id, input)
    if (result.ok) {
      replaceItem(item.id, { ...item, publications: [...item.publications, result.data] })
      setPubFormFor(null)
      setPubForm(EMPTY_PUB_FORM)
    }
  }

  async function handleDeletePublication(item: SmmContentItemDTO, publicationId: string) {
    const result = await deleteSmmPublication(publicationId)
    if (result.ok) replaceItem(item.id, { ...item, publications: item.publications.filter(p => p.id !== publicationId) })
  }

  async function handleAddMetric(item: SmmContentItemDTO, publicationId: string) {
    if (!metricForm.value) return
    const input: SmmPublicationMetricInput = {
      metricType: metricForm.metricType, value: parseFloat(metricForm.value), capturedAt: metricForm.capturedAt, source: metricForm.source,
    }
    const result = await addSmmPublicationMetric(publicationId, input)
    if (result.ok) {
      replaceItem(item.id, {
        ...item,
        publications: item.publications.map(p => (p.id === publicationId ? { ...p, metrics: [result.data, ...p.metrics] } : p)),
      })
      setMetricFormFor(null)
      setMetricForm(EMPTY_METRIC_FORM)
    }
  }

  async function handleDeleteMetric(item: SmmContentItemDTO, publicationId: string, metricId: string) {
    const result = await deleteSmmPublicationMetric(metricId)
    if (result.ok) {
      replaceItem(item.id, {
        ...item,
        publications: item.publications.map(p => (p.id === publicationId ? { ...p, metrics: p.metrics.filter(m => m.id !== metricId) } : p)),
      })
    }
  }

  async function openSchedPanel(item: SmmContentItemDTO) {
    if (schedPanelFor === item.id) { setSchedPanelFor(null); return }
    setSchedPanelFor(item.id)
    setSchedSelected('')
    const result = await getClientScheduleEventsForContentLink(clientId, item.id)
    setSchedOptions(result.ok ? result.data : [])
  }

  async function handleLinkSchedule(item: SmmContentItemDTO) {
    if (!schedSelected) return
    const result = await addSmmContentScheduleLink(item.id, schedSelected)
    if (result.ok) {
      replaceItem(item.id, { ...item, scheduleEvents: [...item.scheduleEvents, { linkId: result.data.linkId, scheduleEventId: result.data.scheduleEventId, title: result.data.title, startAt: result.data.startAt }] })
      setSchedOptions(prev => prev.filter(e => e.id !== schedSelected))
      setSchedSelected('')
    }
  }

  async function handleUnlinkSchedule(item: SmmContentItemDTO, linkId: string) {
    const result = await removeSmmContentScheduleLink(linkId)
    if (result.ok) replaceItem(item.id, { ...item, scheduleEvents: item.scheduleEvents.filter(e => e.linkId !== linkId) })
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
                {contentItems.filter(c => c.id !== editingId).map(c => (
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
                  {item.contentCode && <span className="text-zinc-500 text-xs ml-2">{item.contentCode}</span>}
                  {item.parentContentTitle && <span className="text-zinc-600 text-xs ml-2">← {item.parentContentCode || item.parentContentTitle}</span>}
                </p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {SMM_CONTENT_STATUS_LABELS[item.status]} · {item.responsibleUserName ?? item.editorName ?? 'Не назначен'}
                  {item.plannedPublishDate && ` · Готовность ${formatDate(item.plannedPublishDate)}`}
                  {item.editingProjectStatusLabel && ` · Монтаж: ${item.editingProjectStatusLabel}`}
                  {item.childContent.length > 0 && ` · Дочерних: ${item.childContent.length}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!item.editingProjectId && (
                  <button type="button" onClick={() => handleLinkMontage(item.id)} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200 text-xs transition-colors" title="Передать монтажёру">
                    <Film className="w-3.5 h-3.5" /> В монтаж
                  </button>
                )}
                <button type="button" onClick={() => openSchedPanel(item)} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200 text-xs transition-colors" title="Съёмки">
                  <Camera className="w-3.5 h-3.5" /> Съёмки{item.scheduleEvents.length > 0 && ` (${item.scheduleEvents.length})`}
                </button>
                <button type="button" onClick={() => { setPubFormFor(pubFormFor === item.id ? null : item.id); setPubForm(EMPTY_PUB_FORM) }} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200 text-xs transition-colors" title="Публикации">
                  <Share2 className="w-3.5 h-3.5" /> Публикации{item.publications.length > 0 && ` (${item.publications.length})`}
                </button>
                <button type="button" onClick={() => setWorkFormFor(workFormFor === item.id ? null : item.id)} className="text-zinc-500 hover:text-zinc-200 text-xs transition-colors">+ работа</button>
                <button type="button" onClick={() => startEdit(item)} className="text-zinc-500 hover:text-zinc-300 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => handleDelete(item.id)} className="text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {schedPanelFor === item.id && (
              <div className="mt-3 bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 space-y-2">
                {item.scheduleEvents.length > 0 && (
                  <div className="space-y-1">
                    {item.scheduleEvents.map(e => (
                      <div key={e.linkId} className="flex items-center justify-between text-xs text-zinc-300">
                        <span>{e.title ?? 'Без названия'} · {formatDate(e.startAt)}</span>
                        <button type="button" onClick={() => handleUnlinkSchedule(item, e.linkId)} className="text-zinc-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <select className={`${SELECT} flex-1`} value={schedSelected} onChange={e => setSchedSelected(e.target.value)}>
                    <option value="">Выберите съёмку клиента...</option>
                    {schedOptions.map(e => <option key={e.id} value={e.id}>{e.title ?? 'Без названия'} · {formatDate(e.startAt)}</option>)}
                  </select>
                  <button type="button" onClick={() => handleLinkSchedule(item)} disabled={!schedSelected} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Привязать</button>
                </div>
              </div>
            )}

            {pubFormFor === item.id && (
              <div className="mt-3 bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 flex items-end gap-2 flex-wrap">
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Площадка</label>
                  <select className={SELECT} value={pubForm.platform} onChange={e => setPubForm(f => ({ ...f, platform: e.target.value as SmmPublicationPlatform }))}>
                    {(Object.keys(SMM_PUBLICATION_PLATFORM_LABELS) as SmmPublicationPlatform[]).map(p => <option key={p} value={p}>{SMM_PUBLICATION_PLATFORM_LABELS[p]}</option>)}
                  </select>
                </div>
                {pubForm.platform === 'OTHER' && (
                  <div>
                    <label className="block text-zinc-500 text-[11px] mb-1">Название площадки</label>
                    <input className={INPUT} value={pubForm.customPlatform} onChange={e => setPubForm(f => ({ ...f, customPlatform: e.target.value }))} />
                  </div>
                )}
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Статус</label>
                  <select className={SELECT} value={pubForm.status} onChange={e => setPubForm(f => ({ ...f, status: e.target.value as SmmPublicationStatus }))}>
                    {(Object.keys(SMM_PUBLICATION_STATUS_LABELS) as SmmPublicationStatus[]).map(s => <option key={s} value={s}>{SMM_PUBLICATION_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">План публикации</label>
                  <input className={INPUT} type="date" value={pubForm.plannedPublishAt} onChange={e => setPubForm(f => ({ ...f, plannedPublishAt: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Факт публикации</label>
                  <input className={INPUT} type="date" value={pubForm.publishedAt} onChange={e => setPubForm(f => ({ ...f, publishedAt: e.target.value }))} />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-zinc-500 text-[11px] mb-1">Ссылка</label>
                  <input className={INPUT} value={pubForm.url} onChange={e => setPubForm(f => ({ ...f, url: e.target.value }))} />
                </div>
                <button type="button" onClick={() => handleAddPublication(item)} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Добавить</button>
              </div>
            )}

            {item.publications.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {item.publications.map(pub => {
                  const latest = getLatestMetricByType(pub.metrics)
                  return (
                    <div key={pub.id} className="bg-zinc-800/30 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-zinc-300 text-xs">
                          <span className="text-zinc-100">{SMM_PUBLICATION_PLATFORM_LABELS[pub.platform]}{pub.platform === 'OTHER' && pub.customPlatform ? ` (${pub.customPlatform})` : ''}</span>
                          {' · '}{SMM_PUBLICATION_STATUS_LABELS[pub.status]}
                          {pub.plannedPublishAt && ` · план ${formatDate(pub.plannedPublishAt)}`}
                          {pub.publishedAt && ` · факт ${formatDate(pub.publishedAt)}`}
                          {pub.url && <> · <a href={pub.url} target="_blank" rel="noopener noreferrer" className="text-[#00c26b] hover:underline">ссылка</a></>}
                        </p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button type="button" onClick={() => { setMetricFormFor(metricFormFor === pub.id ? null : pub.id); setMetricForm(EMPTY_METRIC_FORM) }} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200 text-[11px]">
                            <BarChart3 className="w-3 h-3" /> Метрики
                          </button>
                          <button type="button" onClick={() => handleDeletePublication(item, pub.id)} className="text-zinc-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                      {Object.keys(latest).length > 0 && (
                        <p className="text-zinc-500 text-[11px] mt-1">
                          {(Object.keys(latest) as SmmMetricType[]).map(t => `${SMM_METRIC_TYPE_LABELS[t]}: ${latest[t]!.value}`).join(' · ')}
                        </p>
                      )}
                      {metricFormFor === pub.id && (
                        <div className="mt-2 flex items-end gap-2 flex-wrap">
                          <select className={SELECT} value={metricForm.metricType} onChange={e => setMetricForm(f => ({ ...f, metricType: e.target.value as SmmMetricType }))}>
                            {(Object.keys(SMM_METRIC_TYPE_LABELS) as SmmMetricType[]).map(t => <option key={t} value={t}>{SMM_METRIC_TYPE_LABELS[t]}</option>)}
                          </select>
                          <input className={`${INPUT} w-24`} type="number" placeholder="Значение" value={metricForm.value} onChange={e => setMetricForm(f => ({ ...f, value: e.target.value }))} />
                          <input className={INPUT} type="date" value={metricForm.capturedAt} onChange={e => setMetricForm(f => ({ ...f, capturedAt: e.target.value }))} />
                          <select className={SELECT} value={metricForm.source} onChange={e => setMetricForm(f => ({ ...f, source: e.target.value as SmmMetricSource }))}>
                            {(Object.keys(SMM_METRIC_SOURCE_LABELS) as SmmMetricSource[]).map(s => <option key={s} value={s}>{SMM_METRIC_SOURCE_LABELS[s]}</option>)}
                          </select>
                          <button type="button" onClick={() => handleAddMetric(item, pub.id)} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Добавить</button>
                        </div>
                      )}
                      {pub.metrics.length > 0 && metricFormFor === pub.id && (
                        <div className="mt-2 space-y-0.5">
                          {pub.metrics.map(m => (
                            <p key={m.id} className="text-zinc-500 text-[11px] flex items-center gap-2">
                              <span>{SMM_METRIC_TYPE_LABELS[m.metricType]}: {m.value} · {formatDate(m.capturedAt)} · {SMM_METRIC_SOURCE_LABELS[m.source]}</span>
                              <button type="button" onClick={() => handleDeleteMetric(item, pub.id, m.id)} className="text-zinc-600 hover:text-red-400"><X className="w-3 h-3" /></button>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

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
