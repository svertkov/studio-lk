'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, ExternalLink, Paperclip, Link2, PanelRightClose } from 'lucide-react'
import { retryFailedMessage, markConversationRead, type TelegramConversationDetailDTO } from '@/lib/actions/telegram'
import {
  getConsentDisplayStatus, CONSENT_DISPLAY_LABELS, CONSENT_DISPLAY_COLORS,
  computeChatPriority, CHAT_PRIORITY_LABELS, CHAT_PRIORITY_BADGE_COLORS,
} from '@/lib/telegram-model'
import TelegramMessageThread from './TelegramMessageThread'
import TelegramComposer from './TelegramComposer'
import TelegramAttachmentsPanel from './TelegramAttachmentsPanel'
import LinkTelegramConversationModal from './LinkTelegramConversationModal'

interface Props {
  clientId: string
  clientName: string
  conversation: TelegramConversationDetailDTO | null
  // Кнопка сворачивания панели живёт в её собственной шапке (см. ТЗ), но
  // сама персистентность/состояние "свёрнуто" — забота родителя
  // (ClientTelegramLayout), эта панель ничего не знает про localStorage.
  onCollapse?: () => void
}

// Встроенная Telegram-панель в карточке клиента — переиспользует те же
// TelegramMessageThread/TelegramComposer/TelegramAttachmentsPanel, что и
// полный раздел Telegram (ConversationView.tsx), просто с компактной шапкой
// и без правой панели "Клиент/Заказ/Заметки" (она здесь не нужна — мы и так
// внутри карточки клиента). Данные приходят от родителя (page.tsx) через
// initialData-подобный паттерн; page.tsx оборачивает это в key={dataKey},
// как и ConversationView, чтобы обновления сервера корректно сбрасывали
// локальный state, а не пытались слить его вручную через useEffect.
export default function ClientTelegramPanel({ clientId, clientName, conversation: initialConversation, onCollapse }: Props) {
  const router = useRouter()
  const [conversation] = useState(initialConversation)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [attachmentsPanelOpen, setAttachmentsPanelOpen] = useState(false)
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null)

  // Тот же лёгкий polling, что и в полном разделе Telegram — подхватывает
  // новые сообщения клиента, пока карточка клиента открыта у администратора.
  useEffect(() => {
    if (!conversation) return
    const interval = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(interval)
  }, [router, conversation])

  // Открытие карточки клиента с уже связанным диалогом = прочтение — тот же
  // приём и по той же причине, что и в ConversationView.tsx (полный раздел
  // Telegram): срабатывает на каждом монтировании, включая remount по
  // key={telegramKey} в page.tsx, когда поллинг подхватил новое сообщение,
  // пока администратор уже смотрит карточку этого клиента.
  useEffect(() => {
    if (!conversation || conversation.unreadCount === 0) return
    let cancelled = false
    markConversationRead(conversation.id).then(() => {
      if (!cancelled) router.refresh()
    })
    return () => { cancelled = true }
  }, [conversation, router])

  async function handleRetry(messageId: string) {
    await retryFailedMessage(messageId)
    router.refresh()
  }

  function handleShowInChat(messageId: string) {
    setAttachmentsPanelOpen(false)
    setHighlightMessageId(messageId)
  }

  if (!conversation) {
    return (
      <div className="relative bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center h-full flex flex-col items-center justify-center">
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title="Свернуть Telegram"
            className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        )}
        <MessageCircle className="w-10 h-10 text-zinc-600 mb-4" />
        <p className="text-zinc-200 font-medium">Telegram-диалог не связан</p>
        <p className="text-zinc-500 text-sm mt-1.5 max-w-xs mx-auto">
          Свяжите клиента с Telegram-диалогом, чтобы видеть переписку и вложения прямо в карточке клиента.
        </p>
        <div className="flex flex-col gap-2 mt-5 w-full max-w-[220px]">
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            className="flex items-center justify-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" /> Связать с диалогом
          </button>
          <Link
            href="/admin/telegram"
            className="flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-4 py-2 rounded-lg transition-colors"
          >
            Открыть раздел Telegram
          </Link>
        </div>

        <LinkTelegramConversationModal
          clientId={clientId}
          open={linkModalOpen}
          onOpenChange={setLinkModalOpen}
          onLinked={() => router.refresh()}
        />
      </div>
    )
  }

  const consentDisplay = getConsentDisplayStatus(conversation.consentStatus, conversation.consentRequestSentAt)
  // Тот же источник правды, что и в списке /admin/telegram и в полном разделе
  // Telegram (ConversationView) — см. комментарий там же про computeChatPriority.
  const chatPriority = computeChatPriority({
    conversationStatus: conversation.status,
    unreadCount: conversation.unreadCount,
    linkedClientId: conversation.linkedClientId,
    orderId: conversation.orderId,
    lastMessageAt: conversation.lastMessageAt,
  })

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col h-full overflow-hidden">
      {/* Компактная шапка — без Забрать/Закрепить/Архивировать, это задачи полного раздела Telegram */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white font-semibold text-sm">Telegram</p>
            {chatPriority !== 'normal' && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${CHAT_PRIORITY_BADGE_COLORS[chatPriority]}`}>
                {CHAT_PRIORITY_LABELS[chatPriority]}
              </span>
            )}
            {conversation.consentStatus !== 'NONE' && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${CONSENT_DISPLAY_COLORS[consentDisplay]}`}>
                {CONSENT_DISPLAY_LABELS[consentDisplay]}
              </span>
            )}
          </div>
          <p className="text-zinc-500 text-xs mt-0.5 truncate">
            {conversation.telegramUsername ? `@${conversation.telegramUsername}` : clientName}
          </p>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => setAttachmentsPanelOpen(true)}
            title="Вложения"
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <Link
            href={`/admin/telegram/${conversation.id}`}
            title="Открыть в Telegram-разделе"
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Свернуть Telegram"
              className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <TelegramMessageThread
        conversationId={conversation.id}
        messages={conversation.messages}
        consentRequestMessageId={conversation.consentRequestMessageId}
        consentGiven={conversation.consentStatus === 'GIVEN'}
        onRetry={handleRetry}
        highlightMessageId={highlightMessageId}
        compact
      />

      <TelegramComposer conversationId={conversation.id} onSent={() => router.refresh()} compact />

      <TelegramAttachmentsPanel
        conversationId={conversation.id}
        open={attachmentsPanelOpen}
        onOpenChange={setAttachmentsPanelOpen}
        dialogName={conversation.telegramUsername ? `@${conversation.telegramUsername}` : clientName}
        onShowInChat={handleShowInChat}
      />
    </div>
  )
}
