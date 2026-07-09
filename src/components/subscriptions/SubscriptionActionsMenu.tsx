'use client'

import { useState } from 'react'
import { ChevronDown, CheckCircle2, XCircle, RotateCcw, Archive, ArchiveRestore, Undo2, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { canReactivate, type SubscriptionStatus } from '@/lib/subscription-model'
import SubscriptionActionModal, { type SubscriptionActionKind } from './SubscriptionActionModal'

// Минимальная форма абонемента, нужная только для выбора набора доступных
// действий — и ClientSubscriptionDTO (actions/subscriptions.ts), и
// SubscriptionRow (actions/finance.ts) ей структурно соответствуют, отдельный
// адаптер не нужен.
export interface SubscriptionActionTarget {
  id: string
  status: SubscriptionStatus
  isArchived: boolean
}

interface ActionDef {
  key: SubscriptionActionKind
  label: string
  description: string
  icon: LucideIcon
}

// Набор действий строго по матрице из ТЗ (Задача 5): архивный — только
// "вернуть из архива"; активный — все четыре; used/cancelled — архив +
// "вернуть в активные" (безопасно — см. canReactivate); refunded — только архив.
// "Открыть"/"посмотреть детали" сюда намеренно не входит — оно уже есть на
// каждой из поверхностей отдельной кнопкой (открыть карточку/строку в
// таблице), дублировать его в этом меню было бы избыточно.
function getAvailableActions(sub: SubscriptionActionTarget): ActionDef[] {
  if (sub.isArchived) {
    return [{
      key: 'unarchive', label: 'Вернуть из архива', icon: ArchiveRestore,
      description: 'Снова показывать в списках',
    }]
  }

  const actions: ActionDef[] = []
  if (sub.status === 'ACTIVE') {
    actions.push(
      { key: 'markUsed', label: 'Отметить использованным', icon: CheckCircle2, description: 'Остаток часов станет 0' },
      { key: 'cancel', label: 'Аннулировать', icon: XCircle, description: 'Оставшиеся часы станут недоступны' },
      { key: 'refund', label: 'Оформить возврат', icon: RotateCcw, description: 'Зафиксировать возврат клиенту' },
    )
  }
  if (canReactivate(sub.status)) {
    actions.push({ key: 'reactivate', label: 'Вернуть в активные', icon: Undo2, description: 'Часы снова доступны для списания' })
  }
  actions.push({ key: 'archive', label: 'Отправить в архив', icon: Archive, description: 'Скрыть из активных списков' })
  return actions
}

interface Props {
  subscription: SubscriptionActionTarget
  onChanged: () => void
  className?: string
  // full — «Изменить статус ▼» (модалка абонемента, карточка клиента);
  // compact — «Статус ▼» (тесные строки таблиц/списков — Финансы, выбор
  // абонемента в заказе). Оба варианта — настоящая подписанная кнопка, не
  // голая иконка (см. ТЗ: "кнопка не должна выглядеть как второстепенная").
  variant?: 'full' | 'compact'
}

export default function SubscriptionActionsMenu({ subscription, onChanged, className, variant = 'full' }: Props) {
  const [modal, setModal] = useState<SubscriptionActionKind | null>(null)
  const actions = getAvailableActions(subscription)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={e => e.stopPropagation()}
          className={`inline-flex items-center gap-1.5 flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 font-medium hover:bg-zinc-700 hover:border-zinc-600 transition-colors outline-none ${
            variant === 'compact' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3.5 py-2'
          } ${className ?? ''}`}
        >
          {variant === 'compact' ? 'Статус' : 'Изменить статус'}
          <ChevronDown className={variant === 'compact' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className="bg-zinc-900 border border-zinc-700 shadow-xl shadow-black/40 w-72 p-1.5"
        >
          {actions.map(a => (
            <DropdownMenuItem
              key={a.key}
              onClick={() => setModal(a.key)}
              className="flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 focus:bg-zinc-800 data-[variant=destructive]:focus:bg-zinc-800"
            >
              <span className="flex items-center gap-2 text-zinc-100 text-sm font-medium">
                <a.icon className="w-4 h-4 flex-shrink-0 text-zinc-400" />
                {a.label}
              </span>
              <span className="text-zinc-500 text-xs pl-6">{a.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {modal && (
        <SubscriptionActionModal
          subscriptionId={subscription.id}
          action={modal}
          onOpenChange={next => { if (!next) setModal(null) }}
          onDone={() => { setModal(null); onChanged() }}
        />
      )}
    </>
  )
}
