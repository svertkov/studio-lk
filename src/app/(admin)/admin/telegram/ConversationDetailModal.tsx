'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getConversationDetail, type TelegramConversationDetailDTO } from '@/lib/actions/telegram'
import { TELEGRAM_STATUS_LABELS, TELEGRAM_STATUS_COLORS } from '@/lib/telegram-model'

interface Props {
  conversationId: string
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export default function ConversationDetailModal({ conversationId, onOpenChange }: Props) {
  const [data, setData] = useState<TelegramConversationDetailDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getConversationDetail(conversationId).then(result => {
      if (cancelled) return
      if (result.ok) setData(result.data)
      else setError(result.error)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [conversationId])

  const name = data ? (data.linkedClientName || data.clientNameGuess || data.telegramUsername || 'Без имени') : ''

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl sm:max-w-[662px] max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
          <DialogTitle className="text-white text-lg font-semibold flex items-center gap-2.5 flex-wrap">
            {loading ? 'Диалог' : name}
            {data && (
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TELEGRAM_STATUS_COLORS[data.status]}`}>
                {TELEGRAM_STATUS_LABELS[data.status]}
              </span>
            )}
          </DialogTitle>
          {data?.telegramUsername && <p className="text-zinc-500 text-xs">@{data.telegramUsername}</p>}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading && <p className="text-zinc-500 text-sm">Загрузка...</p>}
          {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

          {data && (
            <>
              {data.linkedClientId && (
                <Link href={`/admin/clients/${data.linkedClientId}`} className="text-xs text-[#00c26b] hover:underline">
                  Открыть карточку клиента
                </Link>
              )}
              {data.orderId && (
                <p className="text-xs text-zinc-400">
                  Уже создан заказ по этой переписке —{' '}
                  <Link href="/admin/orders" className="text-[#00c26b] hover:underline">открыть «Заказы»</Link>
                </p>
              )}

              <div className="space-y-2.5 pt-2">
                {data.messages.length === 0 ? (
                  <p className="text-zinc-600 text-xs text-center py-6">Сообщений пока нет</p>
                ) : (
                  data.messages.map(m => (
                    <div key={m.id} className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          m.direction === 'OUTBOUND'
                            ? 'bg-[#00c26b]/15 border border-[#00c26b]/30 text-zinc-100'
                            : 'bg-zinc-800 border border-zinc-700 text-zinc-100'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text || '(без текста)'}</p>
                        <p className="text-zinc-500 text-[11px] mt-1">
                          {format(parseISO(m.createdAt), 'd MMMM, HH:mm', { locale: ru })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            Закрыть
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
