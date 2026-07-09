'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { updateSubscriptionStatus } from '@/lib/actions/subscriptions'

export type SubscriptionActionKind = 'markUsed' | 'cancel' | 'refund' | 'archive' | 'unarchive' | 'reactivate'

interface CopyEntry {
  title: string
  message: string
  confirmLabel: string
  confirmClass: string
}

const COPY: Record<SubscriptionActionKind, CopyEntry> = {
  markUsed: {
    title: 'Отметить использованным',
    message: 'Абонемент будет отмечен как полностью использованный. Остаток часов станет 0. Продолжить?',
    confirmLabel: 'Отметить использованным',
    confirmClass: 'bg-zinc-600 hover:bg-zinc-500',
  },
  cancel: {
    title: 'Аннулировать абонемент',
    message: 'Абонемент будет аннулирован. Оставшиеся часы станут недоступны.',
    confirmLabel: 'Аннулировать',
    confirmClass: 'bg-red-600 hover:bg-red-500',
  },
  refund: {
    title: 'Оформить возврат',
    message: 'Укажите сумму и причину возврата по абонементу.',
    confirmLabel: 'Оформить возврат',
    confirmClass: 'bg-purple-600 hover:bg-purple-500',
  },
  archive: {
    title: 'В архив',
    message: 'Абонемент будет скрыт из активных списков, но останется в истории клиента.',
    confirmLabel: 'В архив',
    confirmClass: 'bg-zinc-600 hover:bg-zinc-500',
  },
  unarchive: {
    title: 'Вернуть из архива',
    message: 'Абонемент снова будет отображаться в списках клиента и финансов.',
    confirmLabel: 'Вернуть',
    confirmClass: 'bg-indigo-600 hover:bg-indigo-500',
  },
  reactivate: {
    title: 'Вернуть в активные',
    message: 'Абонемент снова станет активным, а его часы — доступны для списания в заказах.',
    confirmLabel: 'Вернуть в активные',
    confirmClass: 'bg-green-600 hover:bg-green-500',
  },
}

interface Props {
  subscriptionId: string
  action: SubscriptionActionKind
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const TEXTAREA = `${INPUT} resize-none`
const LABEL = 'block text-zinc-400 text-xs mb-1.5'

// Одна модалка на все 5 действий жизненного цикла абонемента — переиспользуется
// из Финансов, карточки клиента и карточки заказа через SubscriptionActionsMenu,
// чтобы тексты подтверждений и поля не разъезжались по трём местам (см. ТЗ:
// единая логика обновления абонемента).
export default function SubscriptionActionModal({ subscriptionId, action, onOpenChange, onDone }: Props) {
  const copy = COPY[action]
  const [cancellationReason, setCancellationReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [adminComment, setAdminComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSaving(true)
    setError(null)

    const result = await updateSubscriptionStatus(subscriptionId,
      action === 'markUsed' ? { status: 'USED_UP', adminComment: adminComment.trim() || undefined }
      : action === 'cancel' ? { status: 'CANCELLED', cancellationReason, adminComment: adminComment.trim() || undefined }
      : action === 'refund' ? {
          status: 'REFUNDED',
          refundAmount: refundAmount ? parseFloat(refundAmount) : null,
          refundReason,
          adminComment: adminComment.trim() || undefined,
        }
      : action === 'archive' ? { isArchived: true }
      : action === 'unarchive' ? { isArchived: false }
      : { status: 'ACTIVE' },
    )

    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onDone()
  }

  const confirmDisabled = saving || (action === 'refund' && !refundAmount)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800">
          <DialogTitle className="text-white text-lg font-semibold">{copy.title}</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          <p className="text-zinc-400 text-sm">{copy.message}</p>

          {action === 'cancel' && (
            <div>
              <label className={LABEL}>Причина аннулирования</label>
              <textarea className={TEXTAREA} rows={2} value={cancellationReason}
                onChange={e => setCancellationReason(e.target.value)}
                placeholder="Например: клиент отказался от услуг" />
            </div>
          )}

          {action === 'refund' && (
            <>
              <div>
                <label className={LABEL}>Сумма возврата, ₽</label>
                <input className={INPUT} type="number" min="0" value={refundAmount}
                  onChange={e => setRefundAmount(e.target.value)} placeholder="напр. 15000" />
              </div>
              <div>
                <label className={LABEL}>Причина возврата</label>
                <textarea className={TEXTAREA} rows={2} value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  placeholder="Например: клиент попросил вернуть деньги за неиспользованные часы" />
              </div>
            </>
          )}

          {(action === 'markUsed' || action === 'cancel' || action === 'refund') && (
            <div>
              <label className={LABEL}>Комментарий администратора (необязательно)</label>
              <textarea className={TEXTAREA} rows={2} value={adminComment} onChange={e => setAdminComment(e.target.value)} />
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800">
          <button type="button" onClick={handleConfirm} disabled={confirmDisabled}
            className={`flex-1 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors ${copy.confirmClass}`}>
            {saving ? 'Сохранение...' : copy.confirmLabel}
          </button>
          <button type="button" onClick={() => onOpenChange(false)}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
            Отмена
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
