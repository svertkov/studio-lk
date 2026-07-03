import { UserX } from 'lucide-react'

interface Props {
  title: string
}

// Компактная оранжевая пометка отсутствия сотрудника — намеренно НЕ красная
// (красный зарезервирован для критических проблем по записям) и НЕ зелёная
// (это не успешный статус, просто нейтрально-предупреждающая информация).
export default function StaffAbsenceBadge({ title }: Props) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-600/50 bg-amber-950/30 shadow-[0_0_10px_rgba(245,158,11,0.18)] text-amber-300 text-xs font-medium">
      <UserX className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{title}</span>
    </div>
  )
}
