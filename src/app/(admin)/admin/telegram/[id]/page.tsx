import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getConversationDetail } from '@/lib/actions/telegram'
import ConversationView from './ConversationView'

export default async function TelegramConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [session, result] = await Promise.all([auth(), getConversationDetail(id)])

  if (!result.ok) {
    if (result.error === 'Диалог не найден') notFound()
    return (
      <div className="p-8">
        <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{result.error}</p>
      </div>
    )
  }

  // Ключ меняется при любом реальном изменении диалога или сообщений
  // (включая смену статуса отправки при повторе) — React тогда сбрасывает
  // локальный state ConversationView заново из свежих данных, вместо
  // синхронизации через useEffect (антипаттерн "derived state from props").
  const dataKey = `${result.data.updatedAt}:${result.data.messages.length}:${result.data.messages.map(m => m.status).join(',')}`

  return (
    <ConversationView
      key={dataKey}
      initialData={result.data}
      currentUserId={session!.user.id}
      currentUserName={session!.user.name ?? session!.user.email}
    />
  )
}
