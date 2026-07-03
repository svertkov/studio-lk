import { startOfMonth, endOfMonth } from 'date-fns'
import HoursReportBody from './HoursReportBody'

export default function HoursReportPage() {
  const now = new Date()
  const monthStart = startOfMonth(now).toISOString()
  const monthEnd = endOfMonth(now).toISOString()

  return <HoursReportBody monthStart={monthStart} monthEnd={monthEnd} nowIso={now.toISOString()} />
}
