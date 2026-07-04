import { auth } from '@/auth'
import { getTelegramSettings, getArchiveWarning } from '@/lib/actions/telegram'
import TelegramSettingsForm from './TelegramSettingsForm'

export default async function TelegramSettingsPage() {
  const [session, result, archiveWarning] = await Promise.all([auth(), getTelegramSettings(), getArchiveWarning()])

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Настройки Telegram</h1>
        <p className="text-zinc-400 text-sm mt-1">Согласие, вебхук и правила хранения переписки</p>
      </div>
      {!result.ok ? (
        <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{result.error}</p>
      ) : (
        <TelegramSettingsForm
          initialSettings={result.data}
          webhookStatus={result.webhookStatus}
          archiveWarning={archiveWarning}
          isOwner={session?.user.role === 'OWNER'}
        />
      )}
    </div>
  )
}
