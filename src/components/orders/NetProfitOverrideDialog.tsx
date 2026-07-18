'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

function formatMoney(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  autoAmount: number | null
  initialManualAmount: number | null
  initialReason: string | null
  onConfirm: (manualAmount: number, reason: string | null) => void
}

// Числовой аналог ConfirmableStatusToggle для одного конкретного случая —
// прибыль заказа считается на лету (computeOrderNetProfit), но администратор
// может подтвердить другое значение, если знает о расходах, не структурированных
// в системе (см. Order.netProfitMode). Не переиспользует ConfirmableStatusToggle
// буквально — тот рассчитан на булево да/нет с двумя фиксированными подписями,
// здесь нужен числовой ввод, поэтому отдельный маленький компонент в том же
// визуальном стиле (Dialog, тот же паттерн кнопок).
export default function NetProfitOverrideDialog({ open, onOpenChange, autoAmount, initialManualAmount, initialReason, onConfirm }: Props) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  // setState отложен через setTimeout(…, 0) — react-hooks/set-state-in-effect
  // не разрешает синхронный setState в теле эффекта (см. память проекта).
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      setAmount(initialManualAmount != null ? String(initialManualAmount) : (autoAmount != null ? String(autoAmount) : ''))
      setReason(initialReason ?? '')
    }, 0)
    return () => clearTimeout(timer)
  }, [open, initialManualAmount, initialReason, autoAmount])

  function handleConfirm() {
    const parsed = parseFloat(amount)
    if (!Number.isFinite(parsed)) return
    onConfirm(parsed, reason.trim() || null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Указать чистую прибыль вручную?</DialogTitle>
        </DialogHeader>
        <p className="text-zinc-400 text-sm">
          Автоматический расчёт: {formatMoney(autoAmount)}. Укажите другое значение, если известны расходы,
          не учтённые в системе (налоги, аренда техники, выездные расходы, скидки, комиссии и т.п.).
        </p>
        <div className="space-y-1.5">
          <label className="text-zinc-500 text-xs">Чистая прибыль, ₽</label>
          <input
            className="w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm px-3 text-zinc-100 outline-none focus:border-[#00c26b] transition-colors"
            type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="напр. 15000"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-zinc-500 text-xs">Причина (необязательно)</label>
          <textarea
            className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-zinc-500 transition-colors resize-none"
            rows={2} placeholder="Например: учтены расходы на выездную технику" value={reason} onChange={e => setReason(e.target.value)}
          />
        </div>
        <DialogFooter className="bg-zinc-900 border-zinc-800">
          <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Отмена
          </button>
          <button type="button" onClick={handleConfirm} className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Подтвердить
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
