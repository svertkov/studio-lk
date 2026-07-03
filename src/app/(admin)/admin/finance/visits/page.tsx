import Link from 'next/link'
import { ArrowLeft, Receipt } from 'lucide-react'
import { getAllVisits } from '@/lib/actions/finance'
import VisitsReportTable from './VisitsReportTable'

interface Props {
  searchParams: Promise<{ room?: string; format?: string }>
}

export default async function VisitsReportPage({ searchParams }: Props) {
  const { room, format: formatParam } = await searchParams
  const result = await getAllVisits()
  const visits = result.data

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link href="/admin/finance" className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Финансы
        </Link>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Подробный финансовый отчёт</h1>
            <p className="text-zinc-400 text-sm mt-1">
              Все визиты и выручка · {visits.length} записей всего
            </p>
          </div>
          <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
            <Receipt className="w-6 h-6 text-zinc-300" />
          </div>
        </div>
      </div>

      <VisitsReportTable visits={visits} initialRoom={room} initialFormat={formatParam} />
    </div>
  )
}
