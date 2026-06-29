import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Clock, Mic2 } from 'lucide-react'

const STATUS_MAP = {
  SCHEDULED: { label: 'Запланирована', class: 'border-blue-700 text-blue-400' },
  IN_PROGRESS: { label: 'Идёт сейчас', class: 'border-green-700 text-green-400' },
  COMPLETED: { label: 'Завершена', class: 'border-zinc-600 text-zinc-400' },
  CANCELLED: { label: 'Отменена', class: 'border-red-900 text-red-500' },
}

function formatDurationMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} мин`
  if (m === 0) return `${h} ч`
  return `${h} ч ${m} мин`
}

export default async function SessionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id, total_hours, total_sessions')
    .eq('profile_id', user.id)
    .single()

  if (!client) redirect('/dashboard')

  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('client_id', client.id)
    .order('started_at', { ascending: false })

  const totalHours = Number(client.total_hours)

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">История сессий</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Все ваши посещения студии
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 bg-zinc-800 rounded-lg flex items-center justify-center">
              <Clock className="w-4 h-4 text-zinc-300" />
            </div>
            <div>
              <p className="text-zinc-400 text-xs">Всего часов</p>
              <p className="text-white font-bold text-lg">
                {totalHours < 1 ? `${Math.round(totalHours * 60)} мин` : `${totalHours.toFixed(1)} ч`}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 bg-zinc-800 rounded-lg flex items-center justify-center">
              <Mic2 className="w-4 h-4 text-zinc-300" />
            </div>
            <div>
              <p className="text-zinc-400 text-xs">Всего сессий</p>
              <p className="text-white font-bold text-lg">{client.total_sessions}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions list */}
      <div className="space-y-3">
        {sessions && sessions.length > 0 ? (
          sessions.map(session => {
            const status = STATUS_MAP[session.status as keyof typeof STATUS_MAP]
            const startDate = new Date(session.started_at)

            return (
              <Card key={session.id} className="bg-zinc-900 border-zinc-800">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Mic2 className="w-5 h-5 text-zinc-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{session.title}</p>
                        <div className="flex items-center gap-3 mt-1 text-zinc-400 text-xs">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(startDate, 'd MMM yyyy', { locale: ru })}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(startDate, 'HH:mm')}
                            {session.ended_at && ` – ${format(new Date(session.ended_at), 'HH:mm')}`}
                          </span>
                          {session.duration_minutes && (
                            <span>{formatDurationMinutes(session.duration_minutes)}</span>
                          )}
                        </div>
                        {session.notes && (
                          <p className="text-zinc-500 text-xs mt-2">{session.notes}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className={status.class}>
                      {status.label}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )
          })
        ) : (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-12 text-center">
              <Mic2 className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
              <p className="text-zinc-400">Сессий пока нет</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
