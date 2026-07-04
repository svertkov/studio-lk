import Link from 'next/link'
import { Settings } from 'lucide-react'
import { getConversations } from '@/lib/actions/telegram'
import TelegramInbox from './TelegramInbox'

export default async function TelegramPage() {
  const result = await getConversations()

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Telegram</h1>
        <Link href="/admin/telegram/settings" className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 text-sm transition-colors">
          <Settings className="w-4 h-4" /> Настройки
        </Link>
      </div>
      {!result.ok && (
        <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{result.error}</p>
      )}
      <TelegramInbox initialConversations={result.data} />
    </div>
  )
}
