'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import SaveStatusIndicator from '@/components/ui/save-status-indicator'
import GlowPill from '@/components/ui/glow-pill'
import { useAutosave, readAutosaveDraft, clearAutosaveDraft, type StoredDraft } from '@/lib/hooks/use-autosave'
import { getMontageProjectsForOrder, updateMontageProject, assignMontageEditor, type MontageProjectDTO } from '@/lib/actions/montage'
import { getOrder, updateOrderProfit, type UpdateOrderProfitInput } from '@/lib/actions/orders'
import { FINANCE_COMMENT_TEMPLATES, appendFinanceCommentTemplate } from '@/lib/finance-comment-model'
import EditorAssignField from './EditorAssignField'
import EditorReassignDialog from './EditorReassignDialog'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'

const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors px-3 py-2 text-zinc-100 placeholder-zinc-600 resize-none max-h-48 overflow-y-auto'
const LABEL = 'block text-zinc-400 text-xs'

// Цвет — только дополнительный акцент (см. ТЗ: "не выделять прибыль зелёным
// только потому, что положительная; для отрицательной допустим аккуратный
// красный акцент, но значение и подпись понятны без цвета"). Поэтому красим
// ТОЛЬКО отрицательное значение, положительное/нулевое остаётся обычным
// цветом текста, как и любое другое денежное поле.
function profitColorClass(amount: number | null): string {
  return amount != null && amount < 0 ? 'text-red-400' : 'text-zinc-100'
}

interface FinanceData {
  profitAmount: number | null
  financeComment: string | null
  profitUpdatedByName: string | null
  profitUpdatedAt: string | null
}

export interface OrderFinanceBlockHandle {
  // Вызывается родителем сразу после того, как в ЭТОМ ЖЕ "Сохранить" впервые
  // появился orderId (заказа не было — теперь есть, см. EventCardModal/
  // OrderFormModal.handleSave) — досылает то, что уже введено в "Прибыль по
  // заказу"/"Комментарий к прибыли", ДО того как родитель закроет карточку.
  // Без явного вызова несохранённый ввод терялся бы: обе карточки закрываются
  // сразу после успешного handleSave — раньше, чем успел бы сработать
  // штатный debounce автосейва этого блока (см. FinanceEditor ниже).
  flushToOrder: (orderId: string) => Promise<void>
}

interface Props {
  orderId: string | null
  // Тот же preliminaryAmount/estimatedPrice, что и раньше (дуал-сорсинг с
  // ScheduleEvent сохраняется — решает вызывающая сторона) — здесь только
  // переименованная подпись "Выручка по заказу", не новое поле. Строка, не
  // число — тот же паттерн контролируемого текстового инпута, что и у
  // остальных денежных полей в обеих модалках.
  revenueValue: string
  onRevenueChange: (v: string) => void
  editingRequired: boolean | null
  // Отдаёт родителю список непогашенных (не CANCELLED) проектов монтажа —
  // нужен MontageDisableChoiceDialog при отключении "Монтаж требуется"
  // (см. EditingRequiredControl в самих модалках), чтобы не делать второй
  // такой же запрос.
  onMontageProjectsLoaded?: (projects: MontageProjectDTO[]) => void
}

