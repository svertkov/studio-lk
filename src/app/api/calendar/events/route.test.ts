import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

// Мокаем ровно две внешние зависимости роута — сессию и сам вызов Google
// Calendar — тот же принцип, что уже используется в проекте для изоляции
// чистой логики (см. vitest.config.ts: обычно тестируются только чистые
// функции; здесь — единственное исключение ради проверки конкретно
// авторизации, добавленной этим фиксом, а не полный интеграционный тест
// роута).
vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/google-calendar', () => ({ fetchCalendarEvents: vi.fn() }))

import { auth } from '@/auth'
import { fetchCalendarEvents } from '@/lib/google-calendar'
import { GET } from './route'

// `auth` в next-auth v5 типизирован как перегружаемая функция (обычный вызов
// сессии И middleware-форма) — vi.mocked() не может однозначно выбрать
// перегрузку для .mockResolvedValue(). Приводим один раз к простому Mock,
// а не подавляем типы точечно в каждом тесте.
const mockAuth = auth as unknown as Mock
const mockFetchCalendarEvents = fetchCalendarEvents as unknown as Mock

function makeRequest(): NextRequest {
  return new NextRequest('https://lk.2470.ru/api/calendar/events?calendar=all')
}

describe('GET /api/calendar/events — авторизация', () => {
  beforeEach(() => {
    mockAuth.mockReset()
    mockFetchCalendarEvents.mockReset()
  })

  it('без сессии — 401, Google Calendar не вызывается', async () => {
    mockAuth.mockResolvedValue(null)

    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Требуется авторизация' })
    expect(mockFetchCalendarEvents).not.toHaveBeenCalled()
  })

  it('роль CLIENT — 401, тот же админ-раздел ей не разрешён ((admin)/layout.tsx)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'CLIENT', email: 'c@example.com' } })

    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    expect(mockFetchCalendarEvents).not.toHaveBeenCalled()
  })

  it.each(['OWNER', 'ADMIN', 'OPERATOR', 'EDITOR'])('роль %s — доступ разрешён, формат ответа не изменился', async role => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role, email: 'staff@example.com' } })
    mockFetchCalendarEvents.mockResolvedValue([{ id: 'ev1' }])

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ events: [{ id: 'ev1' }] })
  })

  it('ошибка Google Calendar при валидной сессии — 500, как и раньше', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'OWNER', email: 'o@example.com' } })
    mockFetchCalendarEvents.mockRejectedValue(new Error('boom'))

    const res = await GET(makeRequest())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Ошибка загрузки календаря' })
  })
})
