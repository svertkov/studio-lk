import GlowPill from '@/components/ui/glow-pill'
import type { AutosaveStatus } from '@/lib/hooks/use-autosave'

interface Props {
  status: AutosaveStatus
  error: string | null
}

// Компактный индикатор автосохранения в нижней панели карточки — переиспользует
// GlowPill, без новой визуальной системы (см. AGENTS.md). idle — ничего не
// показываем, чтобы не загромождать панель, когда сохранять нечего.
export default function SaveStatusIndicator({ status, error }: Props) {
  if (status === 'idle') return null
  if (status === 'pending') return <GlowPill color="zinc" size="sm">Есть несохранённые изменения</GlowPill>
  if (status === 'saving') return <GlowPill color="blue" size="sm">Сохранение…</GlowPill>
  if (status === 'saved') return <GlowPill color="green" size="sm">Черновик сохранён</GlowPill>
  return <GlowPill color="red" size="sm" title={error ?? undefined}>Не удалось сохранить</GlowPill>
}
