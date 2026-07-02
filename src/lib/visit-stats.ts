// Аналитика по визитам клиента — считается на лету из истории визитов, ничего не хранится агрегатом

export interface VisitLike {
  date: Date | null
  room: string | null
  format: string | null
  durationHours: number | null
  grossAmount: number | null
  netAmount: number | null
}

export interface RoomFormatBreakdown {
  label: string
  visits: number
  hours: number
  percent: number
}

export interface VisitStats {
  totalVisits: number
  totalHours: number
  grossTotal: number | null
  netTotal: number | null
  avgCheck: number | null
  avgDurationHours: number | null
  firstVisit: Date | null
  lastVisit: Date | null
  byRoom: RoomFormatBreakdown[]
  byFormat: RoomFormatBreakdown[]
}

function breakdown(visits: VisitLike[], key: 'room' | 'format'): RoomFormatBreakdown[] {
  const groups = new Map<string, { visits: number; hours: number }>()
  let totalHours = 0

  for (const v of visits) {
    const label = v[key]
    if (!label) continue
    const hours = v.durationHours ?? 0
    totalHours += hours
    const g = groups.get(label) ?? { visits: 0, hours: 0 }
    g.visits += 1
    g.hours += hours
    groups.set(label, g)
  }

  const totalGrouped = Array.from(groups.values()).reduce((s, g) => s + g.visits, 0)
  const useHours = totalHours > 0
  if (totalGrouped === 0) return []

  return Array.from(groups.entries())
    .map(([label, g]) => ({
      label, visits: g.visits, hours: g.hours,
      percent: useHours ? (g.hours / totalHours) * 100 : (g.visits / totalGrouped) * 100,
    }))
    .sort((a, b) => b.percent - a.percent)
}

export function computeVisitStats(visits: VisitLike[]): VisitStats {
  const totalVisits = visits.length
  const totalHours = visits.reduce((s, v) => s + (v.durationHours ?? 0), 0)

  const grossValues = visits.map(v => v.grossAmount).filter((v): v is number => v != null)
  const netValues = visits.map(v => v.netAmount).filter((v): v is number => v != null)
  const durationValues = visits.map(v => v.durationHours).filter((v): v is number => v != null)
  const dates = visits.map(v => v.date).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime())

  const grossTotal = grossValues.length > 0 ? grossValues.reduce((s, v) => s + v, 0) : null
  const netTotal = netValues.length > 0 ? netValues.reduce((s, v) => s + v, 0) : null
  const avgCheck = grossTotal != null
    ? grossTotal / grossValues.length
    : netTotal != null ? netTotal / netValues.length : null
  const avgDurationHours = durationValues.length > 0
    ? durationValues.reduce((s, v) => s + v, 0) / durationValues.length
    : null

  return {
    totalVisits,
    totalHours,
    grossTotal,
    netTotal,
    avgCheck,
    avgDurationHours,
    firstVisit: dates[0] ?? null,
    lastVisit: dates[dates.length - 1] ?? null,
    byRoom: breakdown(visits, 'room'),
    byFormat: breakdown(visits, 'format'),
  }
}
