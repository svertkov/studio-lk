'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { pauseMontageProject, cancelMontageProject, archiveMontageProject, type MontageProjectDTO } from '@/lib/actions/montage'

type Choice = 'keep' | 'pause' | 'cancel' | 'archive'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Обычно ровно один непогашенный проект (см. ensureMontageProjectForOrder,
  // идемпотентное автосоздание) — работаем с первым, остальные (если вдруг
  // появятся) в этой версии не показываем отдельно.
  project: MontageProjectDTO
  // Вызывается ПОСЛЕ того, как выбранное действие (если оно требовало
  // серверного вызова) успешно завершилось — родитель применяет
  // editingRequired: false только после этого, никогда до.
  onResolve: () => void
}

// Отключение "Монтаж требуется" после того, как проект монтажа уже создан —
// раньше ничего не происходило (проект просто зависал без предупреждения).
// Переиспользует уже существующие pause/cancel/archiveMontageProject
// (src/lib/actions/montage.ts) — новых мутаций не создаём.
export default function MontageDisableChoiceDialog({ open, onOpenChange, project, onResolve }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setChoice(null)
    setReason('')
  }

  async function handleConfirm() {
    if (choice === 'keep' || choice === null) {
      reset()
      onOpenChange(false)
      onResolve()
      return
    }
    setSaving(true)
    const result = choice === 'pause'
      ? await pauseMontageProject(project.id, reason)
      : choice === 'cancel'
        ? await cancelMontageProject(project.id, reason)
        : await archiveMontageProject(project.id)
    setSaving(false)
    if (!result.ok) return
    reset()
    onOpenChange(false)
    onResolve()
  }

  const needsReason = choice === 'pause' || choice === 'cancel'

  return (
    <Dialog open={open} onOpenChange={next => { onOpenChange(next); if (!next) reset() }}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-lg font-semibold">Заказ уже связан с проектом монтажа</DialogTitle>
        </DialogHeader>
        <p className="text-zinc-400 text-sm">
          Отметить «Монтаж не требуется» — что сделать с уже существующим проектом монтажа?
        </p>
        <div className="space-y-2">
          <ChoiceRow label="Оставить проект как есть" active={choice === 'keep'} onClick={() => setChoice('keep')} />
          <ChoiceRow label="Поставить на паузу" active={choice === 'pause'} onClick={() => setChoice('pause')} />
          <ChoiceRow label="Отменить проект" active={choice === 'cancel'} onClick={() => setChoice('cancel')} />
          {project.status === 'DELIVERED' && (
            <ChoiceRow label="Архивировать проект" active={choice === 'archive'} onClick={() => setChoice('archive')} />
          )}
        </div>
        {needsReason && (
          <div className="space-y-1.5">
            <label className="text-zinc-500 text-xs">Причина (необязательно)</label>
            <textarea
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-zinc-500 transition-colors resize-none"
              rows={2} value={reason} onChange={e => setReason(e.target.value)}
            />
          </div>
        )}
        <DialogFooter className="bg-zinc-900 border-zinc-800">
          <button type="button" onClick={() => { onOpenChange(false); reset() }} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            Отмена (не отключать монтаж)
          </button>
          <button type="button" onClick={handleConfirm} disabled={choice === null || saving}
            className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {saving ? 'Сохранение...' : 'Продолжить'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChoiceRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
        active ? 'border-[#00c26b] bg-[#00c26b]/10 text-zinc-100' : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  )
}
