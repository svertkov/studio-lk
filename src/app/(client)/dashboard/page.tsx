import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Clock, FileAudio, Calendar, Star, TrendingUp, Mic2 } from 'lucide-react'

const LOYALTY_TIERS = {
  BRONZE:   { label: 'Бронза',  next: 'SILVER',   nextPoints: 500,  color: 'text-amber-500' },
  SILVER:   { label: 'Серебро', next: 'GOLD',      nextPoints: 1500, color: 'text-zinc-300' },
  GOLD:     { label: 'Золото',  next: 'PLATINUM',  nextPoints: 3000, color: 'text-yellow-400' },
  PLATINUM: { label: 'Платина', next: null,         nextPoints: null, color: 'text-cyan-400' },
}

export default async function ClientDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const { data: client } = await supabase.from('clients').select('*').eq('profile_id', user.id).single()

  if (!client) {
    return (
      <div className="p-8 text-white/40">
        Данные профиля загружаются. Обратитесь к менеджеру студии.
      </div>
    )
  }

  const { data: recentSessions } = await supabase
    .from('sessions').select('*').eq('client_id', client.id)
    .order('started_at', { ascending: false }).limit(3)

  const { count: filesCount } = await supabase
    .from('files').select('*', { count: 'exact', head: true }).eq('client_id', client.id)

  const { data: pendingOffers } = await supabase
    .from('offers').select('*').eq('client_id', client.id).eq('status', 'PENDING').limit(3)

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

  const STATUS_LABEL: Record<string, string> = {
    COMPLETED: 'Завершена', SCHEDULED: 'Запланирована',
    IN_PROGRESS: 'Идёт', CANCELLED: 'Отменена',
  }
  const STATUS_COLOR: Record<string, string> = {
    COMPLETED: 'text-green-400', SCHEDULED: 'text-blue-400',
    IN_PROGRESS: 'text-yellow-400', CANCELLED: 'text-red-400',
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">
          Привет, {profile?.full_name?.split(' ')[0] ?? 'друг'}
        </h1>
        <p className="text-white/40 text-sm mt-1">
          Вы с нами уже {clientSince}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Часов в студии', value: hoursDisplay, sub: `${client.total_sessions} сессий`, icon: Clock },
          { label: 'Материалов', value: filesCount ?? 0, sub: 'файлов загружено', icon: FileAudio },
          { label: 'Клиент с', value: format(clientSinceDate, 'MM.yyyy'), sub: clientSince, icon: Calendar },
          { label: 'Баллов', value: client.loyalty_points, sub: <span className={tier.color}>{tier.label}</span>, icon: Star },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="glass rounded-2xl p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-white/40 text-xs uppercase tracking-wider">{label}</p>
              <div className="w-8 h-8 rounded-lg glass flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-white/60" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-white/30 text-xs mt-1">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent sessions */}
        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Mic2 className="w-4 h-4 text-white/40" />
            <h2 className="text-white font-medium text-sm">Последние сессии</h2>
          </div>
          <div className="space-y-2">
            {recentSessions && recentSessions.length > 0 ? (
              recentSessions.map(session => (
                <div key={session.id} className="flex items-center justify-between p-3.5 glass rounded-xl">
                  <div>
                    <p className="text-white text-sm font-medium">{session.title}</p>
                    <p className="text-white/30 text-xs mt-0.5">
                      {format(new Date(session.started_at), 'd MMM yyyy', { locale: ru })}
                      {session.duration_minutes && ` · ${session.duration_minutes} мин`}
                    </p>
                  </div>
                  <span className={`text-xs font-medium ${STATUS_COLOR[session.status]}`}>
                    {STATUS_LABEL[session.status]}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-white/20 text-sm text-center py-8">Сессий пока нет</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Loyalty */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-white/40" />
              <h2 className="text-white font-medium text-sm">Лояльность</h2>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-semibold ${tier.color}`}>{tier.label}</span>
              {tier.next && (
                <span className="text-white/25 text-xs">
                  {LOYALTY_TIERS[tier.next as keyof typeof LOYALTY_TIERS]?.label}
                </span>
              )}
            </div>
            {/* progress */}
            <div className="glass-track h-1.5 w-full">
              <div className="glass-track-fill h-full" style={{ width: `${loyaltyProgress}%` }} />
            </div>
            <p className="text-white/25 text-xs mt-2">
              {client.loyalty_points} баллов
              {tier.nextPoints && ` из ${tier.nextPoints}`}
            </p>
          </div>

          {/* Pending offers */}
          {pendingOffers && pendingOffers.length > 0 && (
            <div className="glass rounded-2xl p-5 border border-white/10">
              <h2 className="text-amber-400 font-medium text-sm mb-3">
                Предложения ({pendingOffers.length})
              </h2>
              <div className="space-y-2">
                {pendingOffers.map(offer => (
                  <div key={offer.id} className="p-3 glass rounded-xl">
                    <p className="text-white text-sm font-medium">{offer.title}</p>
                    {offer.price && (
                      <p className="text-amber-400 text-xs mt-1">
                        {Number(offer.price).toLocaleString('ru-RU')} ₽
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
