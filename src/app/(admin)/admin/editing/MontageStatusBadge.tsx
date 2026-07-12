import { getMontageStatusConfig, type MontageStatus } from '@/lib/montage-model'

// Компактная плашка статуса проекта монтажа — единственное место, читающее
// MONTAGE_STATUS_CONFIG (montage-model.ts) для отображения, переиспользуется
// таблицей проектов, карточкой проекта и карточкой монтажёра.
export default function MontageStatusBadge({ status }: { status: MontageStatus }) {
  const config = getMontageStatusConfig(status)
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  )
}
