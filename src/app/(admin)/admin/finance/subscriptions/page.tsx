import Link from 'next/link'
import { ArrowLeft, CreditCard } from 'lucide-react'
import { getSubscriptionsAnalytics } from '@/lib/actions/finance'
import SubscriptionsAnalyticsView from './SubscriptionsAnalyticsView'

interface Props {
  searchParams: Promise<{ filter?: string }>
}

export default async function SubscriptionsAnalyticsPage({ searchParams }: Props) {
  const { filter } = await searchParams
  const result = await getSubscriptionsAnalytics()

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link href="/admin/finance" className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Финансы
        </Link>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Аналитика абонементов</h1>
            <p className="text-zinc-400 text-sm mt-1">Кто купил, сколько осталось, кого нужно предупредить</p>
          </div>
          <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-6 h-6 text-zinc-300" />
          </div>
        </div>
      </div>

      <SubscriptionsAnalyticsView summary={result.data.summary} rows={result.data.rows} initialLowOnly={filter === 'low'} />
    </div>
  )
}
