'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { computeEditorAllTimeSummary, computeEditorMonthlyStats, type EditorAllTimeSummary, type EditorMonthlyStats } from '@/lib/montage-model'

async function requireStaffSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { ok: false, error: 'Требуется авторизация' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Требуется авторизация' }
  }
}

function revalidateEditorPaths(): void {
  revalidatePath('/admin/editing')
}

export interface EditorProfileDTO {
  id: string
  userId: string | null
  firstName: string | null
  lastName: string | null
  displayName: string
  phone: string | null
  telegram: string | null
  email: string | null
  specialization: string | null
  notes: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

// Сводка за всё время — считается ОДНОЙ и той же функцией
// (computeEditorAllTimeSummary, montage-model.ts), что и в детальной
// карточке монтажёра, поэтому цифры в списке и в карточке никогда не
// расходятся (тот же принцип, что computeMontageDashboardStats для дашборда).
export interface EditorProfileListItemDTO extends EditorProfileDTO {
  summary: EditorAllTimeSummary
}

function toDTO(row: {
  id: string; userId: string | null; firstName: string | null; lastName: string | null; displayName: string
  phone: string | null; telegram: string | null; email: string | null; specialization: string | null
  notes: string | null; active: boolean; createdAt: Date; updatedAt: Date
}): EditorProfileDTO {
  return {
    id: row.id,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    phone: row.phone,
    telegram: row.telegram,
    email: row.email,
    specialization: row.specialization,
    notes: row.notes,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ============================================================
// СПИСОК МОНТАЖЁРОВ (вкладка "Монтажёры", ТЗ п.8) — с готовой сводкой за всё
// время для каждого, чтобы список сразу показывал доход/прибыль/загрузку
// без дополнительного клика в карточку.
// ============================================================

export async function getAllEditorProfiles(): Promise<
  { ok: true; data: EditorProfileListItemDTO[] } | { ok: false; data: EditorProfileListItemDTO[]; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: [], error: authResult.error }

  try {
    const rows = await prisma.editorProfile.findMany({
      orderBy: { displayName: 'asc' },
      include: {
        projects: {
          select: { status: true, clientAmount: true, editorAmount: true, editorPaymentStatus: true, sourceReceivedAt: true, deliveredAt: true, deadlineDate: true },
        },
      },
    })
    const data = rows.map(row => ({
      ...toDTO(row),
      summary: computeEditorAllTimeSummary(row.projects),
    }))
    return { ok: true, data }
  } catch (e) {
    console.error('[getAllEditorProfiles]', e)
    return { ok: false, data: [], error: 'Не удалось загрузить список монтажёров' }
  }
}

export interface EditorProfileDetailDTO extends EditorProfileDTO {
  summary: EditorAllTimeSummary
}

export async function getEditorProfileDetail(id: string): Promise<
  { ok: true; data: EditorProfileDetailDTO } | { ok: false; data: null; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: null, error: authResult.error }

  try {
    const row = await prisma.editorProfile.findUnique({
      where: { id },
      include: {
        projects: {
          select: { status: true, clientAmount: true, editorAmount: true, editorPaymentStatus: true, sourceReceivedAt: true, deliveredAt: true, deadlineDate: true },
        },
      },
    })
    if (!row) return { ok: false, data: null, error: 'Монтажёр не найден' }

    return { ok: true, data: { ...toDTO(row), summary: computeEditorAllTimeSummary(row.projects) } }
  } catch (e) {
    console.error('[getEditorProfileDetail]', e)
    return { ok: false, data: null, error: 'Не удалось загрузить карточку монтажёра' }
  }
}

// Помесячная аналитика (ТЗ п.9) — отдельный вызов по требованию (выбор
// месяца в карточке), не тянется вместе со всем списком монтажёров.
export async function getEditorMonthlyStats(id: string, monthKey: string): Promise<
  { ok: true; data: EditorMonthlyStats } | { ok: false; data: null; error: string }
> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, data: null, error: authResult.error }

  try {
    const projects = await prisma.montageProject.findMany({
      where: { editorId: id },
      select: { status: true, clientAmount: true, editorAmount: true, editorPaymentStatus: true, sourceReceivedAt: true, deliveredAt: true, deadlineDate: true },
    })
    return { ok: true, data: computeEditorMonthlyStats(projects, monthKey) }
  } catch (e) {
    console.error('[getEditorMonthlyStats]', e)
    return { ok: false, data: null, error: 'Не удалось посчитать помесячную аналитику' }
  }
}

// ============================================================
// СОЗДАТЬ / ОБНОВИТЬ МОНТАЖЁРА
// ============================================================

export interface EditorProfileInput {
  userId?: string | null
  firstName?: string
  lastName?: string
  displayName: string
  phone?: string
  telegram?: string
  email?: string
  specialization?: string
  notes?: string
  active?: boolean
}

export async function createEditorProfile(
  input: EditorProfileInput
): Promise<{ ok: true; data: EditorProfileDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  const displayName = input.displayName.trim()
  if (!displayName) return { ok: false, error: 'Укажите имя монтажёра' }

  try {
    const created = await prisma.editorProfile.create({
      data: {
        userId: input.userId ?? null,
        firstName: input.firstName?.trim() || null,
        lastName: input.lastName?.trim() || null,
        displayName,
        phone: input.phone?.trim() || null,
        telegram: input.telegram?.trim() || null,
        email: input.email?.trim() || null,
        specialization: input.specialization?.trim() || null,
        notes: input.notes?.trim() || null,
        active: input.active ?? true,
      },
    })
    revalidateEditorPaths()
    return { ok: true, data: toDTO(created) }
  } catch (e) {
    console.error('[createEditorProfile]', e)
    return { ok: false, error: 'Не удалось создать монтажёра' }
  }
}

export async function updateEditorProfile(
  id: string, input: Partial<EditorProfileInput>
): Promise<{ ok: true; data: EditorProfileDTO } | { ok: false; error: string }> {
  const authResult = await requireStaffSession()
  if (!authResult.ok) return { ok: false, error: authResult.error }

  try {
    const updated = await prisma.editorProfile.update({
      where: { id },
      data: {
        userId: input.userId !== undefined ? input.userId : undefined,
        firstName: input.firstName !== undefined ? (input.firstName.trim() || null) : undefined,
        lastName: input.lastName !== undefined ? (input.lastName.trim() || null) : undefined,
        displayName: input.displayName !== undefined ? (input.displayName.trim() || undefined) : undefined,
        phone: input.phone !== undefined ? (input.phone.trim() || null) : undefined,
        telegram: input.telegram !== undefined ? (input.telegram.trim() || null) : undefined,
        email: input.email !== undefined ? (input.email.trim() || null) : undefined,
        specialization: input.specialization !== undefined ? (input.specialization.trim() || null) : undefined,
        notes: input.notes !== undefined ? (input.notes.trim() || null) : undefined,
        active: input.active ?? undefined,
      },
    })
    revalidateEditorPaths()
    return { ok: true, data: toDTO(updated) }
  } catch (e) {
    console.error('[updateEditorProfile]', e)
    return { ok: false, error: 'Не удалось обновить монтажёра' }
  }
}
