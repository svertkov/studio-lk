'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Props {
  open: boolean
  // Подтвердили — родитель применяет editingRequired: false. Сам черновик
  // ничего не удаляет: EmbeddedMontageSection размонтируется вместе с
  // условным рендером блока "Монтаж" в EventCardModal.tsx/OrderFormModal.tsx,
  // и вместе с ним пропадает вся локальная форма — второго способа "очистить"
  // черновик не требуется.
  onConfirm: () => void
  onCancel: () => void
}

// Случай 1 из ТЗ: пользователь заполнил данные монтажа, но заказ ещё ни разу
// не сохранён (проекта на сервере ещё нет) — выключение "Монтаж требуется"
// не должно молча стирать введённое без предупреждения. Для уже
// существующего проекта — другой, более серьёзный диалог (см.
// MontageDisableChoiceDialog.tsx, тот случай не про потерю черновика, а про
// судьбу реальной записи).
export default function MontageDraftDiscardDialog({ open, onConfirm, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onCancel() }}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Очистить данные монтажа?</DialogTitle>
        </DialogHeader>
        <p className="text-zinc-400 text-sm">
          Вы заполнили данные монтажа, но заказ ещё не сохранён. Если отметить «Монтаж не требуется» — введённые данные будут очищены, проект монтажа создан не будет.
        </p>
        <DialogFooter className="bg-zinc-900 border-zinc-800">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Отмена — оставить «Монтаж требуется»
          </button>
          <button type="button" onClick={onConfirm} className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            Очистить и отключить монтаж
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
