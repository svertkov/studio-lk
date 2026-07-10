import { getCurrentStudioYearMonth } from '@/lib/booking-analytics'
import HoursReportBody from './HoursReportBody'

export default function HoursReportPage() {
  const now = new Date()
  const { year, month } = getCurrentStudioYearMonth(now)

  return <HoursReportBody initialYear={year} initialMonth={month} nowIso={now.toISOString()} />
}
