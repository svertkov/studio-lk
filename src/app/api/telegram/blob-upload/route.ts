import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { auth } from '@/auth'

const TELEGRAM_BOT_UPLOAD_LIMIT_MB = 50 // лимит самого Telegram на загрузку файла ботом через multipart

// Токен-роут для прямой загрузки файла из браузера в Vercel Blob, минуя нашу
// serverless-функцию (у неё жёсткий лимит тела запроса 4.5 МБ на платформе
// Vercel — обходится только так). Сама пересылка байтов в Telegram
// происходит отдельно, в sendConversationAttachmentFromBlob, после того как
// клиент получит обратно URL загруженного файла.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const session = await auth()
        if (!session?.user || !['OWNER', 'ADMIN'].includes(session.user.role)) {
          throw new Error('Доступ к разделу Telegram есть только у владельца и администратора')
        }
        return {
          maximumSizeInBytes: TELEGRAM_BOT_UPLOAD_LIMIT_MB * 1024 * 1024,
        }
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось выдать токен загрузки' }, { status: 400 })
  }
}
