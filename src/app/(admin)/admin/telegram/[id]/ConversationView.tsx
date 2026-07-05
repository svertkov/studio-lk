'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  ArrowLeft, Pin, Archive, ArchiveRestore, UserPlus, Users, ShoppingBag,
  AlertTriangle, ShieldOff, ExternalLink, Paperclip,
} from 'lucide-react'
import {
  retryFailedMessage, claimConversation, pinConversation, archiveConversation,
  unarchiveConversation, revokeConsentManually, findClientMatchForConversation, linkConversationToClient,
  addInternalNote, markConversationOrderCreated, markConversationRead,
  type TelegramConversationDetailDTO,
} from '@/lib/actions/telegram'
import { getClients } from '@/lib/actions/clients'
import OrderFormModal from '../../orders/OrderFormModal'
import AddClientModal from '../../clients/AddClientModal'
import TelegramMessageThread from '@/components/telegram/TelegramMessageThread'
import TelegramComposer from '@/components/telegram/TelegramComposer'
import TelegramAttachmentsPanel from '@/components/telegram/TelegramAttachmentsPanel'
import {
  TELEGRAM_STATUS_LABELS, TELEGRAM_STATUS_COLORS, getConsentDisplayStatus, CONSENT_DISPLAY_LABELS, CONSENT_DISPLAY_COLORS,
  computeChatPriority, CHAT_PRIORITY_LABELS, CHAT_PRIORITY_BADGE_COLORS,
} from '@/lib/telegram-model'

interface Props {
  initialData: TelegramConversationDetailDTO
  currentUserId: string
  currentUserName: string | null
}

interface ClientOption {
  id: string
  name: string
  phone?: string | null
}

