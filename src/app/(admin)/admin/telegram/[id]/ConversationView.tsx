'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO, isSameDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import { upload } from '@vercel/blob/client'
import {
  ArrowLeft, Pin, Archive, ArchiveRestore, UserPlus, Users, ShoppingBag,
  Send, RotateCcw, AlertTriangle, ShieldOff, ExternalLink, FileText, Paperclip, X, ImageOff, Loader2,
} from 'lucide-react'
import {
  sendConversationMessage, sendConversationAttachmentFromBlob, retryFailedMessage, claimConversation, pinConversation, archiveConversation,
  unarchiveConversation, revokeConsentManually, createClientFromConversation, linkConversationToClient,
  addInternalNote, markConversationOrderCreated,
  type TelegramConversationDetailDTO, type TelegramMessageDTO,
} from '@/lib/actions/telegram'
import { getClients } from '@/lib/actions/clients'
import OrderFormModal from '../../orders/OrderFormModal'
import { TELEGRAM_STATUS_LABELS, TELEGRAM_STATUS_COLORS, TELEGRAM_CONSENT_STATUS_LABELS, TELEGRAM_MESSAGE_STATUS_LABELS } from '@/lib/telegram-model'

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

// Совпадает с ATTACHMENT_FALLBACK_LABEL в src/app/api/telegram/webhook/route.ts
// — если text равен одной из этих подписей, значит у сообщения не было
// собственной подписи (caption), и повторно показывать её под вложением не нужно.
const ATTACHMENT_PLACEHOLDER_TEXTS = ['📷 Фото', '📄 Документ', '🎤 Голосовое сообщение', '🎬 Видео', '🎭 Стикер']

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Пока идёт запрос к прокси-роуту — скелетон; если запрос упал (битый
// file_id, рассинхрон Content-Length и т.п.) — аккуратная плашка вместо
// сломанной иконки браузера.
function PhotoAttachment({ url, alt, size = 'md', onOpen }: { url: string; alt: string; size?: 'sm' | 'md'; onOpen?: () => void }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  if (status === 'error') {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-black/20 rounded-lg text-zinc-500 ${size === 'sm' ? 'w-24 h-24' : 'w-[220px] min-h-[120px] p-3'}`}>
        <ImageOff className="w-5 h-5 flex-shrink-0" />
        <span className="text-[10px] text-center">Не удалось загрузить изображение</span>
      </div>
    )
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- прокси-роут, не статичный ассет
    <img
      src={url}
      alt={alt}
      className={`${size === 'sm' ? 'w-24 h-24 object-contain' : 'w-full h-auto'} ${status === 'loading' ? 'opacity-0' : 'opacity-100'} transition-opacity duration-150`}
      onLoad={() => setStatus('loaded')}
      onError={() => setStatus('error')}
    />
  )

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen || status !== 'loaded'}
      className={`relative block rounded-lg overflow-hidden bg-zinc-800/60 ${size === 'sm' ? 'w-24 h-24' : 'w-[220px] min-h-[120px]'} ${onOpen && status === 'loaded' ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {status === 'loading' && <div className="absolute inset-0 animate-pulse bg-zinc-700/50" />}
      {image}
    </button>
  )
}

function MessageAttachment({ message, onOpenLightbox }: { message: TelegramMessageDTO; onOpenLightbox: (url: string) => void }) {
  const a = message.attachment
  if (!a) return null

  if (message.messageType === 'PHOTO') {
    return <PhotoAttachment url={a.fileUrl} alt="Фото" onOpen={() => onOpenLightbox(a.fileUrl)} />
  }
  if (message.messageType === 'DOCUMENT') {
    return (
      <a href={a.downloadUrl} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 hover:bg-black/30 transition-colors">
        <FileText className="w-5 h-5 text-zinc-400 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs truncate">{a.fileName || 'Документ'}</p>
          <p className="text-zinc-500 text-[11px]">{formatFileSize(a.fileSize)}{a.mimeType ? ` · ${a.mimeType}` : ''}</p>
        </div>
      </a>
    )
  }
  if (message.messageType === 'VOICE') {
    return (
      <div className="flex items-center gap-2">
        <audio controls src={a.fileUrl} className="max-w-[220px] h-8" />
        {a.duration != null && <span className="text-zinc-500 text-[11px] flex-shrink-0">{formatDuration(a.duration)}</span>}
      </div>
    )
  }
  if (message.messageType === 'VIDEO') {
    return (
      <div className="space-y-1">
        <video controls src={a.fileUrl} className="max-w-[240px] rounded-lg" />
        <a href={a.downloadUrl} className="text-[11px] text-zinc-400 hover:text-zinc-200 underline">Скачать</a>
      </div>
    )
  }
  if (message.messageType === 'STICKER') {
    return a.isAnimatedSticker ? (
      <div className="w-20 h-20 flex items-center justify-center text-3xl bg-black/20 rounded-lg">🎭</div>
    ) : (
      <PhotoAttachment url={a.fileUrl} alt="Стикер" size="sm" />
    )
  }
  return null
}

function groupByDate(messages: TelegramMessageDTO[]) {
  const groups: { day: Date; label: string; items: TelegramMessageDTO[] }[] = []
  for (const m of messages) {
    const day = parseISO(m.createdAt)
    const last = groups[groups.length - 1]
    if (last && isSameDay(last.day, day)) last.items.push(m)
    else groups.push({ day, label: format(day, 'd MMMM yyyy', { locale: ru }), items: [m] })
  }
  return groups
}

export default function ConversationView({ initialData, currentUserId, currentUserName }: Props) {
  const router = useRouter()
  const [conversation, setConversation] = useState(initialData)
  // Не state: сообщения/заметки внутри одного "монтирования" не меняются
  // локально (только через сервер) — обновление приходит через remount по
  // key={dataKey} в page.tsx, отдельный useState тут был бы мёртвым кодом.
  const messages = initialData.messages
  const notes = initialData.internalNotes

  const [messageText, setMessageText] = useState('')
  const [sending, setSending] = useState(false)
  const [noteText, setNoteText] = useState('')

  const [linkClientOpen, setLinkClientOpen] = useState(false)
  const [clientQuery, setClientQuery] = useState('')
  const [clientResults, setClientResults] = useState<ClientOption[]>([])
  const [duplicateClient, setDuplicateClient] = useState<{ id: string; name: string } | null>(null)
  const [orderFormOpen, setOrderFormOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Вложение — свой небольшой стейт-машин, отдельный от текстовой отправки:
  // idle (ничего не прикреплено) → staged (файл выбран, ждём отправки) →
  // uploading (реальная загрузка байтов на наш сервер, есть процент) →
  // processing (байты уже у нас, ждём ответ от Telegram) → error.
  type AttachmentPhase = 'idle' | 'staged' | 'uploading' | 'processing' | 'error'
  const [stagedFile, setStagedFile] = useState<File | null>(null)
  const [attachmentPhase, setAttachmentPhase] = useState<AttachmentPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const uploadAbortRef = useRef<AbortController | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

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

  const name = conversation.linkedClientName || conversation.clientNameGuess || conversation.telegramUsername || 'Без имени'
  const consentGiven = conversation.consentStatus === 'GIVEN'

  const MAX_UPLOAD_MB = 50

  // Реальный прогресс — через upload() из @vercel/blob/client (onUploadProgress
  // считает по фактическим байтам, не фейковый таймер). Файл уходит напрямую
  // из браузера в Vercel Blob, а не в нашу serverless-функцию: у функций
  // Vercel жёсткий лимит тела запроса 4.5 МБ, который никак не связан с
  // Next.js (experimental.serverActions.bodySizeLimit в next.config.ts на
  // него не влияет) — при видео/больших файлах без Blob запрос падал с 413/500
  // ещё до того, как доходил до нашего кода. После загрузки в Blob сервер
  // забирает байты оттуда и пересылает в Telegram (sendConversationAttachmentFromBlob),
  // а сам blob сразу удаляется — это временный релей, не постоянное хранилище.
  async function uploadStagedFile(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const blob = await upload(`telegram/${conversation.id}/${Date.now()}-${file.name}`, file, {
        access: 'private',
        handleUploadUrl: '/api/telegram/blob-upload',
        contentType: file.type || undefined,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
      })
      return { ok: true, url: blob.url }
    } catch (e) {
      if (controller.signal.aborted) return { ok: false, error: 'Загрузка отменена' }
      return { ok: false, error: e instanceof Error ? e.message : 'Не удалось загрузить файл' }
    } finally {
      uploadAbortRef.current = null
    }
  }

  async function handleSend() {
    if (sending || attachmentPhase === 'uploading' || attachmentPhase === 'processing') return
    const text = messageText.trim()

    if (stagedFile) {
      setAttachmentPhase('uploading')
      setUploadProgress(0)
      setAttachmentError(null)
      const uploadResult = await uploadStagedFile(stagedFile)
      if (!uploadResult.ok) {
        setAttachmentPhase('error')
        setAttachmentError(uploadResult.error)
        return
      }

      // Байты уже в Blob — дальше сервер сам читает их оттуда и шлёт в
      // Telegram; с клиента тут прогресс отслеживать больше нечем.
      setAttachmentPhase('processing')
      const sendResult = await sendConversationAttachmentFromBlob(conversation.id, {
        blobUrl: uploadResult.url,
        fileName: stagedFile.name,
        mimeType: stagedFile.type || 'application/octet-stream',
        caption: text || undefined,
      })
      if (sendResult.ok) {
        setStagedFile(null)
        setAttachmentPhase('idle')
        setUploadProgress(0)
        setMessageText('')
        router.refresh()
      } else {
        setAttachmentPhase('error')
        setAttachmentError(sendResult.error)
      }
      return
    }

    if (!text) return
    setSending(true)
    setMessageText('')
    const result = await sendConversationMessage(conversation.id, text)
    setSending(false)
    if (!result.ok) setActionError(result.error)
    router.refresh()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function stageFile(file: File) {
    setUploadProgress(0)
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setStagedFile(file)
      setAttachmentPhase('error')
      setAttachmentError(`Файл больше ${MAX_UPLOAD_MB} МБ — Telegram не примет его от бота`)
      return
    }
    setStagedFile(file)
    setAttachmentPhase('staged')
    setAttachmentError(null)
  }

  function handleRemoveStagedFile() {
    if (attachmentPhase === 'uploading') uploadAbortRef.current?.abort()
    setStagedFile(null)
    setAttachmentPhase('idle')
    setUploadProgress(0)
    setAttachmentError(null)
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) stageFile(file)
    e.target.value = '' // чтобы повторный выбор того же файла тоже сработал
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) stageFile(file)
  }

  async function handleRetry(messageId: string) {
    await retryFailedMessage(messageId)
    router.refresh()
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

  async function handleCreateClient(force = false) {
    const result = await createClientFromConversation(conversation.id, force)
    if (result.ok) {
      router.refresh()
    } else if (result.error === 'duplicate' && 'duplicate' in result && result.duplicate) {
      setDuplicateClient(result.duplicate)
    } else {
      setActionError(result.error)
    }
  }

  async function handleAddNote() {
    const text = noteText.trim()
    if (!text) return
    setNoteText('')
    const result = await addInternalNote(conversation.id, text)
    if (result.ok) router.refresh()
  }

  const dateGroups = groupByDate(messages)

  return (
    // h-screen, а не h-full: родительский <main> в AdminLayout — min-h-screen
    // (не h-screen), поэтому h-full от него не даёт надёжную границу высоты.
    // Без явной границы flex-1 ниже не сжимается, а раздвигает всю страницу,
    // и нижняя панель ввода "уезжает" вниз за пределы экрана.
    <div className="flex h-screen">
      <div
        className="flex-1 flex flex-col min-w-0 min-h-0 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 z-50 bg-[#00c26b]/10 border-2 border-dashed border-[#00c26b]/60 rounded-lg flex items-center justify-center pointer-events-none">
            <p className="text-[#00c26b] font-medium">Отпустите файл, чтобы прикрепить</p>
          </div>
        )}
        {/* Верхняя панель */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/admin/telegram" className="text-zinc-500 hover:text-zinc-200 flex-shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-semibold truncate">{name}</p>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TELEGRAM_STATUS_COLORS[conversation.status]}`}>
                  {TELEGRAM_STATUS_LABELS[conversation.status]}
                </span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-400">
                  {TELEGRAM_CONSENT_STATUS_LABELS[conversation.consentStatus]}
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

        {/* Лента сообщений — flex-1 + min-h-0 вместо фиксированного max-h:
            сама сжимается, когда нижняя панель растёт (прикреплённый файл,
            многострочный текст), и никогда не перекрывается панелью ввода. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-10">Сообщений пока нет</p>
          ) : (
            dateGroups.map(group => (
              <div key={group.label} className="space-y-3">
                <p className="text-zinc-600 text-[11px] text-center uppercase tracking-wider">{group.label}</p>
                {group.items.map(m => {
                  if (m.senderType === 'SYSTEM') {
                    return (
                      <p key={m.id} className="text-zinc-500 text-xs text-center">{m.text}</p>
                    )
                  }
                  const isOutbound = m.direction === 'OUTBOUND'
                  return (
                    <div key={m.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        isOutbound ? 'bg-[#00c26b]/15 border border-[#00c26b]/30 text-zinc-100' : 'bg-zinc-800 border border-zinc-700 text-zinc-100'
                      }`}>
                        {m.senderType === 'BOT' && <p className="text-[10px] text-zinc-500 mb-0.5">Автоматически</p>}
                        {m.senderType === 'ADMIN' && m.senderName && <p className="text-[10px] text-zinc-500 mb-0.5">{m.senderName}</p>}
                        {m.attachment && (
                          <div className="mb-1.5">
                            <MessageAttachment message={m} onOpenLightbox={setLightboxUrl} />
                          </div>
                        )}
                        {(!m.attachment || (m.text && !ATTACHMENT_PLACEHOLDER_TEXTS.includes(m.text))) && (
                          <p className="whitespace-pre-wrap break-words">{m.text || '(без текста)'}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1">
                          <p className="text-zinc-500 text-[11px]">{format(parseISO(m.createdAt), 'HH:mm')}</p>
                          {isOutbound && (
                            <>
                              <span className="text-zinc-600 text-[11px]">·</span>
                              <span className={`text-[11px] ${m.status === 'FAILED' ? 'text-red-400' : 'text-zinc-500'}`}>
                                {TELEGRAM_MESSAGE_STATUS_LABELS[m.status]}
                              </span>
                              {m.status === 'FAILED' && (
                                <button type="button" onClick={() => handleRetry(m.id)} className="text-red-400 hover:text-red-300">
                                  <RotateCcw className="w-3 h-3" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Нижняя панель — единый закреплённый блок: ошибка / прикреплённый
            файл с прогрессом / строка ввода. Фото/документ/видео — через
            скрепку или drag-and-drop (текст рядом становится подписью);
            emoji/reply/forward — Этап C2. */}
        <div className="border-t border-zinc-800 flex-shrink-0">
          {actionError && (
            <p className="mx-4 sm:mx-6 mt-3 text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{actionError}</p>
          )}

          {stagedFile && (
            <div className="mx-4 sm:mx-6 mt-3 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                <p className="text-zinc-200 text-xs truncate flex-1 min-w-0">{stagedFile.name}</p>
                <p className="text-zinc-500 text-[11px] flex-shrink-0">{formatFileSize(stagedFile.size)}</p>
                <button type="button" onClick={handleRemoveStagedFile} title="Убрать файл" className="text-zinc-500 hover:text-zinc-200 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {attachmentPhase === 'uploading' && (
                <div className="space-y-1">
                  <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00c26b] transition-[width] duration-150" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-zinc-500 text-[11px]">Загрузка: {uploadProgress}%</p>
                </div>
              )}
              {attachmentPhase === 'processing' && (
                <p className="text-zinc-500 text-[11px] flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Отправка в Telegram...
                </p>
              )}
              {attachmentPhase === 'staged' && (
                <p className="text-zinc-500 text-[11px]">Готово к отправке</p>
              )}
              {attachmentPhase === 'error' && (
                <p className="text-red-400 text-[11px]">Ошибка загрузки{attachmentError ? `: ${attachmentError}` : ''}</p>
              )}
            </div>
          )}

          <div className="px-4 sm:px-6 py-3 flex items-end gap-2 sm:gap-3">
            <input ref={fileInputRef} type="file" hidden onChange={handleFileInputChange} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachmentPhase === 'uploading' || attachmentPhase === 'processing'}
              title="Прикрепить файл"
              className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40 p-2.5 rounded-lg flex-shrink-0 transition-colors"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <textarea
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={stagedFile ? 'Подпись к файлу (необязательно)...' : 'Написать сообщение...'}
              rows={2}
              className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || attachmentPhase === 'uploading' || attachmentPhase === 'processing' || (!messageText.trim() && !stagedFile)}
              className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white p-2.5 rounded-lg transition-colors flex-shrink-0"
            >
              {attachmentPhase === 'uploading' || attachmentPhase === 'processing' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
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
          {conversation.linkedClientId ? (
            <Link href={`/admin/clients/${conversation.linkedClientId}`} className="flex items-center gap-1.5 text-sm text-[#00c26b] hover:underline">
              {conversation.linkedClientName} <ExternalLink className="w-3 h-3" />
            </Link>
          ) : (
            <div className="space-y-2">
              <button type="button" onClick={() => handleCreateClient(false)}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">
                <UserPlus className="w-3.5 h-3.5" /> Создать клиента
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
                  <p className="text-amber-300 text-xs">Похоже, клиент уже есть: <strong>{duplicateClient.name}</strong></p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleLinkClient(duplicateClient.id)}
                      className="text-xs text-[#00c26b] hover:underline">Связать</button>
                    <button type="button" onClick={() => handleCreateClient(true)}
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

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-8"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- прокси-роут, не статичный ассет */}
          <img src={lightboxUrl} alt="Фото" className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
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
