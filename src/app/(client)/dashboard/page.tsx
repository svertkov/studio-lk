import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Clock,
  FileAudio,
  Calendar,
  Star,
  TrendingUp,
  Mic2,
} from 'lucide-react'

const LOYALTY_TIERS = {
  BRONZE: { label: 'Бронза', next: 'SILVER', nextPoints: 500, color: 'text-amber-600', bg: 'bg-amber-600' },
  SILVER: { label: 'Серебро', next: 'GOLD', nextPoints: 1500, color: 'text-zinc-400', bg: 'bg-zinc-400' },
  GOLD: { label: 'Золото', next: 'PLATINUM', nextPoints: 3000, color: 'text-yellow-400', bg: 'bg-yellow-400' },
  PLATINUM: { label: 'Платина', next: null, nextPoints: null, color: 'text-cyan-400', bg: 'bg-cyan-400' },
}

export default async function ClientDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const { data: client } = await supabase.from('clients').select('*').eq('profile_id', user.id).single()

  if (!client) {
    return (
      <div className="p-8 text-zinc-400">
        Данные профиля загружаются. Обратитесь к менеджеру студии.
      </div>
    )
  }

  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('client_id', client.id)
    .order('started_at', { ascending: false })
    .limit(3)

  const { data: filesCount } = await supabase
    .from('files')
    .select('id', { count: 'exact' })
    .eq('client_id', client.id)

  const { data: pendingOffers } = await supabase
    .from('offers')
    .select('*')
    .eq('client_id', client.id)
    .eq('status', 'PENDING')
    .limit(3)

  const tier = LOYALTY_TIERS[client.loyalty_tier as keyof typeof LOYALTY_TIERS]
  const loyaltyProgress = tier.nextPoints
    ? Math.min((client.loyalty_points / tier.nextPoints) * 100, 100)
    : 100

  const clientSinceDate = new Date(client.client_since)
  const clientSince = formatDistanceToNow(clientSinceDate, { locale: ru, addSuffix: false })

  const totalHours = Number(client.total_hours)
  const hoursDisplay = totalHours < 1
    ? `${Math.round(totalHours * 60)} мин`
    : `${totalHours.toFixed(1)} ч`

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">
          Привет, {profile?.full_name.split(' ')[0]} 👋
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Вы с нами уже {clientSince}
        </p>
      </div>

      {/* Stats board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider">Часов в студии</p>
                <p className="text-3xl font-bold text-white mt-2">{hoursDisplay}</p>
                <p className="text-zinc-500 text-xs mt-1">{client.total_sessions} сессий</p>
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
                <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider">Материалов</p>
                <p className="text-3xl font-bold text-white mt-2">{filesCount?.length ?? 0}</p>
                <p className="text-zinc-500 text-xs mt-1">файлов загружено</p>
              </div>
              <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                <FileAudio className="w-5 h-5 text-zinc-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider">Клиент с</p>
                <p className="text-2xl font-bold text-white mt-2">
                  {format(clientSinceDate, 'MM.yyyy')}
                </p>
                <p className="text-zinc-500 text-xs mt-1">{clientSince}</p>
              </div>
              <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                <Calendar className="w-5 h-5 text-zinc-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider">Лояльность</p>
                <p className={`text-2xl font-bold mt-2 ${tier.color}`}>{tier.label}</p>
                <p className="text-zinc-500 text-xs mt-1">{client.loyalty_points} баллов</p>
              </div>
              <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                <Star className="w-5 h-5 text-zinc-300" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent sessions */}
        <div className="lg:col-span-2">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Mic2 className="w-4 h-4" />
                Последние сессии
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentSessions && recentSessions.length > 0 ? (
                recentSessions.map(session => (
                  <div key={session.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                    <div>
                      <p className="text-white text-sm font-medium">{session.title}</p>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        {format(new Date(session.started_at), 'd MMM yyyy', { locale: ru })}
                        {session.duration_minutes && ` · ${session.duration_minutes} мин`}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        session.status === 'COMPLETED'
                          ? 'border-green-700 text-green-400'
                          : session.status === 'SCHEDULED'
                          ? 'border-blue-700 text-blue-400'
                          : 'border-zinc-600 text-zinc-400'
                      }
                    >
                      {session.status === 'COMPLETED' ? 'Завершена'
                        : session.status === 'SCHEDULED' ? 'Запланирована'
                        : session.status === 'IN_PROGRESS' ? 'Идёт'
                        : 'Отменена'}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-zinc-500 text-sm text-center py-6">Сессий пока нет</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Loyalty + Offers */}
        <div className="space-y-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Программа лояльности
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className={`font-semibold ${tier.color}`}>{tier.label}</span>
                {tier.next && (
                  <span className="text-zinc-400">
                    {LOYALTY_TIERS[tier.next as keyof typeof LOYALTY_TIERS]?.label}
                  </span>
                )}
              </div>
              <Progress value={loyaltyProgress} className="h-2 bg-zinc-800" />
              <p className="text-zinc-400 text-xs">
                {client.loyalty_points} баллов
                {tier.nextPoints && ` / ${tier.nextPoints} до следующего уровня`}
              </p>
            </CardContent>
          </Card>

          {pendingOffers && pendingOffers.length > 0 && (
            <Card className="bg-zinc-900 border-amber-800/50 border">
              <CardHeader className="pb-3">
                <CardTitle className="text-amber-400 text-base">
                  Предложения ({pendingOffers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingOffers.map(offer => (
                  <div key={offer.id} className="p-3 bg-zinc-800 rounded-lg">
                    <p className="text-white text-sm font-medium">{offer.title}</p>
                    {offer.price && (
                      <p className="text-amber-400 text-xs mt-1">
                        {offer.price.toLocaleString('ru-RU')} ₽
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
