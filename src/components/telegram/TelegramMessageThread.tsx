'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { format, parseISO, isSameDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import { FileText, ImageOff, RotateCcw, Check, Download } from 'lucide-react'
import type { TelegramMessageDTO } from '@/lib/actions/telegram'
import { TELEGRAM_MESSAGE_STATUS_LABELS } from '@/lib/telegram-model'
import { formatFileSize, formatDuration } from '@/lib/telegram-ui-utils'
import Lightbox from './Lightbox'

// И полный раздел Telegram (ConversationView), и встроенная панель в
// карточке клиента (ClientTelegramPanel) пересоздают этот компонент заново
// (remount по key={dataKey}/key={telegramKey} у родителя) при КАЖДОМ новом
// сообщении — не только раз в 10 секунд поллингом, см. комментарий в
// соответствующих page.tsx. Обычный useRef/useState при этом обнулился бы
// вместе с позицией скролла, и чат каждый раз дёргало бы к прочитанной ранее
// точке или к самому верху — именно то дребезжание, которое просили убрать.
// Модульная (не React) Map переживает такие remount'ы в рамках одной вкладки
// браузера, но естественно очищается при настоящей перезагрузке страницы —
// то есть именно то поведение, которое нужно ("при первом открытии — всегда
// вниз", но не при каждом новом сообщении, если админ листает историю).
const scrollMemory = new Map<string, { scrollTop: number; lastMessageId: string | null }>()
const STICK_TO_BOTTOM_THRESHOLD_PX = 120

// Экспортируется для ClientTelegramPanel: когда встроенную панель сворачивают
// (не просто remount от нового сообщения, а осознанное "скрыть"), она
// полностью размонтируется — но scrollMemory как модульная переменная это
// пережила бы и при следующем разворачивании подставила бы старую позицию
// скролла, а не показала последнее сообщение (см. ТЗ: "при раскрытии панели
// из свёрнутого состояния — скролл к последнему сообщению"). Вызывается перед
// сворачиванием, чтобы следующее монтирование прошло по ветке "первое
// открытие" в эффекте ниже.
export function forgetScrollPosition(conversationId: string) {
  scrollMemory.delete(conversationId)
}

// Совпадает с ATTACHMENT_FALLBACK_LABEL в src/app/api/telegram/webhook/route.ts
// — если text равен одной из этих подписей, значит у сообщения не было
// собственной подписи (caption), и повторно показывать её под вложением не нужно.
const ATTACHMENT_PLACEHOLDER_TEXTS = [
  '📷 Фото', '📄 Документ', '🎤 Голосовое сообщение', '🎬 Видео', '🎭 Стикер', '⭕ Видео-кружок', '🎵 Аудио',
]

