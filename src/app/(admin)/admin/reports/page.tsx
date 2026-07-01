import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Clock } from 'lucide-react'

export default async function ReportsIndexPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Отчёты</h1>
        <p className="text-zinc-400 text-sm mt-1">Подробная статистика студии</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/admin/reports/hours">
          <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
                <Clock className="w-6 h-6 text-zinc-300" />
              </div>
              <div>
                <p className="text-white font-medium">Часы записи</p>
                <p className="text-zinc-400 text-sm mt-0.5">Все мероприятия за месяц с разбивкой по типам</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
