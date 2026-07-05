import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getTelegramFileInfo, getTelegramFileDownloadUrl } from '@/lib/telegram'

// Прокси вложений Telegram: файл не хранится у нас, поэтому здесь на каждый
// запрос заново получаем свежий file_path через getFile и стримим байты —
// раскрывать зрителю прямую ссылку на api.telegram.org (с токеном бота
// внутри URL) нельзя, поэтому браузер всегда обращается только к этому роуту.
const TELEGRAM_BOT_DOWNLOAD_LIMIT_MB = 20 // жёсткий лимит самого Telegram на скачивание файлов ботом

export async function GET(req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const session = await auth()
  if (!session?.user || !['OWNER', 'ADMIN'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 })
  }

  const { attachmentId } = await params
  const attachment = await prisma.telegramMessageAttachment.findUnique({ where: { id: attachmentId } })
  if (!attachment) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

  const settings = await prisma.telegramSettings.findUnique({ where: { id: 'singleton' } })
  const maxMb = Math.min(settings?.maxAttachmentSizeMb ?? TELEGRAM_BOT_DOWNLOAD_LIMIT_MB, TELEGRAM_BOT_DOWNLOAD_LIMIT_MB)
  if (attachment.fileSize && attachment.fileSize > maxMb * 1024 * 1024) {
    return NextResponse.json({ error: 'Файл слишком большой для скачивания через бота' }, { status: 413 })
  }

  const fileInfo = await getTelegramFileInfo(attachment.telegramFileId)
  if (!fileInfo?.file_path) {
    return NextResponse.json({ error: 'Не удалось получить файл из Telegram' }, { status: 502 })
  }

  try {
    const fileRes = await fetch(getTelegramFileDownloadUrl(fileInfo.file_path))
    if (!fileRes.ok || !fileRes.body) {
      return NextResponse.json({ error: 'Не удалось скачать файл из Telegram' }, { status: 502 })
    }

    const headers = new Headers()
    headers.set('Content-Type', attachment.mimeType || fileRes.headers.get('content-type') || 'application/octet-stream')
    // Content-Length — из реального ответа Telegram, а не из сохранённого у
    // нас attachment.fileSize: для фото, отправленных ботом, Telegram отдаёт
    // пересжатую версию другого размера, чем исходный файл — несовпадение
    // длины тела с заголовком заставляет браузер обрывать загрузку картинки
    // как повреждённую.
    const upstreamLength = fileRes.headers.get('content-length')
    if (upstreamLength) headers.set('Content-Length', upstreamLength)
    headers.set('Cache-Control', 'private, max-age=3600')
    // Отдельная ссылка "скачать" передаёт ?download=1 — иначе файл отдаётся
    // как есть (нужно для <img>/<audio>/<video> src без принудительного
    // скачивания).
    if (req.nextUrl.searchParams.get('download') === '1') {
      const filename = encodeURIComponent(attachment.fileName || 'file')
      headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    }

    return new NextResponse(fileRes.body, { headers })
  } catch (e) {
    console.error('[telegram/file]', e)
    return NextResponse.json({ error: 'Не удалось скачать файл' }, { status: 502 })
  }
}
