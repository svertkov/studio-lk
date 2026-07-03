'use client'

// Простая столбчатая диаграмма план/факт по месяцам — без внешних зависимостей,
// в том же духе, что и donut-chart.tsx (только divs, без библиотек графиков).

export interface BarChartDatum {
  label: string
  planned: number
  actual: number
}

interface Props {
  data: BarChartDatum[]
  emptyLabel?: string
  formatValue?: (v: number) => string
}

const CHART_HEIGHT = 140

function defaultFormat(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}М`
  if (v >= 1_000) return `${Math.round(v / 1000)}к`
  return String(Math.round(v))
}

export default function BarChart({ data, emptyLabel = 'Нет данных', formatValue = defaultFormat }: Props) {
  const max = Math.max(1, ...data.flatMap(d => [d.planned, d.actual]))

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-zinc-500 text-xs">{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5 text-zinc-400"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-600 flex-shrink-0" />План</span>
        <span className="flex items-center gap-1.5 text-zinc-400"><span className="w-2.5 h-2.5 rounded-sm bg-[#00c26b] flex-shrink-0" />Факт</span>
      </div>
      <div className="flex items-end gap-3 overflow-x-auto pb-1" style={{ height: CHART_HEIGHT + 24 }}>
        {data.map(d => (
          <div key={d.label} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ width: 44 }}>
            <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }} title={`${d.label}: план ${formatValue(d.planned)}, факт ${formatValue(d.actual)}`}>
              <div
                className="w-3.5 rounded-t bg-zinc-600"
                style={{ height: `${Math.max(2, (d.planned / max) * CHART_HEIGHT)}px` }}
              />
              <div
                className="w-3.5 rounded-t bg-[#00c26b]"
                style={{ height: `${Math.max(2, (d.actual / max) * CHART_HEIGHT)}px` }}
              />
            </div>
            <span className="text-zinc-500 text-[10px] whitespace-nowrap">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
