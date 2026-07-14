'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
}

// Переключатель "Ссылка не требуется" для полей Яндекс.Диск/NAS — общий для
// EventCardModal.tsx и OrderFormModal.tsx (оба пишут в один и тот же
// ScheduleEvent.yandexLinkRequired/nasLinkRequired, см. AGENTS.md — не
// дублировать логику подтверждения в двух модалках). Подтверждение требуется
// только при ВКЛЮЧЕНИИ (false → true); выключение возвращает карточку в
// обычный режим проверки без вопросов.
export default function RequiredLinkToggle({ checked, onChange, label = 'Ссылка не требуется' }: Props) {
  const [confirming, setConfirming] = useState(false)

  function handleToggle(next: boolean) {
    if (next) {
      setConfirming(true)
      return
    }
    onChange(false)
  }

  return (
    <>
      <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => handleToggle(e.target.checked)}
          className="accent-[#00c26b]"
        />
        {label}
      </label>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-lg font-semibold">Ссылка не требуется?</DialogTitle>
          </DialogHeader>
          <p className="text-zinc-400 text-sm">
            Вы собираетесь сохранить заказ без ссылки на материалы. Убедитесь, что данная ссылка действительно не требуется.
            После подтверждения система перестанет считать отсутствие этой ссылки ошибкой.
          </p>
          <DialogFooter className="bg-zinc-900 border-zinc-800">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => { setConfirming(false); onChange(true) }}
              className="bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Подтвердить
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
