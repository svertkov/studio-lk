import { getConversations } from '@/lib/actions/telegram'
import TelegramInbox from './TelegramInbox'

export default async function TelegramPage() {
  const result = await getConversations()

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Telegram</h1>
        <p className="text-zinc-400 text-sm mt-1">Входящие заявки клиентов из Telegram-бота студии</p>
      </div>
      {!result.ok && (
        <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{result.error}</p>
      )}
      <TelegramInbox initialConversations={result.data} />
    </div>
  )
}
