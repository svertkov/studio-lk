import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, isPast } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileAudio, Download, Clock, AlertCircle, HardDrive } from 'lucide-react'
import RequestMaterialsButton from '@/components/client/RequestMaterialsButton'

const FILE_TYPE_LABELS: Record<string, string> = {
  RECORDING: 'Запись',
  MIX: 'Сведение',
  MASTER: 'Мастеринг',
  OTHER: 'Другое',
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default async function FilesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('profile_id', user.id)
    .single()

  if (!client) redirect('/dashboard')

  const { data: files } = await supabase
    .from('files')
    .select('*, projects(name), sessions(title, started_at)')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })

  const groupedByDate = (files || []).reduce<Record<string, typeof files>>((acc, file) => {
    if (!file) return acc
    const dateKey = format(new Date(file.created_at), 'd MMMM yyyy', { locale: ru })
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey]!.push(file)
    return acc
  }, {})

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Ваши материалы</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Все записи, сведения и мастеринги вашей студии
        </p>
      </div>

      {Object.keys(groupedByDate).length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-12 text-center">
            <FileAudio className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <p className="text-zinc-400">Файлы ещё не загружены</p>
            <p className="text-zinc-600 text-sm mt-1">
              Менеджер загрузит материалы после сессии
            </p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(groupedByDate).map(([dateLabel, dateFiles]) => (
          <div key={dateLabel}>
            <h2 className="text-zinc-400 text-sm font-medium mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              {dateLabel}
            </h2>
            <div className="space-y-2">
              {dateFiles?.map(file => {
                const ydiskExpired = file.yandex_expires_at
                  ? isPast(new Date(file.yandex_expires_at))
                  : false
                const hasYdisk = !!file.yandex_disk_url && !ydiskExpired
                const hasInternal = !!file.internal_url

                return (
                  <Card key={file.id} className="bg-zinc-900 border-zinc-800">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                          <FileAudio className="w-5 h-5 text-zinc-300" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-white font-medium text-sm truncate">
                                {file.name}
                              </p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-400">
                                  {FILE_TYPE_LABELS[file.file_type]}
                                </Badge>
                                {file.duration_seconds && (
                                  <span className="text-zinc-500 text-xs">
                                    {formatDuration(file.duration_seconds)}
                                  </span>
                                )}
                                {file.size_mb && (
                                  <span className="text-zinc-500 text-xs">
                                    {file.size_mb} МБ
                                  </span>
                                )}
                                {(file as any).projects?.name && (
                                  <span className="text-zinc-500 text-xs">
                                    / {(file as any).projects.name}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Download button logic */}
                            <div className="flex-shrink-0">
                              {hasInternal ? (
                                <a href={file.internal_url!} target="_blank" rel="noopener noreferrer">
                                  <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 gap-1.5">
                                    <HardDrive className="w-3.5 h-3.5" />
                                    Скачать
                                  </Button>
                                </a>
                              ) : hasYdisk ? (
                                <a href={file.yandex_disk_url!} target="_blank" rel="noopener noreferrer">
                                  <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 gap-1.5">
                                    <Download className="w-3.5 h-3.5" />
                                    Яндекс.Диск
                                  </Button>
                                </a>
                              ) : (
                                <RequestMaterialsButton fileId={file.id} />
                              )}
                            </div>
                          </div>

                          {/* Yandex disk expiry warning */}
                          {hasYdisk && file.yandex_expires_at && (
                            <div className="flex items-center gap-1.5 mt-2">
                              <AlertCircle className="w-3 h-3 text-amber-500" />
                              <p className="text-amber-500 text-xs">
                                Ссылка действует до{' '}
                                {format(new Date(file.yandex_expires_at), 'd MMM yyyy', { locale: ru })}
                              </p>
                            </div>
                          )}

                          {ydiskExpired && !hasInternal && (
                            <p className="text-zinc-600 text-xs mt-2">
                              Временная ссылка истекла
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
