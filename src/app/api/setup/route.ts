import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

// Временный эндпоинт для первоначальной настройки БД.
// Защищён секретом SETUP_SECRET из env. Удалить после настройки.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-setup-secret')
  if (!secret || secret !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: string[] = []

  try {
    // 1. Добавить колонку password если её нет
    await prisma.$executeRawUnsafe(`
      ALTER TABLE cms_user ADD COLUMN IF NOT EXISTS password VARCHAR(255);
    `)
    results.push('✓ Колонка password добавлена')
  } catch (e) {
    results.push(`⚠ Колонка password: ${e}`)
  }

  // 2. Создать первого администратора
  try {
    const existing = await prisma.user.findUnique({ where: { email: 'admin@2470.ru' } })
    if (existing) {
      results.push('ℹ Пользователь admin@2470.ru уже существует')
    } else {
      const hash = await bcrypt.hash('Admin2470!', 12)
      await prisma.user.create({
        data: {
          id: 'cluser0000000001',
          email: 'admin@2470.ru',
          name: 'Администратор',
          password: hash,
          role: 'OWNER',
        },
      })
      results.push('✓ Пользователь admin@2470.ru создан (пароль: Admin2470!)')
    }
  } catch (e) {
    results.push(`✗ Ошибка создания пользователя: ${e}`)
  }

  return NextResponse.json({ ok: true, results })
}
