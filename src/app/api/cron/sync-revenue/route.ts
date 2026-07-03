import { NextRequest, NextResponse } from 'next/server'
import { syncRevenueSheet } from '@/lib/revenue-sync'

// Вызывается по расписанию (Vercel Cron или внешний планировщик) — без сессии
// сотрудника, поэтому защищена секретом в заголовке Authorization вместо
// обычной проверки логина. Секрет задаётся переменной окружения CRON_SECRET.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  const header = request.headers.get('authorization')
  if (!expected || header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncRevenueSheet()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
