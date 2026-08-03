'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import SaveStatusIndicator from '@/components/ui/save-status-indicator'
import GlowPill from '@/components/ui/glow-pill'
import { useAutosave, readAutosaveDraft, clearAutosaveDraft, type StoredDraft } from '@/lib/hooks/use-autosave'
import { getOrder, updateOrderProfit, type UpdateOrderProfitInput } from '@/lib/actions/orders'
import { FINANCE_COMMENT_TEMPLATES, appendFinanceCommentTemplate } from '@/lib/finance-comment-model'

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
}

// Финансовый блок заказа (выручка + прибыль + комментарий к прибыли) —
// используется и в OrderFormModal (CRM), и в EventCardModal (расписание/
// дашборд/карточка клиента), чтобы обе карточки одного заказа показывали
// одинаковую логику вместо двух разных независимых виджетов (см. AGENTS.md,
// единый источник данных). Прибыль/комментарий — самостоятельная overlay-
// мутация (тот же приём, что WorkDocumentsSection): сохраняется через
// собственный автосейв, не через общую кнопку "Сохранить" карточки — так
// EventCardModal, у которого нет полного OrderDTO под рукой (только
// annotation.orderId), может показывать и редактировать эти данные без
// изменений в своей общей форме/handleSave.
//
// 2026-08: редактирование монтажа (финансы монтажа, исполнитель, статус и
// т.д.) больше не живёт здесь — вынесено в единый встроенный редактор
// EmbeddedMontageSection.tsx (используется тем же MontageProjectFields.tsx,
// что и отдельная карточка монтажа), который EventCardModal.tsx/
// OrderFormModal.tsx рендерят отдельно, сразу под переключателем "Монтаж
// требуется/не требуется" (см. MONTAGE.md, «Встраивание в карточку заказа»).
// forwardRef — родитель дёргает flushToOrder() из своего handleSave в момент
// первого появления orderId (см. OrderFinanceBlockHandle выше).
const OrderFinanceBlock = forwardRef<OrderFinanceBlockHandle, Props>(function OrderFinanceBlock({
  orderId, revenueValue, onRevenueChange,
}, ref) {
  const [finance, setFinance] = useState<FinanceData | null>(null)
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
        setFinance({ profitAmount: null, financeComment: null, profitUpdatedByName: null, profitUpdatedAt: null })
      }, 0)
      return () => clearTimeout(timer)
    }

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
  }, [orderId])

  return (
    <div className="space-y-3">
      <div>
        <Label>Выручка по заказу, ₽</Label>
        <input className={`${INPUT} mt-1.5`} type="number" min="0" placeholder="напр. 15000" value={revenueValue}
          onChange={e => onRevenueChange(e.target.value)} />
      </div>

      {finance && (
        <FinanceEditor ref={financeEditorRef} orderId={orderId} initialFinance={finance} />
      )}
    </div>
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
