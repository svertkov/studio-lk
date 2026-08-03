'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { X, AlertTriangle } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  pauseMontageProject, resumeMontageProject, cancelMontageProject, archiveMontageProject, unarchiveMontageProject,
  type MontageProjectDTO,
} from '@/lib/actions/montage'
import { getAllEditorProfiles, type EditorProfileListItemDTO } from '@/lib/actions/editors'
import {
  MONTAGE_STATUS_ORDER, MONTAGE_STATUS_LABELS, MONTAGE_CLIENT_PAYMENT_STATUS_LABELS, MONTAGE_EDITOR_PAYMENT_STATUS_LABELS,
  MONTAGE_CONTENT_TYPE_ORDER, MONTAGE_CONTENT_TYPE_LABELS, MONTAGE_ATTENTION_LABELS, MONTAGE_ARCHIVABLE_STATUSES,
  computeMontageDeadline, computeMontageProfit, isMontageOverdue, montageDeadlineLabel,
  getMontageMaterialsState, getMontageMaterialsMissingFields, buildMontageFormValues, diffMontageFormValues,
  type MontageStatus, type MontageDeadlineType, type MontageContentType, type MontageTurnaroundDayType,
  type MontageAttentionReason, type MontageProjectFormValues,
} from '@/lib/montage-model'
import WorkDocumentsSection from '@/components/documents/WorkDocumentsSection'

// Единственный редактор полей карточки монтажа (см. montage-model.ts,
// MontageProjectFormValues) — используется и отдельной карточкой
// (MontageProjectModal.tsx), и встроенным блоком в канонической карточке
// заказа (EmbeddedMontageSection.tsx). Сам не сохраняет и не оборачивается в
// Dialog — родитель решает, где показать поля и как их сохранить (см.
// getValues() ниже), тот же приём, что SubscriptionPaymentBlock/FinanceEditor.

const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none'
const LABEL = 'block text-zinc-400 text-xs'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

// Те же причины "Требует внимания", что показываются как незаполненность
// прямо в карточке (не как отдельный статус) — см. оригинальный комментарий,
// перенесённый без изменений при выделении этого компонента.
const CARD_WARNING_REASONS: MontageAttentionReason[] = ['NO_EDITOR', 'NO_SOURCE', 'NO_DEADLINE', 'INCOMPLETE_CARD']

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}
function FieldLabel({ children }: { children: ReactNode }) {
  return <label className={LABEL}>{children}</label>
}

interface SelectOption {
  value: string
  label: string
}

