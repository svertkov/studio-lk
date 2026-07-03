import { NextRequest, NextResponse } from 'next/server'
import { syncExpensesSheet } from '@/lib/expense-sync'

// Тот же секрет и та же защита, что и у /api/cron/sync-revenue.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  const header = request.headers.get('authorization')
  if (!expected || header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncExpensesSheet()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
