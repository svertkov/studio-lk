import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

interface CategoryDTO {
  name: string
  hours: number
  color: string
}

function buildConicGradient(items: { hours: number; color: string }[], total: number): string {
  if (total <= 0) return '#27272a'
  let acc = 0
  const stops = items.map(item => {
    const startDeg = (acc / total) * 360
    acc += item.hours
    const endDeg = (acc / total) * 360
    return `${item.color} ${startDeg}deg ${endDeg}deg`
  })
  return `conic-gradient(${stops.join(', ')})`
}

export default function HoursStatCard({
  categories,
  totalHours,
  recordsCount,
}: {
  categories: CategoryDTO[]
  totalHours: number
  recordsCount: number
}) {
  const conicGradient = buildConicGradient(categories, totalHours)
  const topCategories = categories.slice(0, 3)

  return (
    <Link href="/admin/reports/hours" className="block h-full">
      <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer h-full">
        <CardContent className="p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-zinc-400 text-sm uppercase tracking-wider">Часов за месяц</p>
              <p className="text-4xl font-bold text-white mt-3">{totalHours.toFixed(1)}</p>
              <p className="text-zinc-400 text-xs mt-1">{recordsCount} записей</p>
            </div>
            <div className="flex items-center gap-4">
              {topCategories.length > 0 && (
                <div className="space-y-1.5">
                  {topCategories.map(cat => (
                    <div key={cat.name} className="flex items-center gap-2 text-xs whitespace-nowrap">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                      <span className="text-zinc-300">{cat.name}</span>
                      <span className="text-zinc-500">{cat.hours.toFixed(1)} ч</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative w-20 h-20 flex-shrink-0">
                <div className="absolute inset-0 rounded-full" style={{ backgroundImage: conicGradient }} />
                <div className="absolute inset-[10px] rounded-full bg-zinc-900" />
              </div>
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-zinc-800 flex items-center justify-end">
            <span className="text-sm text-zinc-300 font-medium">Открыть полный отчёт →</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
