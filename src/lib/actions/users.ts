'use server'

// Список/создание сотрудников платформы (User) — сейчас нужен только как
// источник для выбора участников SMM-проекта (SmmProjectMember.userId, см.
// actions/smm.ts), но не SMM-специфичен: /admin/team — заглушка ("раздел в
// разработке"), эта же функция станет её основой позже, а не второй копией.
// НЕ система приглашений/аутентификации — пароль не устанавливается здесь
// (User.password уже nullable в схеме именно для этого случая, см. комментарий
// у EditorProfile.userId в schema.prisma: "монтажёр получит отдельный аккаунт
// позже"), создаётся только именованная запись, которую можно выбрать в
// списках. Настоящий флоу выдачи доступа — отдельная будущая задача.

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import type { Role } from '@prisma/client'

async function requireStaffSession(): Promise<{ ok: true; userId: string | null } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    return { ok: true, userId: session.user.id ?? null }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

export interface StaffUserDTO {
  id: string
  name: string | null
  email: string
  role: Role
}

// Все сотрудники, кроме роли CLIENT — тот же критерий, что уже используется
// для доступа в админ-раздел ((admin)/layout.tsx: "role !== CLIENT").
export async function getStaffUsers(): Promise<{ ok: true; data: StaffUserDTO[] } | { ok: false; data: StaffUserDTO[]; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }
  try {
    const rows = await prisma.user.findMany({
      where: { role: { not: 'CLIENT' } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    })
    return { ok: true, data: rows }
  } catch (e) {
    console.error('[getStaffUsers]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить список сотрудников' }
  }
}

export interface CreateStaffUserInput {
  name: string
  email: string
  role: Role
}

export async function createStaffUser(input: CreateStaffUserInput): Promise<{ ok: true; data: StaffUserDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }
  if (!input.name.trim()) return { ok: false, error: 'Укажите имя сотрудника' }
  if (!input.email.trim()) return { ok: false, error: 'Укажите email сотрудника' }
  try {
    const created = await prisma.user.create({
      data: { name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role },
      select: { id: true, name: true, email: true, role: true },
    })
    revalidatePath('/admin/team')
    revalidatePath('/admin/smm')
    return { ok: true, data: created }
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return { ok: false, error: 'Сотрудник с таким email уже существует' }
    }
    console.error('[createStaffUser]', e)
    return { ok: false, error: 'Не удалось создать сотрудника' }
  }
}
