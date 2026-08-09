'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  X, Film, Camera, Share2, BarChart3, Trash2, Plus, ExternalLink, AlertTriangle, GitBranch,
} from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  updateSmmContentItem, deleteSmmContentItem, linkSmmContentToMontage, createSmmContentItem,
  addSmmPublication, deleteSmmPublication, updateSmmPublication, addSmmPublicationMetric, deleteSmmPublicationMetric,
  getClientScheduleEventsForContentLink, addSmmContentScheduleLink, removeSmmContentScheduleLink,
  addSmmMaterialLink, deleteSmmMaterialLink,
  createSmmWorkItem, updateSmmWorkItemStatus, getSmmContentItemDetail,
  type SmmContentItemDetailDTO, type SmmContentItemDTO, type SmmContentItemInput, type SmmPublicationInput, type SmmPublicationMetricInput,
  type SmmMaterialLinkInput, type SmmWorkItemInput,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import {
  CONTENT_SERVICE_TYPES, SMM_SERVICE_TYPE_LABELS, SMM_CONTENT_STATUS_LABELS, SMM_WORK_TYPE_LABELS, SMM_WORK_PAYMENT_STATUS_LABELS,
  SMM_PUBLICATION_PLATFORM_LABELS, SMM_PUBLICATION_STATUS_LABELS, SMM_METRIC_TYPE_LABELS, SMM_METRIC_SOURCE_LABELS,
  SMM_MATERIAL_TYPE_LABELS, SMM_MATERIAL_CATEGORY_LABELS, SMM_CONTENT_ATTENTION_LABELS,
  formatSmmMoney, getLatestMetricByType,
} from '@/lib/smm-model'
import { MONTAGE_STATUS_LABELS } from '@/lib/montage-model'
import { EVENT_TYPE_LABELS } from '@/lib/event-type'
import type {
  SmmServiceType, SmmContentStatus, SmmWorkType, SmmPublicationPlatform, SmmPublicationStatus, SmmMetricType, SmmMetricSource,
  SmmMaterialCategory, SmmMaterialType,
} from '@prisma/client'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const SECTION = 'bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3'
const SECTION_TITLE = 'text-white font-semibold text-sm flex items-center gap-2'

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
function formatDateTime(v: string | null): string {
  return v ? new Date(v).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

interface Props {
  detail: SmmContentItemDetailDTO
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
  onOpenChange: (open: boolean) => void
  onChanged: (updated: SmmContentItemDetailDTO) => void
  // Родитель/дети/производный контент — открывает ДРУГУЮ единицу контента в
  // том же каноническом компоненте (SMM.md, «Единый canonical ContentItem
  // card»): владелец состояния "какой ContentItem сейчас открыт" — вызывающая
  // сторона (Production/вкладка проекта), не сама карточка.
  onOpenContentItem: (id: string) => void
}

export default function SmmContentItemCard({ detail, editors, staff, onOpenChange, onChanged, onOpenContentItem }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [savingHeader, setSavingHeader] = useState(false)

  // ---- Идея/ТЗ ----
  const [editingIdea, setEditingIdea] = useState(false)
  const [ideaForm, setIdeaForm] = useState({ title: detail.title ?? '', description: detail.description ?? '', productionBrief: detail.productionBrief ?? '', contentCode: detail.contentCode ?? '' })

  // ---- Съёмки ----
  const [schedPanelOpen, setSchedPanelOpen] = useState(false)
  const [schedOptions, setSchedOptions] = useState<{ id: string; title: string | null; startAt: string | null }[]>([])
  const [schedSelected, setSchedSelected] = useState('')

  // ---- Материалы ----
  const [materialFormOpen, setMaterialFormOpen] = useState(false)
  const [materialForm, setMaterialForm] = useState<SmmMaterialLinkInput>({ category: 'SOURCE', materialType: null, title: '', url: '', description: '', relatedContentId: detail.id })

  // ---- Монтаж ----
  const [montageFormOpen, setMontageFormOpen] = useState(false)
  const [montageForm, setMontageForm] = useState({ editorId: detail.editorId ?? '', deadlineDate: '', workAmount: '', workType: 'EDITING' as SmmWorkType })

  // ---- Публикации ----
  const [pubFormOpen, setPubFormOpen] = useState(false)
  const [pubForm, setPubForm] = useState({ platform: 'INSTAGRAM' as SmmPublicationPlatform, customPlatform: '', status: 'PLANNED' as SmmPublicationStatus, plannedPublishAt: '', publishedAt: '', url: '' })
  const [publishFormFor, setPublishFormFor] = useState<string | null>(null)
  const [publishForm, setPublishForm] = useState({ url: '', publishedAt: new Date().toISOString().slice(0, 10) })
  const [metricFormFor, setMetricFormFor] = useState<string | null>(null)
  const [metricForm, setMetricForm] = useState({ metricType: 'VIEWS' as SmmMetricType, value: '', capturedAt: new Date().toISOString().slice(0, 10), source: 'MANUAL' as SmmMetricSource })

  // ---- Работы ----
  const [workFormOpen, setWorkFormOpen] = useState(false)
  const [workForm, setWorkForm] = useState({ performerId: '', workType: 'EDITING' as SmmWorkType, amount: '', workDate: new Date().toISOString().slice(0, 10), description: '' })

  // ---- Производный контент ----
  const [derivedFormOpen, setDerivedFormOpen] = useState(false)
  const [derivedForm, setDerivedForm] = useState({ serviceType: 'SHORT_VIDEO' as SmmServiceType, title: '', contentCode: '' })

  async function refetchDetail() {
    const result = await getSmmContentItemDetail(detail.id)
    if (result.ok) onChanged(result.data)
  }

  // getSmmContentItems (список) и getSmmContentItemDetail (карточка) —
  // намеренно разные include (ТЗ 2B, п.4), поэтому SmmContentItemDTO.scheduleEvents
  // (лёгкая форма) и SmmContentItemDetailDTO.scheduleEvents (с eventType/
  // room/orderId) — разные типы для одного и того же поля. При мерже
  // результата update (базовый DTO) в уже загруженный detail — берём
  // остальные поля из ответа, но scheduleEvents оставляем от detail (тот
  // блок не редактируется этими действиями, значит его richer-форма не
  // теряет актуальность).
  function mergeBaseIntoDetail(base: SmmContentItemDTO): SmmContentItemDetailDTO {
    return { ...detail, ...base, scheduleEvents: detail.scheduleEvents }
  }

  async function handleHeaderFieldChange(input: SmmContentItemInput) {
    setSavingHeader(true)
    setError(null)
    const result = await updateSmmContentItem(detail.id, input)
    setSavingHeader(false)
    if (!result.ok) { setError(result.error); return }
    onChanged(mergeBaseIntoDetail(result.data))
  }

  async function handleSaveIdea() {
    const result = await updateSmmContentItem(detail.id, {
      title: ideaForm.title, description: ideaForm.description, productionBrief: ideaForm.productionBrief, contentCode: ideaForm.contentCode,
    })
    if (!result.ok) { setError(result.error); return }
    onChanged(mergeBaseIntoDetail(result.data))
    setEditingIdea(false)
  }

  async function handleDelete() {
    const result = await deleteSmmContentItem(detail.id)
    if (result.ok) onOpenChange(false)
    else setError(result.error)
  }

  // ---- Съёмки ----
  async function openSchedPanel() {
    if (schedPanelOpen) { setSchedPanelOpen(false); return }
    setSchedPanelOpen(true)
    setSchedSelected('')
    const result = await getClientScheduleEventsForContentLink(detail.smmProjectClientId, detail.id)
    setSchedOptions(result.ok ? result.data : [])
  }
  async function handleLinkSchedule() {
    if (!schedSelected) return
    const result = await addSmmContentScheduleLink(detail.id, schedSelected)
    if (result.ok) {
      setSchedOptions(prev => prev.filter(e => e.id !== schedSelected))
      setSchedSelected('')
      // Карточка съёмки в detail нужна с полными полями (eventType/room/
      // orderId, ТЗ 2B, п.16) — их нет в ответе addSmmContentScheduleLink,
      // поэтому просто перезапрашиваем полную карточку вместо неполного
      // optimistic-объекта.
      await refetchDetail()
    }
  }
  async function handleUnlinkSchedule(linkId: string) {
    const result = await removeSmmContentScheduleLink(linkId)
    if (result.ok) onChanged({ ...detail, scheduleEvents: detail.scheduleEvents.filter(e => e.linkId !== linkId) })
  }

  // ---- Материалы ----
  async function handleAddMaterial() {
    if (!materialForm.title.trim() || !materialForm.url.trim()) { setError('Укажите название и ссылку материала'); return }
    const result = await addSmmMaterialLink(detail.smmProjectId, materialForm)
    if (!result.ok) { setError(result.error); return }
    onChanged({ ...detail, materialLinks: [result.data, ...detail.materialLinks] })
    setMaterialFormOpen(false)
    setMaterialForm({ category: 'SOURCE', materialType: null, title: '', url: '', description: '', relatedContentId: detail.id })
  }
  async function handleDeleteMaterial(id: string) {
    const result = await deleteSmmMaterialLink(id)
    if (result.ok) onChanged({ ...detail, materialLinks: detail.materialLinks.filter(m => m.id !== id) })
  }

  // ---- Монтаж ----
  async function handleLinkMontage() {
    setError(null)
    const result = await linkSmmContentToMontage(detail.id, {
      editorId: montageForm.editorId || null,
      deadlineDate: montageForm.deadlineDate || null,
      workAmount: montageForm.workAmount ? parseFloat(montageForm.workAmount) : null,
      workType: montageForm.workType,
    })
    if (!result.ok) { setError(result.error); return }
    setMontageFormOpen(false)
    await refetchDetail()
  }

  // ---- Публикации ----
  async function handleAddPublication() {
    const input: SmmPublicationInput = {
      platform: pubForm.platform, customPlatform: pubForm.customPlatform || undefined, status: pubForm.status,
      plannedPublishAt: pubForm.plannedPublishAt || undefined, publishedAt: pubForm.publishedAt || undefined, url: pubForm.url || undefined,
    }
    const result = await addSmmPublication(detail.id, input)
    if (!result.ok) { setError(result.error); return }
    onChanged({ ...detail, publications: [...detail.publications, result.data] })
    setPubFormOpen(false)
    setPubForm({ platform: 'INSTAGRAM', customPlatform: '', status: 'PLANNED', plannedPublishAt: '', publishedAt: '', url: '' })
  }
  async function handleDeletePublication(id: string) {
    const result = await deleteSmmPublication(id)
    if (result.ok) onChanged({ ...detail, publications: detail.publications.filter(p => p.id !== id) })
  }
  function startQuickPublish(pubId: string, existingUrl: string | null) {
    setPublishFormFor(pubId)
    setPublishForm({ url: existingUrl ?? '', publishedAt: new Date().toISOString().slice(0, 10) })
  }
  // "Опубликовать" — одно действие объединяет url + publishedAt + status
  // (ТЗ 2B, п.22: "не требовать вручную отдельно менять три поля"), но
  // все три значения остаются полями формы, редактируемыми по отдельности.
  async function handleQuickPublish(pubId: string) {
    if (!publishForm.url.trim()) { setError('Укажите ссылку на публикацию'); return }
    const result = await updateSmmPublication(pubId, { status: 'PUBLISHED', url: publishForm.url, publishedAt: publishForm.publishedAt })
    if (!result.ok) { setError(result.error); return }
    onChanged({ ...detail, publications: detail.publications.map(p => (p.id === pubId ? result.data : p)) })
    setPublishFormFor(null)
  }
  async function handleAddMetric(pubId: string) {
    if (!metricForm.value) return
    const input: SmmPublicationMetricInput = { metricType: metricForm.metricType, value: parseFloat(metricForm.value), capturedAt: metricForm.capturedAt, source: metricForm.source }
    const result = await addSmmPublicationMetric(pubId, input)
    if (!result.ok) { setError(result.error); return }
    onChanged({ ...detail, publications: detail.publications.map(p => (p.id === pubId ? { ...p, metrics: [result.data, ...p.metrics] } : p)) })
    setMetricForm({ metricType: 'VIEWS', value: '', capturedAt: new Date().toISOString().slice(0, 10), source: 'MANUAL' })
  }
  async function handleDeleteMetric(pubId: string, metricId: string) {
    const result = await deleteSmmPublicationMetric(metricId)
    if (result.ok) onChanged({ ...detail, publications: detail.publications.map(p => (p.id === pubId ? { ...p, metrics: p.metrics.filter(m => m.id !== metricId) } : p)) })
  }

  // ---- Работы ----
  async function handleAddWork() {
    if (!workForm.performerId || !workForm.amount) { setError('Укажите исполнителя и сумму'); return }
    const input: SmmWorkItemInput = {
      performerId: workForm.performerId, contentItemId: detail.id, editingProjectId: detail.editingProjectId,
      workType: workForm.workType, amount: parseFloat(workForm.amount), workDate: workForm.workDate,
      description: workForm.description || undefined, status: 'SUBMITTED',
    }
    const result = await createSmmWorkItem(detail.smmProjectId, input)
    if (!result.ok) { setError(result.error); return }
    onChanged({ ...detail, workItems: [result.data, ...detail.workItems] })
    setWorkFormOpen(false)
    setWorkForm({ performerId: '', workType: 'EDITING', amount: '', workDate: new Date().toISOString().slice(0, 10), description: '' })
  }
  async function handleApproveWork(id: string) {
    const result = await updateSmmWorkItemStatus(id, 'APPROVED')
    if (result.ok) onChanged({ ...detail, workItems: detail.workItems.map(w => (w.id === id ? result.data : w)) })
  }

  // ---- Производный контент ----
  async function handleCreateDerived() {
    if (!derivedForm.title.trim()) { setError('Укажите название производного материала'); return }
    const result = await createSmmContentItem(detail.smmProjectId, {
      serviceType: derivedForm.serviceType, title: derivedForm.title, contentCode: derivedForm.contentCode || undefined, parentContentId: detail.id,
    })
    if (!result.ok) { setError(result.error); return }
    setDerivedFormOpen(false)
    setDerivedForm({ serviceType: 'SHORT_VIDEO', title: '', contentCode: '' })
    await refetchDetail()
    onOpenContentItem(result.data.id)
  }

  const editingProjectMetrics = (
    <p className="text-zinc-500 text-xs">
      {detail.editingProjectClientAmount != null && `Клиент: ${formatSmmMoney(detail.editingProjectClientAmount)} · `}
      {detail.editingProjectEditorAmount != null && `Монтажёр: ${formatSmmMoney(detail.editingProjectEditorAmount)}`}
    </p>
  )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-4xl w-[96vw] max-h-[90vh] flex flex-col p-0" showCloseButton={false}>
        {/* Шапка (ТЗ 2B, п.14) */}
        <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {detail.contentCode && <span className="text-zinc-500 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5">{detail.contentCode}</span>}
                <h2 className="text-white text-lg font-semibold truncate">{detail.title || SMM_SERVICE_TYPE_LABELS[detail.serviceType]}</h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-zinc-400">
                <Link href={`/admin/smm/${detail.smmProjectId}`} className="text-[#00c26b] hover:underline">{detail.smmProjectClientName ?? 'SMM-проект'}</Link>
                <span>·</span>
                <span>{detail.serviceType === 'OTHER' ? (detail.customServiceType || 'Другое') : SMM_SERVICE_TYPE_LABELS[detail.serviceType]}</span>
                {detail.plannedPublishDate && <><span>·</span><span>Готовность {formatDate(detail.plannedPublishDate)}</span></>}
                {detail.parentContentId && (
                  <>
                    <span>·</span>
                    <button type="button" onClick={() => onOpenContentItem(detail.parentContentId!)} className="flex items-center gap-1 text-[#00c26b] hover:underline">
                      <GitBranch className="w-3 h-3" /> {detail.parentContentCode || detail.parentContentTitle || 'родитель'}
                    </button>
                  </>
                )}
              </div>
              {detail.attentionReasons.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  {detail.attentionReasons.map(r => (
                    <span key={r} className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-full px-2 py-0.5">
                      <AlertTriangle className="w-3 h-3" /> {SMM_CONTENT_ATTENTION_LABELS[r]}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <select
                className={SELECT}
                value={detail.status}
                disabled={savingHeader}
                onChange={e => handleHeaderFieldChange({ status: e.target.value as SmmContentStatus })}
              >
                {(Object.keys(SMM_CONTENT_STATUS_LABELS) as SmmContentStatus[]).map(s => <option key={s} value={s}>{SMM_CONTENT_STATUS_LABELS[s]}</option>)}
              </select>
              <button type="button" onClick={() => onOpenChange(false)} className="text-zinc-500 hover:text-zinc-200 p-1"><X className="w-5 h-5" /></button>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

          {/* Идея / ТЗ (ТЗ 2B, п.15) */}
          <div className={SECTION}>
            <div className="flex items-center justify-between">
              <p className={SECTION_TITLE}>Идея и ТЗ</p>
              {!editingIdea && <button type="button" onClick={() => setEditingIdea(true)} className="text-xs text-zinc-400 hover:text-zinc-200">Редактировать</button>}
            </div>
            {editingIdea ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-zinc-500 text-[11px] mb-1">Content Code</label>
                    <input className={INPUT} value={ideaForm.contentCode} onChange={e => setIdeaForm(f => ({ ...f, contentCode: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-[11px] mb-1">Название</label>
                    <input className={INPUT} value={ideaForm.title} onChange={e => setIdeaForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">Описание / концепция</label>
                  <textarea className={INPUT} rows={2} value={ideaForm.description} onChange={e => setIdeaForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-zinc-500 text-[11px] mb-1">ТЗ на производство / монтаж</label>
                  <textarea className={INPUT} rows={3} value={ideaForm.productionBrief} onChange={e => setIdeaForm(f => ({ ...f, productionBrief: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleSaveIdea} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Сохранить</button>
                  <button type="button" onClick={() => setEditingIdea(false)} className="text-zinc-400 hover:text-zinc-200 text-xs px-3 py-2">Отмена</button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-zinc-300 text-sm">{detail.description || <span className="text-zinc-600">Описание не заполнено</span>}</p>
                <div>
                  <p className="text-zinc-500 text-[11px] uppercase tracking-wide mt-2">ТЗ на производство</p>
                  <p className="text-zinc-300 text-sm whitespace-pre-wrap">{detail.productionBrief || <span className="text-zinc-600">Не заполнено</span>}</p>
                </div>
              </div>
            )}
          </div>

          {/* Ответственный/Монтажёр-назначение (компактно) */}
          <div className="grid grid-cols-2 gap-3">
            <div className={SECTION}>
              <p className="text-zinc-500 text-xs mb-1.5">Ответственный</p>
              <select className={`${SELECT} w-full`} value={detail.responsibleUserId ?? ''} onChange={e => handleHeaderFieldChange({ responsibleUserId: e.target.value || null })}>
                <option value="">Не назначен</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
              </select>
            </div>
            <div className={SECTION}>
              <p className="text-zinc-500 text-xs mb-1.5">Монтажёр (предварительно)</p>
              <select className={`${SELECT} w-full`} value={detail.editorId ?? ''} onChange={e => handleHeaderFieldChange({ editorId: e.target.value || null })}>
                <option value="">Не назначен</option>
                {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
              </select>
            </div>
          </div>

          {/* Съёмки (ТЗ 2B, п.16) */}
          <div className={SECTION}>
            <div className="flex items-center justify-between">
              <p className={SECTION_TITLE}><Camera className="w-4 h-4 text-zinc-400" /> Съёмки</p>
              <button type="button" onClick={openSchedPanel} className="text-xs text-zinc-400 hover:text-zinc-200">{schedPanelOpen ? 'Скрыть' : 'Привязать'}</button>
            </div>
            {detail.scheduleEvents.length > 0 && (
              <div className="space-y-1.5">
                {detail.scheduleEvents.map(e => (
                  <div key={e.linkId} className="flex items-center justify-between gap-2 bg-zinc-800/40 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-zinc-200 text-sm truncate">{e.title ?? 'Без названия'}</p>
                      <p className="text-zinc-500 text-xs">{formatDateTime(e.startAt)} · {EVENT_TYPE_LABELS[e.eventType]}{e.room && ` · ${e.room}`}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {e.orderId && <Link href={`/admin/crm?openOrderId=${e.orderId}`} className="text-xs text-[#00c26b] hover:underline">Открыть заказ</Link>}
                      <button type="button" onClick={() => handleUnlinkSchedule(e.linkId)} className="text-zinc-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {detail.scheduleEvents.length === 0 && !schedPanelOpen && <p className="text-zinc-600 text-sm">Съёмки не привязаны</p>}
            {schedPanelOpen && (
              <div className="flex items-end gap-2">
                <select className={`${SELECT} flex-1`} value={schedSelected} onChange={e => setSchedSelected(e.target.value)}>
                  <option value="">Выберите съёмку клиента...</option>
                  {schedOptions.map(e => <option key={e.id} value={e.id}>{e.title ?? 'Без названия'} · {formatDate(e.startAt)}</option>)}
                </select>
                <button type="button" onClick={handleLinkSchedule} disabled={!schedSelected} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Привязать</button>
              </div>
            )}
          </div>

          {/* Материалы (ТЗ 2B, п.17) */}
          <div className={SECTION}>
            <div className="flex items-center justify-between">
              <p className={SECTION_TITLE}>Материалы</p>
              <button type="button" onClick={() => setMaterialFormOpen(v => !v)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"><Plus className="w-3.5 h-3.5" /> Добавить</button>
            </div>
            {materialFormOpen && (
              <div className="bg-zinc-800/40 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select className={`${SELECT} w-full`} value={materialForm.category} onChange={e => setMaterialForm(f => ({ ...f, category: e.target.value as SmmMaterialCategory }))}>
                    {(Object.keys(SMM_MATERIAL_CATEGORY_LABELS) as SmmMaterialCategory[]).map(c => <option key={c} value={c}>{SMM_MATERIAL_CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <select className={`${SELECT} w-full`} value={materialForm.materialType ?? ''} onChange={e => setMaterialForm(f => ({ ...f, materialType: (e.target.value || null) as SmmMaterialType | null }))}>
                    <option value="">Тип: не указан</option>
                    {(Object.keys(SMM_MATERIAL_TYPE_LABELS) as SmmMaterialType[]).map(t => <option key={t} value={t}>{SMM_MATERIAL_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <input className={INPUT} placeholder="Название" value={materialForm.title} onChange={e => setMaterialForm(f => ({ ...f, title: e.target.value }))} />
                <input className={INPUT} placeholder="https://disk.yandex.ru/..." value={materialForm.url} onChange={e => setMaterialForm(f => ({ ...f, url: e.target.value }))} />
                <button type="button" onClick={handleAddMaterial} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Добавить</button>
              </div>
            )}
            {detail.materialLinks.length > 0 ? (
              <div className="space-y-1">
                {detail.materialLinks.map(m => (
                  <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-zinc-300 truncate">
                      {m.title} <span className="text-zinc-600">({m.materialType ? SMM_MATERIAL_TYPE_LABELS[m.materialType] : SMM_MATERIAL_CATEGORY_LABELS[m.category]})</span>
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-200"><ExternalLink className="w-3.5 h-3.5" /></a>
                      <button type="button" onClick={() => handleDeleteMaterial(m.id)} className="text-zinc-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-zinc-600 text-sm">Материалов нет</p>}
          </div>

          {/* Монтаж (ТЗ 2B, п.18/19) */}
          <div className={SECTION}>
            <p className={SECTION_TITLE}><Film className="w-4 h-4 text-zinc-400" /> Монтаж</p>
            {detail.editingProjectId ? (
              <div className="space-y-1">
                <p className="text-zinc-300 text-sm">{MONTAGE_STATUS_LABELS[detail.editingProjectStatus!]} · {detail.editingProjectEditorName ?? 'Монтажёр не назначен'}</p>
                {detail.editingProjectDeadlineDate && <p className="text-zinc-500 text-xs">Дедлайн: {formatDate(detail.editingProjectDeadlineDate)}</p>}
                {editingProjectMetrics}
                {detail.editingProjectDeliveryUrl && (
                  <a href={detail.editingProjectDeliveryUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#00c26b] hover:underline inline-flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> Готовый файл
                  </a>
                )}
                <div><Link href="/admin/editing" className="text-xs text-zinc-400 hover:text-zinc-200 underline">Перейти в раздел «Монтаж»</Link></div>
              </div>
            ) : montageFormOpen ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select className={`${SELECT} w-full`} value={montageForm.editorId} onChange={e => setMontageForm(f => ({ ...f, editorId: e.target.value }))}>
                    <option value="">Монтажёр не назначен</option>
                    {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
                  </select>
                  <input className={INPUT} type="date" value={montageForm.deadlineDate} onChange={e => setMontageForm(f => ({ ...f, deadlineDate: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select className={`${SELECT} w-full`} value={montageForm.workType} onChange={e => setMontageForm(f => ({ ...f, workType: e.target.value as SmmWorkType }))}>
                    {(Object.keys(SMM_WORK_TYPE_LABELS) as SmmWorkType[]).map(t => <option key={t} value={t}>{SMM_WORK_TYPE_LABELS[t]}</option>)}
                  </select>
                  <input className={INPUT} type="number" placeholder="Сумма работы, ₽ (опционально)" value={montageForm.workAmount} onChange={e => setMontageForm(f => ({ ...f, workAmount: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleLinkMontage} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Передать в монтаж</button>
                  <button type="button" onClick={() => setMontageFormOpen(false)} className="text-zinc-400 hover:text-zinc-200 text-xs px-3 py-2">Отмена</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setMontageFormOpen(true)} className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                <Film className="w-3.5 h-3.5" /> Передать в монтаж
              </button>
            )}
          </div>

          {/* Публикации (ТЗ 2B, п.20-23) */}
          <div className={SECTION}>
            <div className="flex items-center justify-between">
              <p className={SECTION_TITLE}><Share2 className="w-4 h-4 text-zinc-400" /> Публикации</p>
              <button type="button" onClick={() => setPubFormOpen(v => !v)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"><Plus className="w-3.5 h-3.5" /> Добавить</button>
            </div>
            {pubFormOpen && (
              <div className="bg-zinc-800/40 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select className={`${SELECT} w-full`} value={pubForm.platform} onChange={e => setPubForm(f => ({ ...f, platform: e.target.value as SmmPublicationPlatform }))}>
                    {(Object.keys(SMM_PUBLICATION_PLATFORM_LABELS) as SmmPublicationPlatform[]).map(p => <option key={p} value={p}>{SMM_PUBLICATION_PLATFORM_LABELS[p]}</option>)}
                  </select>
                  <select className={`${SELECT} w-full`} value={pubForm.status} onChange={e => setPubForm(f => ({ ...f, status: e.target.value as SmmPublicationStatus }))}>
                    {(Object.keys(SMM_PUBLICATION_STATUS_LABELS) as SmmPublicationStatus[]).map(s => <option key={s} value={s}>{SMM_PUBLICATION_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                {pubForm.platform === 'OTHER' && <input className={INPUT} placeholder="Название площадки" value={pubForm.customPlatform} onChange={e => setPubForm(f => ({ ...f, customPlatform: e.target.value }))} />}
                <div className="grid grid-cols-2 gap-2">
                  <input className={INPUT} type="date" value={pubForm.plannedPublishAt} onChange={e => setPubForm(f => ({ ...f, plannedPublishAt: e.target.value }))} placeholder="План" />
                  <input className={INPUT} type="date" value={pubForm.publishedAt} onChange={e => setPubForm(f => ({ ...f, publishedAt: e.target.value }))} placeholder="Факт" />
                </div>
                <input className={INPUT} placeholder="Ссылка" value={pubForm.url} onChange={e => setPubForm(f => ({ ...f, url: e.target.value }))} />
                <button type="button" onClick={handleAddPublication} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Добавить</button>
              </div>
            )}
            {detail.publications.length > 0 ? (
              <div className="space-y-2">
                {detail.publications.map(pub => {
                  const latest = getLatestMetricByType(pub.metrics)
                  return (
                    <div key={pub.id} className="bg-zinc-800/30 rounded-lg px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-zinc-300 text-xs">
                          <span className="text-zinc-100">{SMM_PUBLICATION_PLATFORM_LABELS[pub.platform]}{pub.platform === 'OTHER' && pub.customPlatform ? ` (${pub.customPlatform})` : ''}</span>
                          {' · '}{SMM_PUBLICATION_STATUS_LABELS[pub.status]}
                          {pub.plannedPublishAt && ` · план ${formatDate(pub.plannedPublishAt)}`}
                          {pub.publishedAt && ` · факт ${formatDate(pub.publishedAt)}`}
                          {pub.url && <> · <a href={pub.url} target="_blank" rel="noopener noreferrer" className="text-[#00c26b] hover:underline">ссылка</a></>}
                        </p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {pub.status !== 'PUBLISHED' && pub.status !== 'CANCELLED' && (
                            <button type="button" onClick={() => startQuickPublish(pub.id, pub.url)} className="text-[11px] text-[#00c26b] hover:underline">Опубликовать</button>
                          )}
                          <button type="button" onClick={() => setMetricFormFor(metricFormFor === pub.id ? null : pub.id)} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200 text-[11px]"><BarChart3 className="w-3 h-3" /> Метрики</button>
                          <button type="button" onClick={() => handleDeletePublication(pub.id)} className="text-zinc-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                      {publishFormFor === pub.id && (
                        <div className="flex items-end gap-2 flex-wrap bg-zinc-900/60 rounded-lg p-2">
                          <input className={INPUT} placeholder="Ссылка на публикацию" value={publishForm.url} onChange={e => setPublishForm(f => ({ ...f, url: e.target.value }))} />
                          <input className={INPUT} type="date" value={publishForm.publishedAt} onChange={e => setPublishForm(f => ({ ...f, publishedAt: e.target.value }))} />
                          <button type="button" onClick={() => handleQuickPublish(pub.id)} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Подтвердить</button>
                          <button type="button" onClick={() => setPublishFormFor(null)} className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-2">Отмена</button>
                        </div>
                      )}
                      {Object.keys(latest).length > 0 && (
                        <p className="text-zinc-500 text-[11px]">{(Object.keys(latest) as SmmMetricType[]).map(t => `${SMM_METRIC_TYPE_LABELS[t]}: ${latest[t]!.value}`).join(' · ')}</p>
                      )}
                      {metricFormFor === pub.id && (
                        <div className="space-y-1.5">
                          <div className="flex items-end gap-2 flex-wrap">
                            <select className={SELECT} value={metricForm.metricType} onChange={e => setMetricForm(f => ({ ...f, metricType: e.target.value as SmmMetricType }))}>
                              {(Object.keys(SMM_METRIC_TYPE_LABELS) as SmmMetricType[]).map(t => <option key={t} value={t}>{SMM_METRIC_TYPE_LABELS[t]}</option>)}
                            </select>
                            <input className={`${INPUT} w-24`} type="number" placeholder="Значение" value={metricForm.value} onChange={e => setMetricForm(f => ({ ...f, value: e.target.value }))} />
                            <input className={INPUT} type="date" value={metricForm.capturedAt} onChange={e => setMetricForm(f => ({ ...f, capturedAt: e.target.value }))} />
                            <select className={SELECT} value={metricForm.source} onChange={e => setMetricForm(f => ({ ...f, source: e.target.value as SmmMetricSource }))}>
                              {(Object.keys(SMM_METRIC_SOURCE_LABELS) as SmmMetricSource[]).map(s => <option key={s} value={s}>{SMM_METRIC_SOURCE_LABELS[s]}</option>)}
                            </select>
                            <button type="button" onClick={() => handleAddMetric(pub.id)} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Добавить</button>
                          </div>
                          {pub.metrics.length > 0 && (
                            <div className="space-y-0.5">
                              {pub.metrics.map(m => (
                                <p key={m.id} className="text-zinc-500 text-[11px] flex items-center gap-2">
                                  <span>{SMM_METRIC_TYPE_LABELS[m.metricType]}: {m.value} · {formatDate(m.capturedAt)} · {SMM_METRIC_SOURCE_LABELS[m.source]}</span>
                                  <button type="button" onClick={() => handleDeleteMetric(pub.id, m.id)} className="text-zinc-600 hover:text-red-400"><X className="w-3 h-3" /></button>
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : <p className="text-zinc-600 text-sm">Публикаций нет</p>}
          </div>

          {/* Работы / деньги (ТЗ 2B, п.24/25) */}
          <div className={SECTION}>
            <div className="flex items-center justify-between">
              <p className={SECTION_TITLE}>Работы</p>
              <button type="button" onClick={() => setWorkFormOpen(v => !v)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"><Plus className="w-3.5 h-3.5" /> Работа</button>
            </div>
            {workFormOpen && (
              <div className="bg-zinc-800/40 rounded-lg p-3 flex items-end gap-2 flex-wrap">
                <select className={SELECT} value={workForm.performerId} onChange={e => setWorkForm(f => ({ ...f, performerId: e.target.value }))}>
                  <option value="">Исполнитель...</option>
                  {editors.map(ed => <option key={ed.id} value={ed.id}>{ed.displayName}</option>)}
                </select>
                <select className={SELECT} value={workForm.workType} onChange={e => setWorkForm(f => ({ ...f, workType: e.target.value as SmmWorkType }))}>
                  {(Object.keys(SMM_WORK_TYPE_LABELS) as SmmWorkType[]).map(t => <option key={t} value={t}>{SMM_WORK_TYPE_LABELS[t]}</option>)}
                </select>
                <input className={`${INPUT} w-28`} type="number" placeholder="Сумма, ₽" value={workForm.amount} onChange={e => setWorkForm(f => ({ ...f, amount: e.target.value }))} />
                <input className={INPUT} type="date" value={workForm.workDate} onChange={e => setWorkForm(f => ({ ...f, workDate: e.target.value }))} />
                <button type="button" onClick={handleAddWork} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Добавить</button>
              </div>
            )}
            {detail.workItems.length > 0 ? (
              <div className="space-y-1">
                {detail.workItems.map(w => (
                  <p key={w.id} className="text-zinc-400 text-xs flex items-center gap-2">
                    <span>{w.performerName} — {SMM_WORK_TYPE_LABELS[w.workType]} — {formatSmmMoney(w.amount)} · {w.status === 'APPROVED' ? 'подтверждено' : w.status === 'SUBMITTED' ? 'отправлено' : w.status === 'REJECTED' ? 'отклонено' : 'черновик'} · {SMM_WORK_PAYMENT_STATUS_LABELS[w.paymentStatus]}</span>
                    {w.status !== 'APPROVED' && <button type="button" onClick={() => handleApproveWork(w.id)} className="text-[#00c26b] hover:underline">Подтвердить</button>}
                  </p>
                ))}
              </div>
            ) : <p className="text-zinc-600 text-sm">Работ пока нет</p>}
          </div>

          {/* Производный контент (ТЗ 2B, п.27) */}
          <div className={SECTION}>
            <div className="flex items-center justify-between">
              <p className={SECTION_TITLE}><GitBranch className="w-4 h-4 text-zinc-400" /> Производные материалы</p>
              <button type="button" onClick={() => setDerivedFormOpen(v => !v)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"><Plus className="w-3.5 h-3.5" /> Создать производный контент</button>
            </div>
            {derivedFormOpen && (
              <div className="bg-zinc-800/40 rounded-lg p-3 flex items-end gap-2 flex-wrap">
                <select className={SELECT} value={derivedForm.serviceType} onChange={e => setDerivedForm(f => ({ ...f, serviceType: e.target.value as SmmServiceType }))}>
                  {CONTENT_SERVICE_TYPES.map(t => <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>)}
                </select>
                <input className={`${INPUT} flex-1 min-w-[160px]`} placeholder="Название" value={derivedForm.title} onChange={e => setDerivedForm(f => ({ ...f, title: e.target.value }))} />
                <input className={`${INPUT} w-32`} placeholder="Content Code" value={derivedForm.contentCode} onChange={e => setDerivedForm(f => ({ ...f, contentCode: e.target.value }))} />
                <button type="button" onClick={handleCreateDerived} className="bg-[#00c26b] hover:bg-[#00b360] text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">Создать</button>
              </div>
            )}
            {detail.childContent.length > 0 ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                {detail.childContent.map(c => (
                  <button key={c.id} type="button" onClick={() => onOpenContentItem(c.id)} className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-2.5 py-1.5 transition-colors">
                    {c.contentCode || c.title || 'Без названия'}
                  </button>
                ))}
              </div>
            ) : <p className="text-zinc-600 text-sm">Производных материалов нет</p>}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-zinc-800 flex items-center justify-between flex-shrink-0">
          <button type="button" onClick={handleDelete} className="flex items-center gap-1.5 text-zinc-500 hover:text-red-400 text-xs transition-colors"><Trash2 className="w-3.5 h-3.5" /> Удалить единицу контента</button>
          <button type="button" onClick={() => onOpenChange(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors">Закрыть</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
