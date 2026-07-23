'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

function formatMoney(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentEditorName: string
  newEditorName: string
  currentPayout: number | null
  isProjectDelivered: boolean
  onConfirm: () => void
}

// Подтверждение смены УЖЕ назначенного монтажёра (ТЗ п.9) — показывается
// только когда назначение меняется, не при первом выборе на пустом проекте
// (см. вызывающую сторону, OrderFinanceBlock). Сама мутация — уже
// существующий assignMontageEditor (montage.ts), этот диалог только решает,
// показывать ли предупреждение перед вызовом.
export default function EditorReassignDialog({
  open, onOpenChange, currentEditorName, newEditorName, currentPayout, isProjectDelivered, onConfirm,
}: Props) {
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    setSaving(true)
    await onConfirm()
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Изменить ответственного монтажёра?</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 text-sm">
          <p className="text-zinc-400">
            Текущий: <span className="text-zinc-200">{currentEditorName}</span>
          </p>
          <p className="text-zinc-400">
            Новый: <span className="text-[#00c26b]">{newEditorName}</span>
          </p>
          <p className="text-zinc-400">
            Текущая выплата за монтаж: <span className="text-zinc-200">{formatMoney(currentPayout)}</span>
          </p>
        </div>
        {isProjectDelivered && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-amber-950/40 border border-amber-900 text-amber-300">
            Проект уже сдан клиенту. Смена ответственного монтажёра задним числом повлияет на его статистику и заработок —
            убедитесь, что это осознанное исправление, а не ошибка.
          </div>
        )}
        <p className="text-zinc-500 text-xs">
          Проект монтажа обновится, новый заказ появится в списке нового монтажёра, изменение будет записано в журнал действий.
        </p>
        <DialogFooter className="bg-zinc-900 border-zinc-800">
          <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Отмена
          </button>
          <button type="button" onClick={handleConfirm} disabled={saving}
            className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {saving ? 'Сохранение...' : 'Подтвердить'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
