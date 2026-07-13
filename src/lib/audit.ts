import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// Единая запись в AuditLog — раньше copy-paste в clients.ts/schedule.ts/
// telegram.ts/subscriptions.ts/client-import.ts (одинаковый try/catch, разный
// только entityType). Документы — первое место, где снова понадобился этот
// же helper, поэтому вынесен сюда один раз (см. AGENTS.md, правило 4).
// try/catch внутри — намеренно: аудит не должен блокировать основную
// операцию, если запись лога не удалась.
export async function writeAuditLog(params: {
  userId: string | null
  action: string
  entityType: string
  entityId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
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
