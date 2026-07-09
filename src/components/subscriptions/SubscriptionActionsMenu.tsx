'use client'

import { useState } from 'react'
import { MoreHorizontal, CheckCircle2, XCircle, RotateCcw, Archive, ArchiveRestore, type LucideIcon } from 'lucide-react'
import type { SubscriptionStatus } from '@/lib/subscription-model'
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
  icon: LucideIcon
}

// Набор действий строго по матрице из ТЗ (Задача 4): архивный — только
// "вернуть из архива"; активный — все четыре; use/cancel/refund — только "в архив".
// "Открыть" сюда намеренно не входит — оно уже есть на каждой из трёх
// поверхностей (клик по строке в Финансах, разворот карточки клиента, сама
// открытая карточка заказа), дублировать его в меню было бы избыточно.
function getAvailableActions(sub: SubscriptionActionTarget): ActionDef[] {
  if (sub.isArchived) {
    return [{ key: 'unarchive', label: 'Вернуть из архива', icon: ArchiveRestore }]
  }
  const actions: ActionDef[] = []
  if (sub.status === 'ACTIVE') {
    actions.push(
      { key: 'markUsed', label: 'Отметить использованным', icon: CheckCircle2 },
      { key: 'cancel', label: 'Аннулировать', icon: XCircle },
      { key: 'refund', label: 'Оформить возврат', icon: RotateCcw },
    )
  }
  actions.push({ key: 'archive', label: 'В архив', icon: Archive })
  return actions
}

interface Props {
  subscription: SubscriptionActionTarget
  onChanged: () => void
  className?: string
}

export default function SubscriptionActionsMenu({ subscription, onChanged, className }: Props) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<SubscriptionActionKind | null>(null)
  const actions = getAvailableActions(subscription)

  return (
    <div className={`relative inline-block ${className ?? ''}`}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className="flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
        title="Действия с абонементом"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <>
          {/* Клик вне меню закрывает его — простой fixed-оверлей вместо
              полноценного popover-примитива, чтобы не тащить фокус-ловушку
              base-ui в соседство с модалками действий (см. Dialog ниже). */}
          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setOpen(false) }} />
          <div
            onClick={e => e.stopPropagation()}
            className="absolute right-0 top-full mt-1 z-50 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 py-1"
          >
            {actions.map(a => (
              <button
                key={a.key}
                type="button"
                onClick={() => { setOpen(false); setModal(a.key) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors text-left"
              >
                <a.icon className="w-4 h-4 flex-shrink-0 text-zinc-400" />
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}

      {modal && (
        <SubscriptionActionModal
          subscriptionId={subscription.id}
          action={modal}
          onOpenChange={next => { if (!next) setModal(null) }}
          onDone={() => { setModal(null); onChanged() }}
        />
      )}
    </div>
  )
}
