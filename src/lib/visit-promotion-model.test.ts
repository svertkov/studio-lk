import { describe, it, expect } from 'vitest'
import {
  buildVisitPromotionPlan, detectCancellationSignal, detectSubscriptionMention, detectFreeSignal,
  type VisitPromotionInput, type ClientSnapshot,
} from './visit-promotion-model'

const CLIENT: ClientSnapshot = {
  name: 'Иван Иванов', phone: '+79991234567', telegram: '@ivan', email: 'ivan@example.com', companyName: null,
}

function makeVisit(overrides: Partial<VisitPromotionInput> = {}): VisitPromotionInput {
  return {
    id: 'visit-1',
    clientId: 'client-1',
    date: new Date('2025-06-10T00:00:00Z'),
    startAt: new Date('2025-06-10T13:00:00Z'),
    endAt: new Date('2025-06-10T15:00:00Z'),
    room: 'Светлый зал',
    format: 'Подкаст',
    durationHours: 2,
    grossAmount: 15000,
    comment: 'Обычный комментарий',
    ...overrides,
  }
}

const NOW = new Date('2026-07-12T00:00:00Z')

describe('buildVisitPromotionPlan — базовый случай', () => {
  it('creates a fully-populated order for a well-formed historical visit', () => {
    const plan = buildVisitPromotionPlan(makeVisit(), CLIENT, NOW)
    expect(plan.action).toBe('create')
    expect(plan.order).not.toBeNull()
    expect(plan.order!.clientId).toBe('client-1')
    expect(plan.order!.clientName).toBe('Иван Иванов')
    expect(plan.order!.serviceType).toBe('Подкаст')
    expect(plan.order!.room).toBe('Светлый зал')
    expect(plan.order!.durationMinutes).toBe(120)
    expect(plan.order!.plannedStartTime).toEqual(new Date('2025-06-10T13:00:00Z'))
    expect(plan.order!.comment).toBe('Обычный комментарий')
  })

  it('backdates createdAt/statusUpdatedAt/completedAt to the visit date, not now', () => {
    const plan = buildVisitPromotionPlan(makeVisit(), CLIENT, NOW)
    expect(plan.order!.createdAt).toEqual(new Date('2025-06-10T13:00:00Z'))
    expect(plan.order!.completedAt).toEqual(new Date('2025-06-10T13:00:00Z'))
  })

  it('marks a long-past completed visit as COMPLETED and archived', () => {
    const plan = buildVisitPromotionPlan(makeVisit(), CLIENT, NOW)
    expect(plan.order!.status).toBe('COMPLETED')
    expect(plan.order!.isArchived).toBe(true)
    expect(plan.order!.archiveReason).toBe('COMPLETED')
  })

  it('treats a literal "0" comment (leftover "затраты" mapping) as no comment', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ comment: '0' }), CLIENT, NOW)
    expect(plan.order!.comment).toBeNull()
  })

  it('keeps a real comment that merely starts with a digit', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ comment: '0 опозданий, всё по плану' }), CLIENT, NOW)
    expect(plan.order!.comment).toBe('0 опозданий, всё по плану')
  })

  it('skips visits with no date at all (no startAt, no date)', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ date: null, startAt: null, endAt: null }), CLIENT, NOW)
    expect(plan.action).toBe('skip_no_date')
    expect(plan.order).toBeNull()
  })

  it('falls back to date when startAt is unknown, still creates the order', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ startAt: null, endAt: null }), CLIENT, NOW)
    expect(plan.action).toBe('create')
    expect(plan.order!.plannedStartTime).toBeNull()
    expect(plan.order!.createdAt).toEqual(new Date('2025-06-10T00:00:00Z'))
  })
})

describe('buildVisitPromotionPlan — оплата', () => {
  it('known gross amount -> PAID, method unknown (not guessed)', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ grossAmount: 9000 }), CLIENT, NOW)
    expect(plan.order!.preliminaryAmount).toBe(9000)
    expect(plan.order!.paymentStatus).toBe('PAID')
    expect(plan.order!.paymentMethod).toBeNull()
  })

  it('no amount known -> NOT_SPECIFIED, not "Нет данных" fabricated as a number', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ grossAmount: null }), CLIENT, NOW)
    expect(plan.order!.preliminaryAmount).toBeNull()
    expect(plan.order!.paymentStatus).toBe('NOT_SPECIFIED')
  })

  it('"бесплатная съемка" comment -> FREE method, PAID status, amount 0 if unset', () => {
    const plan = buildVisitPromotionPlan(
      makeVisit({ grossAmount: null, comment: 'бесплатная съемка из-за косяка с фокусом' }), CLIENT, NOW,
    )
    expect(plan.order!.paymentMethod).toBe('FREE')
    expect(plan.order!.paymentStatus).toBe('PAID')
    expect(plan.order!.preliminaryAmount).toBe(0)
  })
})

