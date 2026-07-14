'use client'

import { useState, type ElementType } from 'react'
import { Link2, AlertTriangle } from 'lucide-react'
import GlowPill from '@/components/ui/glow-pill'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Props {
  // true — подтверждённое бизнес-исключение ("не требуется"), false — обычный
  // режим ("обязательно"). Общий переключатель для ЗНАЧИМЫХ бизнес-исключений
  // (не для фильтров списков — там ToggleChip, не для безопасных настроек
  // интерфейса — там обычный checkbox/switch), см. AGENTS.md.
  active: boolean
  onConfirm: (reason: string | null) => void | Promise<void>
  onDeactivate: () => void | Promise<void>
  normalLabel: string
  exceptionLabel: string
  dialogTitle: string
  dialogBody: string
  // Показывается дополнительным абзацем, только когда парное поле (напр. NAS
  // при переключении Яндекс.Диска) УЖЕ является исключением — тогда после
  // подтверждения у работы не останется ни одной обязательной ссылки.
  escalatedNotice?: string
  reasonPlaceholder?: string
  disabled?: boolean
  loading?: boolean
  normalIcon?: ElementType
  size?: 'sm' | 'md'
}

// Переиспользуемая капсула-переключатель для осознанных бизнес-исключений —
// обобщение прежнего RequiredLinkToggle (был жёстко привязан к ссылкам на
// материалы). Внешний вид — только готовые пресеты GlowPill (zinc/red), без
// новых цветов/теней (см. AGENTS.md, "не создавать локальные стили ради одного
// экрана"). Подтверждение диалогом — только на включении (false→true);
// выключение мгновенное, без диалога (возврат к более строгой проверке не
// несёт риска).
export default function ConfirmableStatusToggle({
  active, onConfirm, onDeactivate,
  normalLabel, exceptionLabel, dialogTitle, dialogBody, escalatedNotice,
  reasonPlaceholder = 'Например: материалы переданы на физическом носителе',
  disabled, loading, normalIcon: NormalIcon = Link2, size = 'md',
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')

  function handleClick() {
    if (disabled || loading) return
    if (active) {
      onDeactivate()
      return
    }
    setReason('')
    setConfirming(true)
  }

  function handleConfirm() {
    setConfirming(false)
    onConfirm(reason.trim() || null)
  }

  return (
    <>
      {active ? (
        <GlowPill
          as="button"
          color="red"
          icon={AlertTriangle}
          size={size}
          disabled={disabled || loading}
          onClick={handleClick}
          ariaLabel={`${exceptionLabel} — нажмите, чтобы снова сделать обязательной`}
          ariaPressed
          title="Нажмите, чтобы снова сделать обязательной"
        >
          {exceptionLabel}
        </GlowPill>
      ) : (
        <GlowPill
          as="button"
          color="zinc"
          icon={NormalIcon}
          size={size}
          disabled={disabled || loading}
          onClick={handleClick}
          ariaLabel={`${normalLabel} — нажмите, чтобы отметить как необязательную`}
          ariaPressed={false}
          title="Нажмите, чтобы отметить как необязательную"
        >
          {normalLabel}
        </GlowPill>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-lg font-semibold">{dialogTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-zinc-400 text-sm">{dialogBody}</p>
          {escalatedNotice && (
            <p className="text-amber-400/90 text-sm">{escalatedNotice}</p>
          )}
          <div className="space-y-1.5">
            <label className="text-zinc-500 text-xs">Причина или комментарий (необязательно)</label>
            <textarea
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-zinc-500 transition-colors resize-none"
              rows={2}
              placeholder={reasonPlaceholder}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
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
              onClick={handleConfirm}
              className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Подтвердить отсутствие ссылки
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
