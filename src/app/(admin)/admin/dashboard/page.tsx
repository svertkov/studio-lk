import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Clock, Mic2, TrendingUp } from 'lucide-react'

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/staff-login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()

  const now = new Date()
  const monthStart = startOfMonth(now).toISOString()
  const monthEnd = endOfMonth(now).toISOString()

  const [
    { count: totalClients },
    { data: monthSessions },
    { data: todaySessions },
    { data: pendingOffers },
  ] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('sessions')
      .select('duration_minutes')
      .gte('started_at', monthStart)
      .lte('started_at', monthEnd)
      .eq('status', 'COMPLETED'),
    supabase.from('sessions')
      .select('*, clients(profiles(full_name))')
      .gte('started_at', new Date().toISOString().slice(0, 10) + 'T00:00:00')
      .lte('started_at', new Date().toISOString().slice(0, 10) + 'T23:59:59')
      .order('started_at'),
    supabase.from('offers')
      .select('*, clients(profiles(full_name))')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const totalMonthMinutes = (monthSessions || []).reduce(
    (sum, s) => sum + (s.duration_minutes || 0), 0
  )
  const totalMonthHours = (totalMonthMinutes / 60).toFixed(1)

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {format(now, 'd MMMM yyyy', { locale: ru })}
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Обзор студии</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-400 text-xs uppercase tracking-wider">Клиентов</p>
                <p className="text-3xl font-bold text-white mt-2">{totalClients ?? 0}</p>
              </div>
              <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-zinc-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-400 text-xs uppercase tracking-wider">Часов за месяц</p>
                <p className="text-3xl font-bold text-white mt-2">{totalMonthHours}</p>
                <p className="text-zinc-500 text-xs mt-1">{monthSessions?.length ?? 0} сессий</p>
              </div>
              <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-zinc-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-400 text-xs uppercase tracking-wider">Сегодня</p>
                <p className="text-3xl font-bold text-white mt-2">{todaySessions?.length ?? 0}</p>
                <p className="text-zinc-500 text-xs mt-1">сессий запланировано</p>
              </div>
              <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                <Mic2 className="w-5 h-5 text-zinc-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-400 text-xs uppercase tracking-wider">Офферов</p>
                <p className="text-3xl font-bold text-white mt-2">{pendingOffers?.length ?? 0}</p>
                <p className="text-zinc-500 text-xs mt-1">ожидают ответа</p>
              </div>
              <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-zinc-300" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's sessions */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Сессии сегодня</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {todaySessions && todaySessions.length > 0 ? (
              todaySessions.map(session => (
                <div key={session.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                  <div>
                    <p className="text-white text-sm font-medium">{session.title}</p>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      {format(new Date(session.started_at), 'HH:mm')}
                      {session.ended_at && ` – ${format(new Date(session.ended_at), 'HH:mm')}`}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      session.status === 'IN_PROGRESS' ? 'border-green-700 text-green-400' :
                      session.status === 'COMPLETED' ? 'border-zinc-600 text-zinc-400' :
                      'border-blue-700 text-blue-400'
                    }
                  >
                    {session.status === 'IN_PROGRESS' ? 'Идёт' :
                     session.status === 'COMPLETED' ? 'Готово' : 'Запланирована'}
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-zinc-500 text-sm text-center py-6">Сессий на сегодня нет</p>
            )}
          </CardContent>
        </Card>

        {/* Pending offers */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Офферы без ответа</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingOffers && pendingOffers.length > 0 ? (
              pendingOffers.map(offer => (
                <div key={offer.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                  <div>
                    <p className="text-white text-sm font-medium">{offer.title}</p>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      {format(new Date(offer.created_at), 'd MMM', { locale: ru })}
                    </p>
                  </div>
                  {offer.price && (
                    <span className="text-amber-400 text-sm font-medium">
                      {Number(offer.price).toLocaleString('ru-RU')} ₽
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-zinc-500 text-sm text-center py-6">Все офферы обработаны</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
