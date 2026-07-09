// Компактная жёлтая пометка "N" — Яндекс.Диск есть, NAS-бэкапа нет. Только
// для тесных мест (месячная сетка), где не помещается полноразмерный
// MaterialsStatusBadge с текстовой меткой — см. schedule-model.ts:
// getMaterialsDisplay/getBookingAttentionInfo, случай hasYandex && !hasNas.
export default function NasMissingBadge() {
  return (
    <span
      title="Нет бэкапа на NAS"
      className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/60 text-amber-300 text-[8px] font-bold leading-none flex items-center justify-center flex-shrink-0"
    >
      N
    </span>
  )
}
