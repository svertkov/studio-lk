'use client'

interface DonutSegment {
  label: string
  value: number
  color: string
}

interface Props {
  data: DonutSegment[]
  emptyLabel?: string
}

const SIZE = 140
const STROKE = 18
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function DonutChart({ data, emptyLabel = 'Нет данных' }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0)

  if (total <= 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-4">
        <div className="w-[140px] h-[140px] rounded-full border-[18px] border-zinc-800 flex-shrink-0" />
        <p className="text-zinc-500 text-xs">{emptyLabel}</p>
      </div>
    )
  }

  const segments = data.map((d, i) => {
    const dash = (d.value / total) * CIRCUMFERENCE
    const offset = data.slice(0, i).reduce((sum, p) => sum + (p.value / total) * CIRCUMFERENCE, 0)
    return { ...d, dash, offset }
  })

  return (
    <div className="flex items-center gap-5 flex-wrap sm:flex-nowrap">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="flex-shrink-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#27272a" strokeWidth={STROKE} />
        {segments.map((s, i) => (
          <circle key={i} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={s.color} strokeWidth={STROKE}
            strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`} strokeDashoffset={-s.offset} />
        ))}
      </svg>
      <div className="space-y-1.5 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-zinc-300 truncate">{d.label}</span>
            <span className="text-zinc-500 flex-shrink-0">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