export default function ConversationView({ initialData, currentUserId, currentUserName }: Props) {
  const router = useRouter()
  const [conversation, setConversation] = useState(initialData)
  // Не state: сообщения/заметки внутри одного "монтирования" не меняются
  // локально (только через сервер) — обновление приходит через remount по
  // key={dataKey} в page.tsx, отдельный useState тут был бы мёртвым кодом.
  const messages = initialData.messages
  const notes = initialData.internalNotes

  const [noteText, setNoteText] = useState('')

  const [linkClientOpen, setLinkClientOpen] = useState(false)
  const [clientQuery, setClientQuery] = useState('')
  const [clientResults, setClientResults] = useState<ClientOption[]>([])
  const [duplicateClient, setDuplicateClient] = useState<{ id: string; name: string } | null>(null)
  const [createClientModalOpen, setCreateClientModalOpen] = useState(false)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)
  const [orderFormOpen, setOrderFormOpen] = useState(false)
  const [attachmentsPanelOpen, setAttachmentsPanelOpen] = useState(false)
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Лёгкий polling вместо realtime (в проекте нет ws/pusher) — подхватывает
  // новые сообщения клиента, пока страница диалога открыта у администратора.
  // Компонент рендерится в page.tsx с key={updatedAt} — если данные реально
  // изменились, React сам переинициализирует локальный state из initialData
  // (стандартный паттерн "сброс state по key" вместо setState внутри эффекта).
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
    }, 10_000)
    return () => clearInterval(interval)
  }, [router])

  // Открытие диалога = прочтение. Срабатывает на каждом монтировании этого
  // компонента — а монтирование происходит не только при первом переходе на
  // страницу, но и при каждом remount по key={dataKey} в page.tsx (в т.ч. на
  // каждый поллинг, подхвативший новое сообщение клиента, пока администратор
  // уже смотрит именно этот диалог) — то есть именно тогда, когда сообщение
  // нужно считать прочитанным. Условие unreadCount > 0 не даёт слать лишний
  // запрос, если уже прочитано. router.refresh() после — чтобы шапка ниже
  // (и бейдж в /admin/telegram при возврате туда) сразу отразили сброшенный
  // unreadCount, а не ждали следующего 10-секундного поллинга.
  useEffect(() => {
    if (initialData.unreadCount === 0) return
    let cancelled = false
    markConversationRead(initialData.id).then(() => {
      if (!cancelled) router.refresh()
    })
    return () => { cancelled = true }
  }, [initialData.id, initialData.unreadCount, router])

  const name = conversation.linkedClientName || conversation.clientNameGuess || conversation.telegramUsername || 'Без имени'
  const consentGiven = conversation.consentStatus === 'GIVEN'
  const consentDisplay = getConsentDisplayStatus(conversation.consentStatus, conversation.consentRequestSentAt)
  // Пересчитывается из локального state (не берётся готовым полем из DTO),
  // чтобы мгновенно реагировать на оптимистичные обновления в этом же
  // компоненте (Забрать в работу, Связать с клиентом и т.п.), не дожидаясь
  // серверного round-trip — та же функция, что и в списке /admin/telegram,
  // поэтому один и тот же чат не может показать разный статус в двух местах.
  const chatPriority = computeChatPriority({
    conversationStatus: conversation.status,
    unreadCount: conversation.unreadCount,
    linkedClientId: conversation.linkedClientId,
    orderId: conversation.orderId,
    lastMessageAt: conversation.lastMessageAt,
  })

  async function handleRetry(messageId: string) {
    await retryFailedMessage(messageId)
    router.refresh()
  }

  // Вызывается из панели вложений ("Показать в чате") — закрывает панель и
  // просит TelegramMessageThread проскроллить к сообщению и подсветить его.
  function handleShowInChat(messageId: string) {
    setAttachmentsPanelOpen(false)
    setHighlightMessageId(messageId)
  }

  async function handleClaim() {
    const result = await claimConversation(conversation.id)
    if (result.ok) {
      setConversation(prev => ({ ...prev, status: 'IN_PROGRESS', assignedAdminId: currentUserId, assignedAdminName: currentUserName }))
    }
  }

  async function handlePin() {
    const next = !conversation.isPinned
    setConversation(prev => ({ ...prev, isPinned: next }))
    await pinConversation(conversation.id, next)
  }

  async function handleArchiveToggle() {
    if (conversation.status === 'ARCHIVED') {
      const result = await unarchiveConversation(conversation.id)
      if (result.ok) router.refresh()
    } else {
      const result = await archiveConversation(conversation.id)
      if (result.ok) setConversation(prev => ({ ...prev, status: 'ARCHIVED' }))
    }
  }

  async function handleRevokeConsent() {
    if (!confirm('Отметить согласие клиента как отозванное? Это действие видно в истории и логируется.')) return
    const result = await revokeConsentManually(conversation.id)
    if (result.ok) router.refresh()
  }

  async function handleClientSearch(value: string) {
    setClientQuery(value)
    if (value.trim().length < 2) { setClientResults([]); return }
    const res = await getClients({ search: value.trim() })
    if (res.ok) setClientResults(res.data.slice(0, 8))
  }

  async function handleLinkClient(clientId: string) {
    const result = await linkConversationToClient(conversation.id, clientId)
    if (result.ok) {
      setLinkClientOpen(false)
      router.refresh()
    }
  }

  // Клиент больше не создаётся по одному клику — сначала проверяем
  // возможные совпадения (по telegramUsername/телефону диалога), и только
  // если совпадений нет (или администратор явно выбрал "всё равно создать
  // нового" в предупреждении ниже) — открываем форму на редактирование.
  async function handleOpenCreateClient() {
    setCheckingDuplicate(true)
    const match = await findClientMatchForConversation(conversation.id)
    setCheckingDuplicate(false)
    if (match.ok && match.data) {
      setDuplicateClient(match.data)
    } else {
      setCreateClientModalOpen(true)
    }
  }

  function handleCreateAnyway() {
    setDuplicateClient(null)
    setCreateClientModalOpen(true)
  }

  async function handleAddNote() {
    const text = noteText.trim()
    if (!text) return
    setNoteText('')
    const result = await addInternalNote(conversation.id, text)
    if (result.ok) router.refresh()
  }

  return (
    // h-screen, а не h-full: родительский <main> в AdminLayout — min-h-screen
    // (не h-screen), поэтому h-full от него не даёт надёжную границу высоты.
    // Без явной границы flex-1 ниже не сжимается, а раздвигает всю страницу,
    // и нижняя панель ввода "уезжает" вниз за пределы экрана.
    <div className="flex h-screen">
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        {/* Верхняя панель */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/admin/telegram" className="text-zinc-500 hover:text-zinc-200 flex-shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-semibold truncate">{name}</p>
                {chatPriority !== 'normal' && (
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CHAT_PRIORITY_BADGE_COLORS[chatPriority]}`}>
                    {CHAT_PRIORITY_LABELS[chatPriority]}
                  </span>
                )}
                {/* chatPriority === 'in_progress' по построению означает
                    conversation.status === 'IN_PROGRESS' — тот же бейдж ниже
                    показал бы "В работе" второй раз подряд теми же словами. */}
                {chatPriority !== 'in_progress' && (
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TELEGRAM_STATUS_COLORS[conversation.status]}`}>
                    {TELEGRAM_STATUS_LABELS[conversation.status]}
                  </span>
                )}
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${CONSENT_DISPLAY_COLORS[consentDisplay]}`}>
                  {CONSENT_DISPLAY_LABELS[consentDisplay]}
                </span>
              </div>
              <p className="text-zinc-500 text-xs mt-0.5">
                {conversation.telegramUsername && `@${conversation.telegramUsername}`}
                {conversation.telegramUserId && ` · id ${conversation.telegramUserId}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={handleClaim}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
              Забрать в работу
            </button>
            <button type="button" onClick={handlePin}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                conversation.isPinned ? 'bg-[#00c26b]/15 text-[#00c26b]' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
              }`}>
              <Pin className={`w-3.5 h-3.5 ${conversation.isPinned ? 'fill-current' : ''}`} />
              {conversation.isPinned ? 'Закреплено' : 'Закрепить'}
            </button>
            <button type="button" onClick={handleArchiveToggle}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors flex items-center gap-1.5">
              {conversation.status === 'ARCHIVED' ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              {conversation.status === 'ARCHIVED' ? 'Разархивировать' : 'Архивировать'}
            </button>
            <button type="button" onClick={() => setAttachmentsPanelOpen(true)} title="Вложения"
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Вложения</span>
            </button>
          </div>
        </div>

        {/* Предупреждения */}
        {conversation.consentStatus === 'NONE' && (
          <div className="mx-6 mt-4 flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3.5 py-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-300 text-sm">
              Клиент ещё не дал согласие на обработку персональных данных. Бот отправил запрос согласия. До получения согласия не запрашивайте лишние персональные данные.
            </p>
          </div>
        )}
        {conversation.consentStatus === 'REVOKED' && (
          <div className="mx-6 mt-4 flex items-start gap-2 bg-red-950/30 border border-red-800/40 rounded-lg px-3.5 py-2.5">
            <ShieldOff className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">
              Клиент отозвал согласие на обработку персональных данных. Будьте внимательны при дальнейшей обработке обращения.
            </p>
          </div>
        )}

        <TelegramMessageThread
          conversationId={conversation.id}
          messages={messages}
          consentRequestMessageId={conversation.consentRequestMessageId}
          consentGiven={consentGiven}
          onRetry={handleRetry}
          highlightMessageId={highlightMessageId}
        />

        <TelegramComposer conversationId={conversation.id} onSent={() => router.refresh()} />
      </div>

      {/* Правая панель */}
      <div className="w-80 flex-shrink-0 border-l border-zinc-800 overflow-y-auto p-4 space-y-5">
        <div>
          <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Диалог</p>
          <div className="space-y-1.5 text-sm">
            <Row label="Telegram" value={conversation.telegramUsername ? `@${conversation.telegramUsername}` : '—'} />
            <Row label="User ID" value={conversation.telegramUserId ?? '—'} />
            <Row label="Chat ID" value={conversation.telegramChatId} />
            <Row label="Ведёт" value={conversation.assignedAdminName ?? '—'} />
            <Row label="Создан" value={format(parseISO(conversation.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })} />
            {conversation.lastMessageAt && (
              <Row label="Последнее сообщение" value={format(parseISO(conversation.lastMessageAt), 'd MMM yyyy, HH:mm', { locale: ru })} />
            )}
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-4 space-y-2">
          <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Клиент</p>
          {actionSuccess && (
            <p className="text-[#00c26b] text-xs bg-[#00c26b]/10 border border-[#00c26b]/30 rounded-lg px-2.5 py-2">{actionSuccess}</p>
          )}
          {conversation.linkedClientId ? (
            <Link href={`/admin/clients/${conversation.linkedClientId}`} className="flex items-center gap-1.5 text-sm text-[#00c26b] hover:underline">
              {conversation.linkedClientName} <ExternalLink className="w-3 h-3" />
            </Link>
          ) : (
            <div className="space-y-2">
              <button type="button" onClick={handleOpenCreateClient} disabled={checkingDuplicate}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-zinc-200 transition-colors">
                <UserPlus className="w-3.5 h-3.5" /> {checkingDuplicate ? 'Проверяем...' : 'Создать клиента'}
              </button>
              <button type="button" onClick={() => setLinkClientOpen(v => !v)}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
                <Users className="w-3.5 h-3.5" /> Связать с существующим
              </button>
              {linkClientOpen && (
                <div className="space-y-1.5">
                  <input
                    value={clientQuery}
                    onChange={e => handleClientSearch(e.target.value)}
                    placeholder="Имя или телефон..."
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#00c26b]"
                  />
                  {clientResults.map(c => (
                    <button key={c.id} type="button" onClick={() => handleLinkClient(c.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 text-xs text-zinc-200">
                      {c.name} {c.phone ? `· ${c.phone}` : ''}
                    </button>
                  ))}
                </div>
              )}
              {duplicateClient && (
                <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-amber-300 text-xs">
                    Возможно, такой клиент уже существует:{' '}
                    <Link href={`/admin/clients/${duplicateClient.id}`} className="underline hover:no-underline">
                      <strong>{duplicateClient.name}</strong>
                    </Link>
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <Link href={`/admin/clients/${duplicateClient.id}`} className="text-xs text-zinc-300 hover:text-zinc-100 underline">
                      Открыть
                    </Link>
                    <button type="button" onClick={() => handleLinkClient(duplicateClient.id)}
                      className="text-xs text-[#00c26b] hover:underline">Связать с этим диалогом</button>
                    <button type="button" onClick={handleCreateAnyway}
                      className="text-xs text-zinc-400 hover:text-zinc-200">Всё равно создать нового</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 pt-4 space-y-2">
          <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Заказ</p>
          {conversation.orderId ? (
            <Link href="/admin/orders" className="flex items-center gap-1.5 text-sm text-[#00c26b] hover:underline">
              Открыть «Заказы» <ExternalLink className="w-3 h-3" />
            </Link>
          ) : (
            <button type="button" onClick={() => setOrderFormOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
              <ShoppingBag className="w-3.5 h-3.5" /> Создать заказ
            </button>
          )}
        </div>

        {consentGiven && (
          <div className="border-t border-zinc-800 pt-4">
            <button type="button" onClick={handleRevokeConsent}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-red-950/30 hover:bg-red-950/50 border border-red-800/40 text-red-300 transition-colors">
              <ShieldOff className="w-3.5 h-3.5" /> Отозвать согласие вручную
            </button>
          </div>
        )}

        <div className="border-t border-zinc-800 pt-4 space-y-2">
          <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Внутренние заметки</p>
          <p className="text-zinc-600 text-[11px] mb-2">Видны только сотрудникам, клиенту не отправляются.</p>
          <div className="space-y-2">
            {notes.map(n => (
              <div key={n.id} className="bg-zinc-800/50 rounded-lg p-2.5">
                <p className="text-zinc-200 text-xs whitespace-pre-wrap">{n.text}</p>
                <p className="text-zinc-500 text-[11px] mt-1">{n.authorName} · {format(parseISO(n.createdAt), 'd MMM, HH:mm', { locale: ru })}</p>
              </div>
            ))}
          </div>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Добавить заметку..."
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#00c26b] resize-none"
          />
          <button type="button" onClick={handleAddNote}
            className="w-full text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
            Добавить заметку
          </button>
        </div>
      </div>

      {orderFormOpen && (
        <OrderFormModal
          order={null}
          onOpenChange={setOrderFormOpen}
          onSaved={() => { markConversationOrderCreated(conversation.id); router.refresh() }}
          telegramConversationId={conversation.id}
          initialValues={{
            clientName: name !== 'Без имени' ? name : undefined,
            clientTelegram: conversation.telegramUsername ? `@${conversation.telegramUsername}` : undefined,
            clientPhone: conversation.phone ?? undefined,
            clientId: conversation.linkedClientId ?? undefined,
            comment: `Из Telegram-диалога: ${conversation.lastMessageText ?? ''} (id: ${conversation.id})`,
          }}
        />
      )}

      {createClientModalOpen && (
        <AddClientModal
          open
          onOpenChange={setCreateClientModalOpen}
          onSuccess={() => {
            // Небольшая задержка перед refresh() — иначе он тут же
            // перемонтирует ConversationView по key={dataKey} в page.tsx и
            // мгновенно стирает actionSuccess/conversation ниже, не дав
            // администратору увидеть подтверждение.
            setTimeout(() => router.refresh(), 2000)
          }}
          onCreated={client => {
            setConversation(prev => ({ ...prev, linkedClientId: client.id, linkedClientName: client.name }))
            setActionSuccess('Клиент создан и связан с Telegram-диалогом')
            setTimeout(() => setActionSuccess(null), 4000)
          }}
          title="Создать клиента из Telegram"
          subtitle="Проверьте данные перед созданием карточки клиента"
          submitLabel="Создать клиента"
          footerNote={
            <>Telegram User ID: {conversation.telegramUserId ?? '—'} · Chat ID: {conversation.telegramChatId}</>
          }
          initialValues={{
            // Раздельные first/last, если есть (новые диалоги); для диалогов
            // до этого поля — запасной вариант: clientNameGuess целиком в
            // "Имя" (см. schema.prisma, telegramFirstName/telegramLastName).
            // Пустые поля Telegram остаются пустыми — никогда не "Не указано".
            firstName: conversation.telegramFirstName ?? conversation.clientNameGuess ?? undefined,
            lastName: conversation.telegramLastName ?? undefined,
            telegram: conversation.telegramUsername ? `@${conversation.telegramUsername}` : undefined,
            phone: conversation.phone ?? undefined,
            source: 'TELEGRAM',
            notes: `Создан из Telegram-диалога (id: ${conversation.id})`,
            telegramConversationId: conversation.id,
          }}
        />
      )}

      <TelegramAttachmentsPanel
        conversationId={conversation.id}
        open={attachmentsPanelOpen}
        onOpenChange={setAttachmentsPanelOpen}
        dialogName={name}
        onShowInChat={handleShowInChat}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-300 text-right truncate max-w-[60%]">{value}</span>
    </div>
  )
}