// Пока идёт запрос к прокси-роуту — скелетон; если запрос упал (битый
// file_id, рассинхрон Content-Length и т.п.) — аккуратная плашка вместо
// сломанной иконки браузера.
function PhotoAttachment({ url, alt, size = 'md', rounded = false, onOpen, onMediaLoad }: {
  url: string; alt: string; size?: 'sm' | 'md'; rounded?: boolean; onOpen?: () => void; onMediaLoad?: () => void
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  if (status === 'error') {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-black/20 text-zinc-500 ${rounded ? 'rounded-full' : 'rounded-lg'} ${size === 'sm' ? 'w-24 h-24' : 'w-[220px] min-h-[120px] p-3'}`}>
        <ImageOff className="w-5 h-5 flex-shrink-0" />
        {!rounded && <span className="text-[10px] text-center">Не удалось загрузить изображение</span>}
      </div>
    )
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- прокси-роут, не статичный ассет
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={`${size === 'sm' ? 'w-24 h-24 object-cover' : 'w-full h-auto'} ${status === 'loading' ? 'opacity-0' : 'opacity-100'} transition-opacity duration-150`}
      onLoad={() => { setStatus('loaded'); onMediaLoad?.() }}
      onError={() => setStatus('error')}
    />
  )

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen || status !== 'loaded'}
      className={`relative block overflow-hidden bg-zinc-800/60 ${rounded ? 'rounded-full' : 'rounded-lg'} ${size === 'sm' ? 'w-24 h-24' : 'w-[220px] min-h-[120px]'} ${onOpen && status === 'loaded' ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {status === 'loading' && <div className={`absolute inset-0 animate-pulse bg-zinc-700/50 ${rounded ? 'rounded-full' : ''}`} />}
      {image}
    </button>
  )
}

function MessageAttachment({ message, onOpenLightbox, onMediaLoad }: {
  message: TelegramMessageDTO; onOpenLightbox: (url: string) => void; onMediaLoad: () => void
}) {
  const a = message.attachment
  if (!a) return null

  if (message.messageType === 'PHOTO') {
    return <PhotoAttachment url={a.fileUrl} alt="Фото" onOpen={() => onOpenLightbox(a.fileUrl)} onMediaLoad={onMediaLoad} />
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
  if (message.messageType === 'VOICE' || message.messageType === 'AUDIO') {
    return (
      <div className="flex items-center gap-2">
        <audio controls src={a.fileUrl} className="max-w-[220px] h-8" onLoadedMetadata={onMediaLoad} />
        {a.duration != null && <span className="text-zinc-500 text-[11px] flex-shrink-0">{formatDuration(a.duration)}</span>}
      </div>
    )
  }
  if (message.messageType === 'VIDEO') {
    return (
      <div className="space-y-1.5">
        <video controls src={a.fileUrl} className="max-w-[240px] max-h-[320px] rounded-lg bg-black" onLoadedMetadata={onMediaLoad} />
        <a
          href={a.downloadUrl}
          title="Скачать видео"
          className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 bg-black/20 hover:bg-black/30 rounded-md px-2 py-1 transition-colors"
        >
          <Download className="w-3 h-3" /> Скачать
        </a>
      </div>
    )
  }
  if (message.messageType === 'VIDEO_NOTE') {
    // "Кружочек" — Telegram-клиент показывает круглое видео; воспроизведение
    // через нативный <video> внутри круглой рамки (rounded-full + object-cover).
    return <video controls src={a.fileUrl} className="w-40 h-40 rounded-full object-cover bg-black" onLoadedMetadata={onMediaLoad} />
  }
  if (message.messageType === 'STICKER') {
    return a.isAnimatedSticker ? (
      <div className="w-20 h-20 flex items-center justify-center text-3xl bg-black/20 rounded-lg">🎭</div>
    ) : (
      <PhotoAttachment url={a.fileUrl} alt="Стикер" size="sm" onMediaLoad={onMediaLoad} />
    )
  }
  return null
}

// Визуальное эхо inline-кнопки «Согласиться», которую реально видит клиент в
// Telegram — не интерактивный элемент (клик тут ничего не делает: согласие
// может дать только сам клиент нажатием в Telegram), просто помогает
// администратору увидеть, отправлена ли кнопка и нажал ли клиент её, не
// открывая сам Telegram. cursor-default вместо pointer — намеренно, чтобы не
// создавать видимость кликабельности.
function ConsentButtonPreview({ given }: { given: boolean }) {
  return (
    <button
      type="button"
      disabled={given}
      tabIndex={-1}
      title={given ? 'Клиент уже нажал эту кнопку в Telegram' : 'Клиент ещё не нажал эту кнопку в Telegram'}
      className={`mt-2 flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-colors cursor-default ${
        given ? 'bg-zinc-700/50 text-zinc-400' : 'bg-[#00c26b] hover:bg-[#00b360] text-white'
      }`}
    >
      {given && <Check className="w-3.5 h-3.5" />}
      Согласиться
    </button>
  )
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

interface TelegramMessageThreadProps {
  // Ключ для scrollMemory (см. комментарий у неё выше) — обязателен, иначе
  // позицию скролла невозможно правильно связать с конкретным диалогом.
  conversationId: string
  messages: TelegramMessageDTO[]
  consentRequestMessageId?: string | null
  consentGiven?: boolean
  onRetry: (messageId: string) => void
  emptyLabel?: string
  // Id сообщения, к которому нужно проскроллить и на 1-2 секунды подсветить —
  // используется при переходе "Показать в чате" из панели вложений. Компонент
  // сам скроллит/подсвечивает/снимает подсветку, родителю достаточно один раз
  // выставить значение (обнулять необязательно).
  highlightMessageId?: string | null
  compact?: boolean
}

export default function TelegramMessageThread({
  conversationId, messages, consentRequestMessageId = null, consentGiven = false, onRetry, emptyLabel = 'Сообщений пока нет',
  highlightMessageId, compact = false,
}: TelegramMessageThreadProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // "Приклеен ли" низ ленты — пока true, новое сообщение/догрузка медиа сами
  // держат скролл внизу; как только админ вручную отскроллил вверх читать
  // историю, становится false и мы больше не дёргаем его скролл, пока он не
  // вернётся к низу сам или не отправит/не получит новое сообщение, требующее
  // принудительного скролла (см. эффект ниже).
  const stickToBottomRef = useRef(true)

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }

  function persistScrollMemory() {
    const el = containerRef.current
    if (!el) return
    scrollMemory.set(conversationId, { scrollTop: el.scrollTop, lastMessageId: messages[messages.length - 1]?.id ?? null })
  }

  function handleContainerScroll() {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom < STICK_TO_BOTTOM_THRESHOLD_PX
    persistScrollMemory()
  }

  // Вызывается, когда позже догружается фото/видео/аудио и меняет высоту
  // уже отрисованного сообщения — держим низ ленты внизу, только если мы там
  // и так были (stickToBottomRef), а не "прыгаем" туда, если админ читает
  // историю выше и там же случайно догрузилась превьюшка старого сообщения.
  function maybeScrollToBottom() {
    if (stickToBottomRef.current) scrollToBottom()
  }

  // useLayoutEffect, а не useEffect — синхронно до отрисовки кадра, чтобы при
  // remount'е (см. комментарий у scrollMemory) админ не увидел на долю секунды
  // "прыжок" от scrollTop=0 к восстановленной позиции.
  useLayoutEffect(() => {
    const el = containerRef.current
    const last = messages.length > 0 ? messages[messages.length - 1] : null
    const remembered = scrollMemory.get(conversationId)
    // Новое исходящее сообщение (администратор только что отправил, включая
    // случай, когда это произошло уже после того, как он листал историю
    // вверх) — всегда показываем его, это прямое следствие его действия.
    const isNewOutbound = !!last && last.direction === 'OUTBOUND' && last.id !== remembered?.lastMessageId

    if (!remembered || isNewOutbound) {
      stickToBottomRef.current = true
      scrollToBottom()
    } else if (el) {
      el.scrollTop = remembered.scrollTop
      const distanceFromBottom = el.scrollHeight - remembered.scrollTop - el.clientHeight
      stickToBottomRef.current = distanceFromBottom < STICK_TO_BOTTOM_THRESHOLD_PX
    }

    persistScrollMemory()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- запускается один раз на монтирование этого экземпляра (см. scrollMemory)
  }, [conversationId])

  // setHighlighted(...) отложен через setTimeout(…, 0) вместо прямого вызова —
  // react-hooks/set-state-in-effect не разрешает синхронный setState в теле
  // эффекта; сама подсветка при этом визуально мгновенна (задержка в один тик).
  useEffect(() => {
    if (!highlightMessageId) return
    const el = containerRef.current?.querySelector(`[data-message-id="${highlightMessageId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Переход "Показать в чате" — осознанный прыжок к конкретной точке
    // истории, не к низу; не позволяем следующему сообщению тут же
    // принудительно утащить обратно вниз.
    stickToBottomRef.current = false
    const showTimer = setTimeout(() => setHighlighted(highlightMessageId), 0)
    const hideTimer = setTimeout(() => setHighlighted(null), 2000)
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer) }
  }, [highlightMessageId])

  const dateGroups = groupByDate(messages)

  return (
    <div ref={containerRef} onScroll={handleContainerScroll} className={`flex-1 min-h-0 overflow-y-auto space-y-4 ${compact ? 'px-3 py-3' : 'px-6 py-4'}`}>
      {messages.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center py-10">{emptyLabel}</p>
      ) : (
        dateGroups.map(group => (
          <div key={group.label} className="space-y-3">
            <p className="text-zinc-600 text-[11px] text-center uppercase tracking-wider">{group.label}</p>
            {group.items.map(m => {
              if (m.senderType === 'SYSTEM') {
                return (
                  <p key={m.id} data-message-id={m.id} className="text-zinc-500 text-xs text-center">{m.text}</p>
                )
              }
              const isOutbound = m.direction === 'OUTBOUND'
              return (
                <div key={m.id} data-message-id={m.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} transition-colors rounded-lg ${highlighted === m.id ? 'ring-2 ring-[#00c26b] ring-offset-2 ring-offset-zinc-950' : ''}`}>
                  <div className={`${compact ? 'max-w-[85%]' : 'max-w-[70%]'} rounded-lg px-3 py-2 text-sm ${
                    isOutbound ? 'bg-[#00c26b]/15 border border-[#00c26b]/30 text-zinc-100' : 'bg-zinc-800 border border-zinc-700 text-zinc-100'
                  }`}>
                    {m.senderType === 'BOT' && <p className="text-[10px] text-zinc-500 mb-0.5">Автоматически</p>}
                    {m.senderType === 'ADMIN' && m.senderName && <p className="text-[10px] text-zinc-500 mb-0.5">{m.senderName}</p>}
                    {m.attachment && (
                      <div className="mb-1.5">
                        <MessageAttachment message={m} onOpenLightbox={setLightboxUrl} onMediaLoad={maybeScrollToBottom} />
                      </div>
                    )}
                    {(!m.attachment || (m.text && !ATTACHMENT_PLACEHOLDER_TEXTS.includes(m.text))) && (
                      <p className="whitespace-pre-wrap break-words">{m.text || '(без текста)'}</p>
                    )}
                    {m.telegramMessageId && m.telegramMessageId === consentRequestMessageId && (
                      <ConsentButtonPreview given={consentGiven} />
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
                            <button type="button" onClick={() => onRetry(m.id)} className="text-red-400 hover:text-red-300">
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

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}
