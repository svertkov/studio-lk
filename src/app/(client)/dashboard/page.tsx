import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Clock, FileAudio, Calendar, Star, TrendingUp, Mic2 } from 'lucide-react'

const LOYALTY_TIERS = {
  BRONZE:   { label: 'Бронза',  next: 'SILVER',  nextPoints: 500,  color: '#d97706' },
  SILVER:   { label: 'Серебро', next: 'GOLD',     nextPoints: 1500, color: '#6b7280' },
  GOLD:     { label: 'Золото',  next: 'PLATINUM', nextPoints: 3000, color: '#ca8a04' },
  PLATINUM: { label: 'Платина', next: null,        nextPoints: null, color: '#0891b2' },
}

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Завершена', SCHEDULED: 'Запланирована',
  IN_PROGRESS: 'Идёт', CANCELLED: 'Отменена',
}
const STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#00c26b', SCHEDULED: '#3b82f6',
  IN_PROGRESS: '#f59e0b', CANCELLED: '#ef4444',
}

export default async function ClientDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const { data: client } = await supabase.from('clients').select('*').eq('profile_id', user.id).single()

  if (!client) {
    return (
      <div className="p-8 text-gray-400">
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
  const totalHours = Number(client.total_hours)
  const hoursDisplay = totalHours < 1
    ? `${Math.round(totalHours * 60)} мин`
    : `${totalHours.toFixed(1)} ч`

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Привет, {profile?.full_name?.split(' ')[0] ?? 'друг'} 👋
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Вы с нами уже {formatDistanceToNow(clientSinceDate, { locale: ru, addSuffix: false })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Часов в студии', value: hoursDisplay, sub: `${client.total_sessions} сессий`, icon: Clock },
          { label: 'Материалов',     value: String(filesCount ?? 0), sub: 'файлов загружено', icon: FileAudio },
          { label: 'Клиент с',       value: format(clientSinceDate, 'MM.yyyy'), sub: formatDistanceToNow(clientSinceDate, { locale: ru }), icon: Calendar },
          { label: 'Баллов',         value: String(client.loyalty_points), sub: tier.label, icon: Star },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="card-base p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(0,194,107,0.08)' }}>
                <Icon className="w-4 h-4" style={{ color: '#00c26b' }} />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Sessions */}
        <div className="lg:col-span-2 card-base p-6">
          <div className="flex items-center gap-2 mb-5">
            <Mic2 className="w-4 h-4" style={{ color: '#00c26b' }} />
            <h2 className="font-bold text-gray-900 text-sm">Последние сессии</h2>
          </div>
          <div className="space-y-2">
            {recentSessions && recentSessions.length > 0 ? (
              recentSessions.map(session => (
                <div key={session.id}
                  className="flex items-center justify-between p-3.5 rounded-xl"
                  style={{ background: '#f8f8f8' }}>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{session.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(new Date(session.started_at), 'd MMM yyyy', { locale: ru })}
                      {session.duration_minutes && ` · ${session.duration_minutes} мин`}
                    </p>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{
                      color: STATUS_COLOR[session.status],
                      background: `${STATUS_COLOR[session.status]}15`,
                    }}>
                    {STATUS_LABEL[session.status]}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-gray-300 text-sm text-center py-8">Сессий пока нет</p>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="space-y-4">
          {/* Loyalty */}
          <div className="card-base p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4" style={{ color: '#00c26b' }} />
              <h2 className="font-bold text-gray-900 text-sm">Лояльность</h2>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold" style={{ color: tier.color }}>{tier.label}</span>
              {tier.next && (
                <span className="text-xs text-gray-300">
                  {LOYALTY_TIERS[tier.next as keyof typeof LOYALTY_TIERS]?.label}
                </span>
              )}
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${loyaltyProgress}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {client.loyalty_points} баллов
              {tier.nextPoints && ` из ${tier.nextPoints}`}
            </p>
          </div>

          {/* Offers */}
          {pendingOffers && pendingOffers.length > 0 && (
            <div className="card-green p-5">
              <h2 className="font-bold text-sm mb-3" style={{ color: '#00954f' }}>
                Предложения ({pendingOffers.length})
              </h2>
              <div className="space-y-2">
                {pendingOffers.map(offer => (
                  <div key={offer.id} className="bg-white rounded-xl p-3.5 shadow-sm">
                    <p className="text-sm font-semibold text-gray-900">{offer.title}</p>
                    {offer.price && (
                      <p className="text-xs font-bold mt-1" style={{ color: '#00c26b' }}>
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
