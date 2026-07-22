import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// Сессия может пережить удаление/замену пользователя (протухший JWT) — тогда
// session.user.id не совпадёт ни с одной строкой User, и запись FK-поля
// (createdById/confirmedById и т.п.) упадёт с P2003 без этой проверки. Не
// блокируем саму операцию из-за качества данных сессии — только не
// проставляем автора, если он не подтверждён. Раньше была локальная копия
// только в documents.ts — теперь общий helper (AGENTS.md, правило 4).
export async function resolveValidUserId(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string | null
): Promise<string | null> {
  if (!userId) return null
  const exists = await client.user.findUnique({ where: { id: userId }, select: { id: true } })
  return exists ? userId : null
}

// Единая запись в AuditLog — раньше copy-paste в clients.ts/schedule.ts/
// telegram.ts/subscriptions.ts/client-import.ts (одинаковый try/catch, разный
// только entityType). Документы — первое место, где снова понадобился этот
// же helper, поэтому вынесен сюда один раз (см. AGENTS.md, правило 4).
// try/catch внутри — намеренно: аудит не должен блокировать основную
// операцию, если запись лога не удалась.
//
// 2026-07-22: обнаружено, что userId здесь передавался КАК ЕСТЬ, без
// resolveValidUserId — в отличие от полей самой сущности (createdById и
// т.п.), которые вызывающий код уже резолвит отдельно. Если сессия пережила
// удаление пользователя (тот же протухший JWT, о котором предупреждает
// комментарий выше), `auditLog.create` падал на `cms_audit_log_user_id_fkey`
// — и запись аудита ТИХО терялась целиком (try/catch её проглатывал), вместо
// того чтобы сохраниться хотя бы с userId=null. Резолвим здесь же, один раз,
// а не в каждом вызывающем месте — иначе пришлось бы помнить сделать это в
// каждом из уже полутора десятков call site'ов.
export async function writeAuditLog(params: {
  userId: string | null
  action: string
  entityType: string
  entityId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const validUserId = await resolveValidUserId(prisma, params.userId)
    await prisma.auditLog.create({
      data: {
        userId: validUserId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
  } catch {
    // Не блокируем основную операцию, если лог не записался
  }
}