function DarkSelect({
  value, onValueChange, options, placeholder = 'Не выбрано',
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
}) {
  const labelByValue = useMemo(() => new Map(options.map(o => [o.value, o.label])), [options])
  return (
    <Select value={value} onValueChange={v => onValueChange((v as string | null) ?? '')}>
      <SelectTrigger
        className={`${FIELD_BASE} w-full justify-between px-3 text-zinc-200 data-[popup-open]:border-[#00c26b]`}
      >
        <SelectValue placeholder={placeholder}>
          {(v: string) => (v ? (labelByValue.get(v) ?? v) : placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-zinc-800 border border-zinc-700 text-zinc-200 shadow-xl rounded-lg">
        {options.map(o => (
          <SelectItem
            key={o.value || '__empty__'}
            value={o.value}
            className="text-zinc-300 rounded-md cursor-pointer data-[highlighted]:bg-zinc-700 data-[highlighted]:text-white data-[selected]:text-[#00c26b]"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}
function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
}

export interface MontageProjectFieldsHandle {
  getValues: () => MontageProjectFormValues
  // Только поля, реально изменённые пользователем относительно того, с чем
  // форма была смонтирована — см. diffMontageFormValues (montage-model.ts) о
  // том, почему это отдельная функция, а не просто montageFormValuesToInput
  // поверх getValues(). Использует EmbeddedMontageSection.commitMontage —
  // MontageProjectModal.tsx продолжает работать через getValues() как раньше.
  getChangedInput: () => ReturnType<typeof diffMontageFormValues>
}

interface Props {
  // null — черновик (проект ещё не создан). Читается ТОЛЬКО при монтировании
  // (см. FinanceEditor/SubscriptionPaymentBlock — тот же приём в этом
  // проекте): родитель обязан рендерить этот компонент только когда project
  // уже "известен" (загружен либо подтверждённо отсутствует), не менять его
  // на лету через смену пропа без смены key.
  project: MontageProjectDTO | null
  // Заказ уже показан в родительской карточке — ссылка "Открыть заказ" там
  // избыточна (см. EmbeddedMontageSection). По умолчанию true — как в
  // исторической отдельной карточке монтажа.
  showOrderLink?: boolean
  // Сработавшее служебное действие (пауза/отмена/архив/снятие с архива)
  // меняет проект сразу на сервере — родитель может обновить свои внешние
  // индикаторы (например "Проект создан · Статус" в EmbeddedMontageSection).
  onProjectChanged?: (project: MontageProjectDTO) => void
  // Карточка открыта кликом по предупреждению материалов в таблице (см.
  // MontageProjectsTable.tsx) — прокручиваем к разделу "Материалы" и ставим
  // focus на первое отсутствующее NAS-поле. Перенесено сюда при выделении
  // компонента — секция физически живёт здесь, а не в обёртке-модалке.
  focusMaterialsOnOpen?: boolean
}

const MontageProjectFields = forwardRef<MontageProjectFieldsHandle, Props>(function MontageProjectFields(
  { project, showOrderLink = true, onProjectChanged, focusMaterialsOnOpen }, ref,
) {
  const isEdit = !!project

  // Локальная копия проекта — обновляется после успешного служебного
  // действия (пауза/отмена/архив), чтобы бейджи статуса в этом же блоке
  // сразу отражали новое состояние без перемонтирования всего компонента
  // (см. комментарий у Props.project выше). Не участвует в getValues() —
  // служебные действия не редактируют обычные поля формы.
  const [liveProject, setLiveProject] = useState(project)

  const [editors, setEditors] = useState<EditorProfileListItemDTO[] | null>(null)
  useEffect(() => {
    let cancelled = false
    getAllEditorProfiles().then(res => { if (!cancelled && res.ok) setEditors(res.data) })
    return () => { cancelled = true }
  }, [])

  const initial = useMemo(() => buildMontageFormValues(project), [project])

  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [contentType, setContentType] = useState<MontageContentType | ''>(initial.contentType)
  const [customContentType, setCustomContentType] = useState(initial.customContentType)
  const [status, setStatus] = useState<MontageStatus>(initial.status)

  const [editorId, setEditorId] = useState(initial.editorId)
  const [additionalEditorIds, setAdditionalEditorIds] = useState<string[]>(initial.additionalEditorIds)
  const [addEditorPick, setAddEditorPick] = useState('')

  const [sourceReceivedAt, setSourceReceivedAt] = useState(initial.sourceReceivedAt)
  const [startedAt, setStartedAt] = useState(initial.startedAt)
  const [deadlineType, setDeadlineType] = useState<'' | MontageDeadlineType>(initial.deadlineType)
  const [deadlineDateInput, setDeadlineDateInput] = useState(initial.deadlineDate)
  const [turnaroundDays, setTurnaroundDays] = useState(initial.turnaroundDays)
  const [turnaroundDayType, setTurnaroundDayType] = useState<'' | MontageTurnaroundDayType>(initial.turnaroundDayType)
  const [deliveredAt, setDeliveredAt] = useState(initial.deliveredAt)

  const [clientAmount, setClientAmount] = useState(initial.clientAmount)
  const [editorAmount, setEditorAmount] = useState(initial.editorAmount)
  const [clientPaymentStatus, setClientPaymentStatus] = useState(initial.clientPaymentStatus)
  const [editorPaymentStatus, setEditorPaymentStatus] = useState(initial.editorPaymentStatus)
  const [clientPaidAt, setClientPaidAt] = useState(initial.clientPaidAt)
  const [editorPaidAt, setEditorPaidAt] = useState(initial.editorPaidAt)
  const [paymentComment, setPaymentComment] = useState(initial.paymentComment)

  const [sourceMaterialsUrl, setSourceMaterialsUrl] = useState(initial.sourceMaterialsUrl)
  const [sourceMaterialsNasUrl, setSourceMaterialsNasUrl] = useState(initial.sourceMaterialsNasUrl)
  const [mountedMaterialNasUrl, setMountedMaterialNasUrl] = useState(initial.mountedMaterialNasUrl)
  const [deliveryUrl, setDeliveryUrl] = useState(initial.deliveryUrl)
  const [materialsComment, setMaterialsComment] = useState(initial.materialsComment)

  const [revisionsIncluded, setRevisionsIncluded] = useState(initial.revisionsIncluded)
  const [revisionsUsed, setRevisionsUsed] = useState(initial.revisionsUsed)
  const [revisionsComment, setRevisionsComment] = useState(initial.revisionsComment)

  const [requirements, setRequirements] = useState(initial.requirements)
  const [internalComment, setInternalComment] = useState(initial.internalComment)
  const [clientComment, setClientComment] = useState(initial.clientComment)

  const materialsSectionRef = useRef<HTMLParagraphElement>(null)
  const sourceMaterialsNasInputRef = useRef<HTMLInputElement>(null)
  const mountedMaterialNasInputRef = useRef<HTMLInputElement>(null)

  // Прокрутка + focus при открытии карточки кликом по предупреждению
  // материалов в таблице — один раз при монтаже, читает НАЧАЛЬНЫЕ значения из
  // project (не текущее состояние формы), поэтому зависимости эффекта
  // стабильны и не перезапускают его при каждом вводе в поле.
  useEffect(() => {
    if (!focusMaterialsOnOpen || !project) return
    // Диалог (@base-ui/react/dialog) сам ставит начальный focus при открытии
    // (плюс своя transition) — если сфокусировать поле сразу, эта внутренняя
    // логика диалога срабатывает ПОСЛЕ и перехватывает focus обратно на
    // дефолтный элемент. Небольшая задержка даёт её логике отработать первой.
    const timer = setTimeout(() => {
      materialsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const target = !project.sourceMaterialsNasUrl
        ? sourceMaterialsNasInputRef.current
        : !project.mountedMaterialNasUrl
          ? mountedMaterialNasInputRef.current
          : null
      target?.focus({ preventScroll: true })
    }, 150)
    return () => clearTimeout(timer)
  }, [focusMaterialsOnOpen, project])

  useImperativeHandle(ref, () => {
    function currentValues(): MontageProjectFormValues {
      return {
        title, description, contentType, customContentType, status,
        editorId, additionalEditorIds,
        sourceReceivedAt, startedAt, deadlineType, deadlineDate: deadlineDateInput, turnaroundDays, turnaroundDayType, deliveredAt,
        clientAmount, editorAmount, clientPaymentStatus, editorPaymentStatus, clientPaidAt, editorPaidAt, paymentComment,
        sourceMaterialsUrl, sourceMaterialsNasUrl, mountedMaterialNasUrl, deliveryUrl, materialsComment,
        revisionsIncluded, revisionsUsed, revisionsComment,
        requirements, internalComment, clientComment,
      }
    }
    return {
      getValues: currentValues,
      getChangedInput: () => diffMontageFormValues(initial, currentValues()),
    }
  }, [
    title, description, contentType, customContentType, status, editorId, additionalEditorIds,
    sourceReceivedAt, startedAt, deadlineType, deadlineDateInput, turnaroundDays, turnaroundDayType, deliveredAt,
    clientAmount, editorAmount, clientPaymentStatus, editorPaymentStatus, clientPaidAt, editorPaidAt, paymentComment,
    sourceMaterialsUrl, sourceMaterialsNasUrl, mountedMaterialNasUrl, deliveryUrl, materialsComment,
    revisionsIncluded, revisionsUsed, revisionsComment, requirements, internalComment, clientComment,
    initial,
  ])

  const [confirmingAction, setConfirmingAction] = useState<'pause' | 'cancel' | 'archive' | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [actionSaving, setActionSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const deadlinePreview = useMemo(() => computeMontageDeadline({
    sourceReceivedAt: sourceReceivedAt || null,
    deadlineType: deadlineType || null,
    deadlineDate: deadlineDateInput || null,
    turnaroundDays: turnaroundDays ? Number(turnaroundDays) : null,
    turnaroundDayType: turnaroundDayType || null,
  }), [sourceReceivedAt, deadlineType, deadlineDateInput, turnaroundDays, turnaroundDayType])

  const deadlineStateForLabel = useMemo(() => ({
    deadlineDate: deadlinePreview, status, deliveredAt: deliveredAt || null,
    isArchived: isEdit ? liveProject!.isArchived : false,
  }), [deadlinePreview, status, deliveredAt, isEdit, liveProject])
  const deadlineStatusLabel = montageDeadlineLabel(deadlineStateForLabel)
  const deadlineIsOverduePreview = isMontageOverdue(deadlineStateForLabel)

  const profitPreview = computeMontageProfit(clientAmount ? Number(clientAmount) : null, editorAmount ? Number(editorAmount) : null)

  const materialsStatePreview = useMemo(() => getMontageMaterialsState({
    status, sourceReceivedAt: sourceReceivedAt || null,
    sourceMaterialsNasUrl: sourceMaterialsNasUrl || null, mountedMaterialNasUrl: mountedMaterialNasUrl || null,
    isArchived: isEdit ? liveProject!.isArchived : false,
  }), [status, sourceReceivedAt, sourceMaterialsNasUrl, mountedMaterialNasUrl, isEdit, liveProject])
  const materialsMissingPreview = useMemo(() => getMontageMaterialsMissingFields({
    status, sourceMaterialsNasUrl: sourceMaterialsNasUrl || null, mountedMaterialNasUrl: mountedMaterialNasUrl || null,
  }), [status, sourceMaterialsNasUrl, mountedMaterialNasUrl])

  const cardWarnings = isEdit ? liveProject!.attentionReasons.filter(r => CARD_WARNING_REASONS.includes(r)) : []

  function addEditor(id: string) {
    if (!id || additionalEditorIds.includes(id) || id === editorId) return
    setAdditionalEditorIds(prev => [...prev, id])
    setAddEditorPick('')
  }
  function removeEditor(id: string) {
    setAdditionalEditorIds(prev => prev.filter(x => x !== id))
  }

  function handleStatusChange(next: MontageStatus) {
    setStatus(next)
    const today = new Date().toISOString().slice(0, 10)
    if (next === 'IN_PROGRESS' && !startedAt) setStartedAt(today)
    if (next === 'DELIVERED' && !deliveredAt) setDeliveredAt(today)
  }

  function handleContentTypeChange(next: string) {
    const typed = next as MontageContentType | ''
    setContentType(typed)
    if (typed !== 'OTHER') setCustomContentType('')
  }

  function handleDeadlineTypeChange(next: string) {
    const typed = next as '' | MontageDeadlineType
    setDeadlineType(typed)
    if (typed === 'DURATION_DAYS' && !turnaroundDayType) setTurnaroundDayType('CALENDAR')
  }

  async function runProjectAction(action: 'pause' | 'resume' | 'cancel' | 'archive' | 'unarchive') {
    if (!liveProject) return
    setActionSaving(true)
    setActionError(null)
    const reason = actionReason.trim() || null
    const result = await (
      action === 'pause' ? pauseMontageProject(liveProject.id, reason)
      : action === 'resume' ? resumeMontageProject(liveProject.id)
      : action === 'cancel' ? cancelMontageProject(liveProject.id, reason)
      : action === 'archive' ? archiveMontageProject(liveProject.id)
      : unarchiveMontageProject(liveProject.id)
    )
    setActionSaving(false)
    if (!result.ok) { setActionError(result.error); return }
    setConfirmingAction(null)
    setActionReason('')
    setLiveProject(result.data)
    onProjectChanged?.(result.data)
  }

  return (
    <>
      {cardWarnings.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {cardWarnings.map(r => (
            <span key={r} className="inline-flex items-center gap-1 bg-amber-950/20 border border-amber-600/40 text-amber-300 text-xs rounded-full px-2.5 py-1">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              {MONTAGE_ATTENTION_LABELS[r]}
            </span>
          ))}
        </div>
      )}

      <p className={SECTION}>Основное</p>
      <div className="space-y-3">
        <Row>
          <Field>
            <FieldLabel>Название проекта</FieldLabel>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Например: Монтаж подкаста от 07.10.2025" className={INPUT} />
          </Field>
          <Field>
            <FieldLabel>Тип контента</FieldLabel>
            <DarkSelect
              value={contentType}
              onValueChange={handleContentTypeChange}
              placeholder="Не указан"
              options={[
                { value: '', label: 'Не указан' },
                ...MONTAGE_CONTENT_TYPE_ORDER.map(t => ({ value: t, label: MONTAGE_CONTENT_TYPE_LABELS[t] })),
              ]}
            />
          </Field>
        </Row>
        {contentType === 'OTHER' && (
          <Field>
            <FieldLabel>Уточните тип контента</FieldLabel>
            <input value={customContentType} onChange={e => setCustomContentType(e.target.value)} placeholder="Например: репортаж с мероприятия" className={INPUT} />
          </Field>
        )}
        <Field>
          <FieldLabel>Описание / ТЗ по монтажу</FieldLabel>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={TEXTAREA} />
        </Field>
        {showOrderLink && isEdit && liveProject!.orderId && (
          <Link href="/admin/crm" className="text-[#00c26b] hover:underline text-xs">Открыть связанный заказ в CRM →</Link>
        )}
      </div>

      <p className={SECTION}>Ответственный монтажёр</p>
      <Row>
        <Field>
          <FieldLabel>Основной монтажёр</FieldLabel>
          <DarkSelect
            value={editorId}
            onValueChange={setEditorId}
            placeholder="Не назначен"
            options={[{ value: '', label: 'Не назначен' }, ...(editors ?? []).map(ed => ({ value: ed.id, label: ed.displayName }))]}
          />
        </Field>
        <Field>
          <FieldLabel>Дополнительные исполнители</FieldLabel>
          <div className="flex flex-wrap gap-1.5 mb-1.5 empty:mb-0">
            {additionalEditorIds.map(id => {
              const ed = (editors ?? []).find(e => e.id === id)
              return (
                <span key={id} className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-zinc-300">
                  {ed?.displayName ?? id}
                  <button type="button" onClick={() => removeEditor(id)} className="text-zinc-500 hover:text-zinc-200"><X className="w-3 h-3" /></button>
                </span>
              )
            })}
          </div>
          <DarkSelect
            value={addEditorPick}
            onValueChange={id => { if (id) addEditor(id) }}
            placeholder="Добавить исполнителя..."
            options={(editors ?? []).filter(ed => ed.id !== editorId && !additionalEditorIds.includes(ed.id)).map(ed => ({ value: ed.id, label: ed.displayName }))}
          />
        </Field>
      </Row>

      <p className={SECTION}>Статус</p>
      <Row>
        <Field>
          <FieldLabel>Статус</FieldLabel>
          {status === 'CANCELLED' ? (
            <div className="h-10 flex items-center px-3 bg-red-950/20 border border-red-800/40 rounded-lg text-red-300 text-sm">Отменён</div>
          ) : (
            <DarkSelect
              value={status}
              onValueChange={v => handleStatusChange(v as MontageStatus)}
              options={MONTAGE_STATUS_ORDER.map(s => ({ value: s, label: MONTAGE_STATUS_LABELS[s] }))}
            />
          )}
        </Field>
        <Field>
          <FieldLabel>Служебные действия</FieldLabel>
          {!isEdit ? (
            <p className="text-zinc-600 text-xs h-10 flex items-center">Доступно после создания проекта</p>
          ) : liveProject!.isArchived ? (
            <div className="space-y-2">
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2">
                <p className="text-zinc-400 text-xs">В архиве{liveProject!.archivedAt ? ` с ${formatDate(liveProject!.archivedAt)}` : ''}</p>
              </div>
              <button type="button" onClick={() => runProjectAction('unarchive')} disabled={actionSaving} className="w-full text-xs text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                Вернуть из архива
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {status === 'CANCELLED' ? (
                <div className="bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2">
                  <p className="text-red-300 text-xs font-medium">Отменён{liveProject!.cancelledAt ? ` ${formatDate(liveProject!.cancelledAt)}` : ''}</p>
                  {liveProject!.cancelReason && <p className="text-red-300/70 text-xs mt-0.5">{liveProject!.cancelReason}</p>}
                </div>
              ) : liveProject!.isPaused ? (
                <div className="flex items-center justify-between gap-2 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-amber-300 text-xs font-medium">Приостановлен</p>
                    {liveProject!.pauseReason && <p className="text-amber-300/70 text-xs truncate">{liveProject!.pauseReason}</p>}
                  </div>
                  <button type="button" onClick={() => runProjectAction('resume')} disabled={actionSaving} className="text-xs text-zinc-200 hover:text-white bg-zinc-700 hover:bg-zinc-600 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50">
                    Возобновить
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmingAction('pause')} className="w-full text-left text-xs text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 rounded-lg transition-colors">
                  Приостановить проект
                </button>
              )}

              {status !== 'CANCELLED' && (
                <button type="button" onClick={() => setConfirmingAction('cancel')} className="w-full text-left text-xs text-red-300 hover:text-red-200 bg-red-950/10 hover:bg-red-950/20 border border-red-900/40 px-3 py-2 rounded-lg transition-colors">
                  Отменить проект
                </button>
              )}

              {MONTAGE_ARCHIVABLE_STATUSES.includes(status) && (
                <button type="button" onClick={() => setConfirmingAction('archive')} className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 px-3 py-2 rounded-lg transition-colors">
                  Отправить в архив
                </button>
              )}
            </div>
          )}
        </Field>
      </Row>

      {confirmingAction && (
        <div className="mt-3 bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 space-y-2">
          <p className="text-zinc-200 text-sm font-medium">
            {confirmingAction === 'pause' && 'Приостановить проект?'}
            {confirmingAction === 'cancel' && 'Отменить проект?'}
            {confirmingAction === 'archive' && 'Отправить проект в архив?'}
          </p>
          {(confirmingAction === 'pause' || confirmingAction === 'cancel') && (
            <textarea
              value={actionReason}
              onChange={e => setActionReason(e.target.value)}
              placeholder={confirmingAction === 'cancel' ? 'Причина отмены (обязательно)' : 'Причина паузы (необязательно)'}
              rows={2}
              className={TEXTAREA}
            />
          )}
          {actionError && <p className="text-red-400 text-xs">{actionError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runProjectAction(confirmingAction)}
              disabled={actionSaving || (confirmingAction === 'cancel' && !actionReason.trim())}
              className={`flex-1 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors ${confirmingAction === 'cancel' ? 'bg-red-600 hover:bg-red-500' : 'bg-zinc-700 hover:bg-zinc-600'}`}
            >
              {actionSaving ? 'Применяю...' : 'Подтвердить'}
            </button>
            <button
              type="button"
              onClick={() => { setConfirmingAction(null); setActionReason(''); setActionError(null) }}
              className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      <p className={SECTION}>Сроки</p>
      <div className="space-y-3">
        <Row>
          <Field>
            <FieldLabel>Дата поступления в монтаж</FieldLabel>
            <input type="date" value={sourceReceivedAt} onChange={e => setSourceReceivedAt(e.target.value)} className={INPUT} />
          </Field>
          <Field>
            <FieldLabel>Дата начала работы</FieldLabel>
            <input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} className={INPUT} />
          </Field>
        </Row>
        <Row>
          <Field>
            <FieldLabel>Плановый срок сдачи — способ задания</FieldLabel>
            <DarkSelect
              value={deadlineType}
              onValueChange={handleDeadlineTypeChange}
              options={[
                { value: '', label: 'Не задан' },
                { value: 'FIXED_DATE', label: 'Конкретная дата' },
                { value: 'DURATION_DAYS', label: 'Количество дней от поступления' },
              ]}
            />
          </Field>
          {deadlineType === 'FIXED_DATE' && (
            <Field>
              <FieldLabel>Дедлайн</FieldLabel>
              <input type="date" value={deadlineDateInput} onChange={e => setDeadlineDateInput(e.target.value)} className={INPUT} />
            </Field>
          )}
          {deadlineType === 'DURATION_DAYS' && (
            <Field>
              <FieldLabel>Дней на монтаж</FieldLabel>
              <div className="flex gap-2">
                <input type="number" min={0} value={turnaroundDays} onChange={e => setTurnaroundDays(e.target.value)} className={`${INPUT} flex-1 min-w-0`} />
                <div className="w-[9.5rem] flex-shrink-0">
                  <DarkSelect
                    value={turnaroundDayType || 'CALENDAR'}
                    onValueChange={v => setTurnaroundDayType(v as MontageTurnaroundDayType)}
                    options={[{ value: 'CALENDAR', label: 'Календарные' }, { value: 'BUSINESS', label: 'Рабочие' }]}
                  />
                </div>
              </div>
            </Field>
          )}
        </Row>
        {deadlinePreview && (
          <p className="text-zinc-500 text-xs">Плановый срок сдачи: <span className="text-zinc-300 font-medium">{formatDate(deadlinePreview.toISOString())}</span></p>
        )}
        <Row>
          <Field>
            <FieldLabel>Фактическая дата сдачи</FieldLabel>
            <input type="date" value={deliveredAt} onChange={e => setDeliveredAt(e.target.value)} className={INPUT} />
          </Field>
          <Field>
            <FieldLabel>Статус по срокам</FieldLabel>
            <div className="h-10 flex items-center px-3 bg-zinc-800/60 border border-zinc-700 rounded-lg text-sm">
              <span className={deadlineIsOverduePreview ? 'text-red-400' : status === 'DELIVERED' ? 'text-green-400' : 'text-zinc-300'}>
                {deadlineStatusLabel ?? '—'}
              </span>
            </div>
          </Field>
        </Row>
      </div>

      <p className={SECTION}>Финансы</p>
      <div className="space-y-3">
        <Row>
          <Field>
            <FieldLabel>Сумма от клиента</FieldLabel>
            <input type="number" min={0} value={clientAmount} onChange={e => setClientAmount(e.target.value)} placeholder="0" className={INPUT} />
          </Field>
          <Field>
            <FieldLabel>Выплата монтажёру</FieldLabel>
            <input type="number" min={0} value={editorAmount} onChange={e => setEditorAmount(e.target.value)} placeholder="0" className={INPUT} />
          </Field>
        </Row>
        <p className="text-zinc-500 text-xs">Прибыль студии: <span className="text-zinc-300 font-medium">{formatMoney(profitPreview)}</span></p>
        <Row>
          <Field>
            <FieldLabel>Оплата клиента</FieldLabel>
            <DarkSelect
              value={clientPaymentStatus}
              onValueChange={v => setClientPaymentStatus(v as typeof clientPaymentStatus)}
              options={Object.entries(MONTAGE_CLIENT_PAYMENT_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            />
          </Field>
          <Field>
            <FieldLabel>Выплата монтажёру</FieldLabel>
            <DarkSelect
              value={editorPaymentStatus}
              onValueChange={v => setEditorPaymentStatus(v as typeof editorPaymentStatus)}
              options={Object.entries(MONTAGE_EDITOR_PAYMENT_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            />
          </Field>
        </Row>
        <Row>
          <Field>
            <FieldLabel>Дата оплаты клиентом</FieldLabel>
            <input type="date" value={clientPaidAt} onChange={e => setClientPaidAt(e.target.value)} className={INPUT} />
          </Field>
          <Field>
            <FieldLabel>Дата выплаты монтажёру</FieldLabel>
            <input type="date" value={editorPaidAt} onChange={e => setEditorPaidAt(e.target.value)} className={INPUT} />
          </Field>
        </Row>
        <Field>
          <FieldLabel>Комментарий по оплате</FieldLabel>
          <input value={paymentComment} onChange={e => setPaymentComment(e.target.value)} className={INPUT} />
        </Field>
      </div>

      <p ref={materialsSectionRef} className={SECTION}>Материалы</p>
      <div className="space-y-3">
        {materialsStatePreview === 'MISSING' && (
          <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
            <p className="text-red-300 text-xs">Материалы не прикреплены: отсутствуют исходники и готовая работа.</p>
          </div>
        )}
        {materialsStatePreview === 'PARTIAL' && (
          <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
            <p className="text-amber-300 text-xs">
              {materialsMissingPreview.missingSource ? 'Не прикреплена ссылка на исходники на NAS.' : 'Не прикреплена ссылка на готовый материал на NAS.'}
            </p>
          </div>
        )}
        <Field>
          <FieldLabel>Ссылка на исходники {isEdit && liveProject!.orderId && !sourceMaterialsUrl ? '(по умолчанию — со съёмки)' : ''}</FieldLabel>
          <input value={sourceMaterialsUrl} onChange={e => setSourceMaterialsUrl(e.target.value)} placeholder="https://disk.yandex.ru/..." className={INPUT} />
        </Field>
        <Field>
          <FieldLabel>Ссылка на исходники на NAS</FieldLabel>
          <input
            ref={sourceMaterialsNasInputRef}
            value={sourceMaterialsNasUrl}
            onChange={e => setSourceMaterialsNasUrl(e.target.value)}
            placeholder="\\nas\..."
            className={INPUT}
          />
        </Field>
        <Field>
          <FieldLabel>Ссылка на NAS (финальный материал)</FieldLabel>
          <input
            ref={mountedMaterialNasInputRef}
            value={mountedMaterialNasUrl}
            onChange={e => setMountedMaterialNasUrl(e.target.value)}
            placeholder="\\nas\..."
            className={INPUT}
          />
        </Field>
        <Field>
          <FieldLabel>Ссылка на превью / отдачу клиенту</FieldLabel>
          <input value={deliveryUrl} onChange={e => setDeliveryUrl(e.target.value)} className={INPUT} />
        </Field>
        <Field>
          <FieldLabel>Комментарий по материалам</FieldLabel>
          <input value={materialsComment} onChange={e => setMaterialsComment(e.target.value)} className={INPUT} />
        </Field>
      </div>

      <p className={SECTION}>Правки</p>
      <div className="space-y-3">
        <Row>
          <Field>
            <FieldLabel>Включено итераций</FieldLabel>
            <input type="number" min={0} value={revisionsIncluded} onChange={e => setRevisionsIncluded(e.target.value)} className={INPUT} />
          </Field>
          <Field>
            <FieldLabel>Использовано итераций</FieldLabel>
            <input type="number" min={0} value={revisionsUsed} onChange={e => setRevisionsUsed(e.target.value)} className={INPUT} />
          </Field>
        </Row>
        <Field>
          <FieldLabel>Комментарий по текущим правкам</FieldLabel>
          <textarea value={revisionsComment} onChange={e => setRevisionsComment(e.target.value)} rows={2} className={TEXTAREA} />
        </Field>
      </div>

      <p className={SECTION}>Комментарии</p>
      <div className="space-y-3">
        <Field>
          <FieldLabel>Требования к монтажу</FieldLabel>
          <textarea value={requirements} onChange={e => setRequirements(e.target.value)} rows={2} className={TEXTAREA} />
        </Field>
        <Field>
          <FieldLabel>Внутренний комментарий</FieldLabel>
          <textarea value={internalComment} onChange={e => setInternalComment(e.target.value)} rows={2} className={TEXTAREA} />
        </Field>
        <Field>
          <FieldLabel>Комментарий клиенту</FieldLabel>
          <textarea value={clientComment} onChange={e => setClientComment(e.target.value)} rows={2} className={TEXTAREA} />
        </Field>
      </div>

      {isEdit && (
        <>
          <p className={SECTION}>Документы</p>
          <WorkDocumentsSection montageProjectId={liveProject!.id} clientId={liveProject!.clientId} />
        </>
      )}
    </>
  )
})

export default MontageProjectFields