// Общий финансовый блок карточки заказа — используется и в OrderFormModal
// (CRM), и в EventCardModal (расписание/дашборд/карточка клиента), чтобы обе
// карточки одного заказа показывали одинаковую логику вместо двух разных
// независимых виджетов (см. AGENTS.md, единый источник данных). Выплата за
// монтаж и финансы заказа (прибыль/комментарий) — самостоятельные overlay-
// мутации (тот же приём, что pause/cancel/archiveMontageProject и
// WorkDocumentsSection): сохраняются через собственный автосейв, не через
// общую кнопку "Сохранить" карточки — так EventCardModal, у которого нет
// полного OrderDTO под рукой (только annotation.orderId), может показывать и
// редактировать эти данные без изменений в своей общей форме/handleSave.
// forwardRef — родитель дёргает flushToOrder() из своего handleSave в момент
// первого появления orderId (см. OrderFinanceBlockHandle выше).
const OrderFinanceBlock = forwardRef<OrderFinanceBlockHandle, Props>(function OrderFinanceBlock({
  orderId, revenueValue, onRevenueChange, editingRequired, onMontageProjectsLoaded,
}, ref) {
  const [projects, setProjects] = useState<MontageProjectDTO[] | null>(null)
  const [editorAmountDraft, setEditorAmountDraft] = useState('')
  const [clientAmountDraft, setClientAmountDraft] = useState('')
  const [savingPayout, setSavingPayout] = useState(false)
  const [payoutSaved, setPayoutSaved] = useState(false)
  const [finance, setFinance] = useState<FinanceData | null>(null)
  const [pendingEditor, setPendingEditor] = useState<EditorProfileListItemDTO | null>(null)
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false)
  const [assigningEditor, setAssigningEditor] = useState(false)
  const financeEditorRef = useRef<FinanceEditorHandle>(null)

  useImperativeHandle(ref, () => ({
    async flushToOrder(newOrderId: string) {
      await financeEditorRef.current?.flushToOrder(newOrderId)
    },
  }), [])

  // setState отложен через setTimeout(…, 0) для ветки "нет orderId" —
  // react-hooks/set-state-in-effect не разрешает синхронный setState в теле
  // эффекта (см. память проекта). Ветка с реальным orderId и так асинхронна
  // (setState происходит в .then()), этого правила не касается.
  useEffect(() => {
    let cancelled = false
    if (!orderId) {
      const timer = setTimeout(() => {
        setProjects([])
        setFinance({ profitAmount: null, financeComment: null, profitUpdatedByName: null, profitUpdatedAt: null })
      }, 0)
      return () => clearTimeout(timer)
    }

    getMontageProjectsForOrder(orderId).then(res => {
      if (cancelled) return
      const active = res.data.filter(p => p.status !== 'CANCELLED')
      setProjects(res.data)
      onMontageProjectsLoaded?.(active)
      const primary = active[0]
      setEditorAmountDraft(primary?.editorAmount != null ? String(primary.editorAmount) : '')
      setClientAmountDraft(primary?.clientAmount != null ? String(primary.clientAmount) : '')
    })
    getOrder(orderId).then(res => {
      if (cancelled) return
      if (res.ok) {
        setFinance({
          profitAmount: res.data.profitAmount,
          financeComment: res.data.financeComment,
          profitUpdatedByName: res.data.profitUpdatedByName,
          profitUpdatedAt: res.data.profitUpdatedAt,
        })
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const activeProject = projects?.find(p => p.status !== 'CANCELLED') ?? null

  async function handleSavePayout() {
    if (!activeProject) return
    setSavingPayout(true)
    const result = await updateMontageProject(activeProject.id, {
      editorAmount: editorAmountDraft.trim() ? parseFloat(editorAmountDraft) : null,
      clientAmount: clientAmountDraft.trim() ? parseFloat(clientAmountDraft) : null,
    })
    setSavingPayout(false)
    if (result.ok) {
      setProjects(prev => prev?.map(p => p.id === activeProject.id ? result.data : p) ?? null)
      setPayoutSaved(true)
      setTimeout(() => setPayoutSaved(false), 2000)
    }
  }

  // Прямое назначение (проект ещё без монтажёра) не требует подтверждения —
  // предупреждение нужно только при СМЕНЕ уже назначенного (ТЗ п.9).
  function handleEditorSelect(editor: EditorProfileListItemDTO | null) {
    if (!activeProject) return
    const newEditorId = editor?.id ?? null
    if (newEditorId === activeProject.editorId) return
    if (!activeProject.editorId || !editor) {
      void doAssignEditor(newEditorId)
      return
    }
    setPendingEditor(editor)
    setReassignDialogOpen(true)
  }

  async function doAssignEditor(editorId: string | null) {
    if (!activeProject) return
    setAssigningEditor(true)
    const result = await assignMontageEditor(activeProject.id, editorId)
    setAssigningEditor(false)
    if (result.ok) {
      setProjects(prev => prev?.map(p => (p.id === activeProject.id ? result.data : p)) ?? null)
    }
  }

  async function handleConfirmReassign() {
    if (!pendingEditor) return
    await doAssignEditor(pendingEditor.id)
    setReassignDialogOpen(false)
    setPendingEditor(null)
  }

  return (
    <>
      <div className="space-y-3">
        {editingRequired && (
          <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 space-y-2.5">
            <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Финансы и исполнитель монтажа</p>
            {projects === null ? (
              <p className="text-zinc-500 text-xs">Загрузка...</p>
            ) : !activeProject ? (
              <p className="text-zinc-500 text-xs">Проект монтажа ещё не создан — появится после сохранения.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Клиент платит за монтаж, ₽</Label>
                    <input className={INPUT} type="number" min="0" placeholder="напр. 20000" value={clientAmountDraft}
                      onChange={e => setClientAmountDraft(e.target.value)} />
                  </div>
                  <div>
                    <Label>Выплата монтажёру, ₽</Label>
                    <input className={INPUT} type="number" min="0" placeholder="напр. 15000" value={editorAmountDraft}
                      onChange={e => setEditorAmountDraft(e.target.value)} />
                  </div>
                </div>
                <EditorAssignField
                  value={activeProject.editorId}
                  valueLabel={activeProject.editorName}
                  onSelect={handleEditorSelect}
                />
                <div className="flex items-center gap-3">
                  {/* Отдельная кнопка сохранения — не часть общего autosave/"Сохранить"
                      карточки: этот блок самодостаточен (см. комментарий компонента
                      выше) специально потому, что у EventCardModal нет полного OrderDTO. */}
                  <button type="button" onClick={handleSavePayout} disabled={savingPayout}
                    className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-100 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    {savingPayout ? 'Сохранение...' : 'Обновить данные монтажа'}
                  </button>
                  {(payoutSaved || assigningEditor) && <span className="text-[#00c26b] text-xs">{assigningEditor ? 'Назначаем...' : 'Сохранено'}</span>}
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <Label>Выручка по заказу, ₽</Label>
          <input className={`${INPUT} mt-1.5`} type="number" min="0" placeholder="напр. 15000" value={revenueValue}
            onChange={e => onRevenueChange(e.target.value)} />
        </div>

        {finance && (
          <FinanceEditor ref={financeEditorRef} orderId={orderId} initialFinance={finance} />
        )}
      </div>

      {pendingEditor && activeProject && (
        <EditorReassignDialog
          open={reassignDialogOpen}
          onOpenChange={next => { setReassignDialogOpen(next); if (!next) setPendingEditor(null) }}
          currentEditorName={activeProject.editorName ?? 'Не назначен'}
          newEditorName={pendingEditor.displayName}
          currentPayout={activeProject.editorAmount}
          isProjectDelivered={activeProject.status === 'DELIVERED'}
          onConfirm={handleConfirmReassign}
        />
      )}
    </>
  )
})

export default OrderFinanceBlock

function Label({ children }: { children: React.ReactNode }) {
  return <label className={LABEL}>{children}</label>
}

// Черновик = ровно то, что уходит на сервер (UpdateOrderProfitInput) — не
// заводим параллельную структуру только ради localStorage (см. AGENTS.md,
// единый источник данных).
type FinanceDraft = UpdateOrderProfitInput

interface FinanceEditorHandle {
  flushToOrder: (orderId: string) => Promise<void>
}

interface FinanceEditorProps {
  orderId: string | null
  initialFinance: FinanceData
}

// "Прибыль по заказу" + "Комментарий к прибыли" — отдельный компонент. НЕ
// монтируется заново при появлении orderId (раньше был key={orderId ?? 'new'},
// убран 2026-07-27) — специально для того, чтобы можно было заполнять оба
// поля СРАЗУ, ещё до первого "Сохранить" карточки, когда заказа физически ещё
// не существует (реальный запрос пользователя: "хочу заполнять их сразу при
// первом заполнении карточки"). initialFinance используется только как
// значение useState ПРИ МОНТИРОВАНИИ — React не применяет его повторно при
// последующих изменениях пропа, поэтому once admin has typed something, а
// orderId ещё null, локальный ввод не перезатирается, когда родитель
// перезагружает finance после появления заказа.
//
// Само по себе появление orderId НЕ гарантирует, что штатный debounce
// автосейва (2с, см. use-autosave.ts) успеет сработать — EventCardModal и
// OrderFormModal закрывают карточку сразу после успешного handleSave, раньше
// таймера. Поэтому родитель явно вызывает flushToOrder(newOrderId) через
// forwardRef/useImperativeHandle сразу после того, как заказ появился в
// рамках ЭТОГО ЖЕ сохранения — это единственный надёжный момент "отправить
// то, что уже напечатано, пока не поздно".
//
// 2026-07-27: поле ПОЛНОСТЬЮ ручное — никакого авто-расчёта, никакого
// "указать вручную"/"рассчитать автоматически". Платформа никогда не
// подставляет сюда выручку и не пересчитывает значение при изменении
// выручки/способа оплаты/типа события — просто обычный редактируемый
// number-input поверх Order.netProfitManualAmount. null ("Не указана") и 0
// ("0 ₽") — два разных, различимых состояния.
const FinanceEditor = forwardRef<FinanceEditorHandle, FinanceEditorProps>(function FinanceEditor({ orderId, initialFinance }, ref) {
  const [profitInput, setProfitInput] = useState(
    initialFinance.profitAmount != null ? String(initialFinance.profitAmount) : '',
  )
  const [financeComment, setFinanceComment] = useState(initialFinance.financeComment ?? '')
  const [updatedByName, setUpdatedByName] = useState(initialFinance.profitUpdatedByName)
  const [updatedAt, setUpdatedAt] = useState(initialFinance.profitUpdatedAt)

  const profitAmount = profitInput.trim() ? parseFloat(profitInput) : null

  function buildFinanceInput(): FinanceDraft {
    return { profitAmount, financeComment: financeComment.trim() || null }
  }

  const storageKey = orderId ? `studio-lk:autosave:order-finance:${orderId}` : null
  const autosave = useAutosave({
    value: buildFinanceInput(),
    onSave: async input => {
      if (!orderId) return { ok: true }
      const result = await updateOrderProfit(orderId, input)
      if (result.ok) {
        setUpdatedByName(result.data.profitUpdatedByName)
        setUpdatedAt(result.data.profitUpdatedAt)
      }
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
    enabled: !!orderId,
    storageKey,
  })

  useImperativeHandle(ref, () => ({
    async flushToOrder(newOrderId: string) {
      const input = buildFinanceInput()
      // Нечего слать — не создаём пустую запись/лишний запрос ради null→null.
      if (input.profitAmount == null && !input.financeComment) return
      const result = await updateOrderProfit(newOrderId, input)
      if (result.ok) {
        setUpdatedByName(result.data.profitUpdatedByName)
        setUpdatedAt(result.data.profitUpdatedAt)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [profitInput, financeComment])

  const [draftBanner, setDraftBanner] = useState<StoredDraft<FinanceDraft> | null>(null)

  // setState отложен через setTimeout(…, 0) — react-hooks/set-state-in-effect
  // (см. память проекта).
  useEffect(() => {
    if (!storageKey) return
    const timer = setTimeout(() => {
      const draft = readAutosaveDraft<FinanceDraft>(storageKey)
      if (draft) setDraftBanner(draft)
    }, 0)
    return () => clearTimeout(timer)
  }, [storageKey])

  function applyDraft(input: FinanceDraft) {
    setProfitInput(input.profitAmount != null ? String(input.profitAmount) : '')
    setFinanceComment(input.financeComment ?? '')
  }

  return (
    <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg p-3 space-y-3">
      {draftBanner && storageKey && (
        <div className="flex items-center justify-between gap-3 bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2 text-xs">
          <span className="text-amber-300">Есть несохранённый черновик по финансам заказа.</span>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button type="button" onClick={() => { applyDraft(draftBanner.value); setDraftBanner(null) }}
              className="text-amber-300 underline hover:text-amber-200">Восстановить</button>
            <button type="button" onClick={() => { clearAutosaveDraft(storageKey); setDraftBanner(null) }}
              className="text-zinc-400 underline hover:text-zinc-300">Отклонить</button>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label>Прибыль по заказу, ₽</Label>
          <SaveStatusIndicator status={autosave.status} error={autosave.error} />
        </div>
        <input
          className={`${FIELD_BASE} px-3 placeholder-zinc-600 font-medium ${profitColorClass(profitAmount)}`}
          type="number"
          placeholder="Не указана"
          value={profitInput}
          onChange={e => setProfitInput(e.target.value)}
        />
        {!orderId ? (
          <p className="text-zinc-500 text-[11px] mt-1">Сохранится вместе с первым сохранением карточки.</p>
        ) : updatedByName && updatedAt ? (
          <p className="text-zinc-500 text-[11px] mt-1">
            Изменил: {updatedByName}, {new Date(updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        ) : null}
      </div>

      <div>
        <Label>Комментарий к прибыли</Label>
        <textarea
          className={`${TEXTAREA} mt-1.5`}
          rows={3}
          placeholder="Укажите расходы, выплаты или распределение денег по заказу"
          value={financeComment}
          onChange={e => setFinanceComment(e.target.value)}
        />
        {/* Шаблоны дополняют комментарий, а не заменяют его (см.
            appendFinanceCommentTemplate) — тот же "Быстрые пометки"-приём, что
            у акции под комментарием заказа, но здесь клик реально пишет текст
            в поле, а не переключает структурированный флаг. */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className="text-zinc-500 text-[11px]">Быстрые шаблоны:</span>
          {FINANCE_COMMENT_TEMPLATES.map(tpl => {
            const active = financeComment.includes(tpl.text)
            return (
              <GlowPill
                key={tpl.id}
                as="button"
                size="sm"
                color={active ? 'green' : 'zinc'}
                onClick={() => setFinanceComment(prev => appendFinanceCommentTemplate(prev, tpl.text))}
                title={active ? `«${tpl.label}» уже в комментарии` : `Добавить «${tpl.label}» в комментарий`}
                ariaLabel={active ? `«${tpl.label}» уже добавлено в комментарий к прибыли` : `Добавить «${tpl.label}» в комментарий к прибыли`}
                ariaPressed={active}
              >
                {tpl.label}
              </GlowPill>
            )
          })}
        </div>
      </div>
    </div>
  )
})
