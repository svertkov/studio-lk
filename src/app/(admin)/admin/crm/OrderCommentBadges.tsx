'use client'

import { MessageCircle } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import GlowPill from '@/components/ui/glow-pill'
import { getOrderPromotion, getVisibleOrderComment, PROMOTION_PILL_LABEL, PROMOTION_PILL_LABEL_SHORT } from '@/lib/promotion-model'
import type { OrderDTO } from '@/lib/actions/orders'

interface ButtonProps {
  order: OrderDTO
  // compact — иконка без подписи "Комментарий" (плотный режим таблицы
  // "Заказы" на 1366/1280px, см. isOrdersTableDense в order-model.ts).
  compact?: boolean
}

// Кнопка "Комментарий" + popover с полным очищенным текстом — единственная
// точка этой логики, переиспользуется и в таблице "Заказы" (через
// OrderCommentBadges ниже, рядом с плашкой акции), и в OrderCard (канбан CRM +
// мобильный список "Заказов"), где плашка акции уже показывается отдельно в
// своём ряду бейджей — там нужна только кнопка, без второй копии плашки.
// Возвращает null, если очищенного комментария нет (см. getVisibleOrderComment,
// src/lib/promotion-model.ts) — пустое состояние решает вызывающий код.
export function OrderCommentButton({ order, compact }: ButtonProps) {
  const visibleComment = getVisibleOrderComment(order)
  if (!visibleComment) return null

  return (
    <Popover>
      <PopoverTrigger
        title="Открыть комментарий"
        aria-label="Открыть комментарий к заказу"
        onClick={e => e.stopPropagation()}
        className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300 whitespace-nowrap transition-colors hover:bg-zinc-700/70 hover:text-white hover:border-zinc-600 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00c26b] focus-visible:-outline-offset-1"
      >
        <MessageCircle className="w-2.5 h-2.5 flex-shrink-0" />
        {!compact && 'Комментарий'}
      </PopoverTrigger>
      <PopoverContent className="max-w-[min(380px,calc(100vw-2rem))]" onClick={e => e.stopPropagation()}>
        <p className="text-zinc-200 text-sm leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto select-text">
          {visibleComment}
        </p>
      </PopoverContent>
    </Popover>
  )
}

interface Props {
  order: OrderDTO
  // dense — плотный режим таблицы "Заказы" (1366/1280px измеренная ширина
  // контейнера): короткий текст акции (PROMOTION_PILL_LABEL_SHORT — тот же
  // canonical источник, не придуман на месте) и кнопка комментария без
  // подписи. НЕ влияет на то, показывать ли акцию/комментарий — только на
  // то, каким текстом.
  dense?: boolean
}

// Плашка акции + кнопка комментария — для табличной ячейки "Комментарий"
// (OrdersListView.tsx), где раньше выводился длинный обрезанный текст.
// Полный текст акции больше нигде не дублируется рядом с плашкой (см.
// getOrderPromotion/getVisibleOrderComment) — плашка использует общий
// GlowPill, кнопка — общий Popover.
export default function OrderCommentBadges({ order, dense }: Props) {
  const promotion = getOrderPromotion(order)
  const visibleComment = getVisibleOrderComment(order)

  if (!promotion && !visibleComment) {
    return <span className="text-zinc-600 text-xs">—</span>
  }

  return (
    // stopPropagation на контейнере — строка таблицы кликабельна целиком и
    // открывает карточку заказа; ни плашка акции, ни кнопка комментария не
    // должны провоцировать это открытие (ТЗ п.16). flex-col, а не flex-wrap:
    // при акции И комментарии вместе они ВСЕГДА друг под другом (акция сверху,
    // кнопка снизу), а не иногда рядом/иногда друг под другом в зависимости
    // от случайно доступной ширины — раньше именно такое width-зависимое
    // поведение (flex-wrap) и было источником непредсказуемого overflow.
    <div className="flex flex-col items-start gap-1 min-w-0 max-w-full overflow-hidden" onClick={e => e.stopPropagation()}>
      {promotion && (
        <GlowPill color="green" size="sm" className="flex-shrink-0" title="Акция «−20% первый визит»">
          {dense ? PROMOTION_PILL_LABEL_SHORT[promotion] : PROMOTION_PILL_LABEL[promotion]}
        </GlowPill>
      )}
      <OrderCommentButton order={order} compact={dense} />
    </div>
  )
}
