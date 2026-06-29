import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Users, Plus, Clock, Star } from 'lucide-react'

const TIER_COLORS: Record<string, string> = {
  BRONZE: 'border-amber-700 text-amber-600',
  SILVER: 'border-zinc-600 text-zinc-400',
  GOLD: 'border-yellow-600 text-yellow-400',
  PLATINUM: 'border-cyan-700 text-cyan-400',
}
const TIER_LABELS: Record<string, string> = {
  BRONZE: 'Бронза', SILVER: 'Серебро', GOLD: 'Золото', PLATINUM: 'Платина',
}

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/staff-login')

  const { data: clients } = await supabase
    .from('clients')
    .select('*, profiles(*)')
    .order('created_at', { ascending: false })

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Клиенты</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {clients?.length ?? 0} клиентов в базе
          </p>
        </div>
        <Link href="/admin/clients/new">
          <Button className="bg-white text-black hover:bg-zinc-100 gap-2">
            <Plus className="w-4 h-4" />
            Добавить клиента
          </Button>
        </Link>
      </div>

      {clients && clients.length > 0 ? (
        <div className="grid grid-cols-1 gap-3">
          {clients.map(client => {
            const profile = (client as any).profiles
            return (
              <Link key={client.id} href={`/admin/clients/${client.id}`}>
                <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center text-white font-semibold flex-shrink-0">
                        {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white font-medium text-sm">{profile?.full_name}</p>
                          <Badge variant="outline" className={`text-xs ${TIER_COLORS[client.loyalty_tier]}`}>
                            {TIER_LABELS[client.loyalty_tier]}
                          </Badge>
                        </div>
                        <p className="text-zinc-400 text-xs mt-0.5">{profile?.email}</p>
                        <div className="flex items-center gap-4 mt-2 text-zinc-500 text-xs">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {Number(client.total_hours).toFixed(1)} ч
                          </span>
                          <span className="flex items-center gap-1">
                            <Star className="w-3 h-3" />
                            {client.loyalty_points} баллов
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            с {format(new Date(client.client_since), 'MMM yyyy', { locale: ru })}
                          </span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-zinc-400 text-xs">{client.total_sessions} сессий</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-12 text-center">
            <Users className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <p className="text-zinc-400">Клиентов пока нет</p>
            <p className="text-zinc-600 text-sm mt-1">Добавьте первого клиента</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