describe('buildVisitPromotionPlan — акция на первый визит', () => {
  it('detects promo text and strips it from the comment, keeping the rest', () => {
    const plan = buildVisitPromotionPlan(
      makeVisit({ comment: 'Нужен дополнительный свет.\nАкция! 20% скидка на первую запись' }), CLIENT, NOW,
    )
    expect(plan.promotionDetected).toBe(true)
    expect(plan.order!.promotionType).toBe('FIRST_VISIT_20')
    expect(plan.order!.comment).toContain('Нужен дополнительный свет')
    expect(plan.order!.comment).not.toContain('Акция')
  })

  it('does not confuse an unrelated discount ("постоянному клиенту") with the first-visit promo', () => {
    const plan = buildVisitPromotionPlan(
      makeVisit({ comment: 'скидка 10% как постоянному клиенту' }), CLIENT, NOW,
    )
    expect(plan.promotionDetected).toBe(false)
    expect(plan.order!.promotionType).toBeNull()
    expect(plan.order!.comment).toBe('скидка 10% как постоянному клиенту')
  })

  it('preserves cost unaffected by promo detection — no discount math applied', () => {
    const plan = buildVisitPromotionPlan(
      makeVisit({ grossAmount: 12000, comment: 'Акция! 20% скидка на первую запись' }), CLIENT, NOW,
    )
    expect(plan.order!.preliminaryAmount).toBe(12000)
  })
})

describe('buildVisitPromotionPlan — отмена/подозрительный статус', () => {
  it('cancellation-like text keeps the order in BOOKED, not auto-COMPLETED or auto-CANCELLED', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ comment: 'клиент отменил запись' }), CLIENT, NOW)
    expect(plan.needsStatusReview).toBe(true)
    expect(plan.order!.status).toBe('BOOKED')
    expect(plan.order!.completedAt).toBeNull()
    expect(plan.order!.isArchived).toBe(false)
  })

  it('a plain comment with no cancellation signal does not trigger review', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ comment: 'Нужен суфлёр' }), CLIENT, NOW)
    expect(plan.needsStatusReview).toBe(false)
  })
})

describe('buildVisitPromotionPlan — упоминание абонемента (не создаётся автоматически)', () => {
  it('flags needsSubscriptionReview but does not fabricate subscription data', () => {
    const plan = buildVisitPromotionPlan(makeVisit({ comment: 'оплата абонементом, 2 часа' }), CLIENT, NOW)
    expect(plan.needsSubscriptionReview).toBe(true)
    // Никакого поля про подписку в PromotedOrderData вообще нет — сумма остаётся
    // тем, что было в grossAmount (в этом тесте — 15000 из makeVisit по умолчанию).
    expect(plan.order!.preliminaryAmount).toBe(15000)
  })
})

describe('detectCancellationSignal / detectSubscriptionMention / detectFreeSignal', () => {
  it('detects common cancellation phrasings', () => {
    expect(detectCancellationSignal('Отмена записи')).toBe(true)
    expect(detectCancellationSignal('перенос на следующую неделю')).toBe(true)
    expect(detectCancellationSignal('клиент не пришёл')).toBe(true)
    expect(detectCancellationSignal('клиент не пришел')).toBe(true)
    expect(detectCancellationSignal('обычная съёмка')).toBe(false)
    expect(detectCancellationSignal(null)).toBe(false)
  })

  it('detects subscription mentions case-insensitively', () => {
    expect(detectSubscriptionMention('Абонемент 10 часов')).toBe(true)
    expect(detectSubscriptionMention('обычная оплата')).toBe(false)
  })

  it('detects free-of-charge mentions', () => {
    expect(detectFreeSignal('бесплатная съемка')).toBe(true)
    expect(detectFreeSignal('0')).toBe(false)
  })
})
