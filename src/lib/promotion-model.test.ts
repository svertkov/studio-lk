import { describe, it, expect } from 'vitest'
import {
  commentMentionsFirstVisitPromo, getOrderPromotion, stripPromotionTextFromComment, getVisibleOrderComment,
  PROMOTION_PILL_LABEL,
} from './promotion-model'

describe('commentMentionsFirstVisitPromo — распознавание старых текстовых вариантов', () => {
  const variants = [
    'Акция! 20% скидка на первую запись',
    'Акция! 20% скидка на первый визит',
    'Акция 20% скидка на первую запись',
    'Акция 20% скидка на первый визит',
    '20% скидка на первую запись',
    '20% скидка на первый визит',
    'Скидка 20% на первую запись',
    'Скидка 20% на первый визит',
  ]

  for (const text of variants) {
    it(`recognizes "${text}"`, () => {
      expect(commentMentionsFirstVisitPromo(text)).toBe(true)
    })
  }

  it('is case-insensitive', () => {
    expect(commentMentionsFirstVisitPromo('АКЦИЯ! 20% СКИДКА НА ПЕРВУЮ ЗАПИСЬ')).toBe(true)
    expect(commentMentionsFirstVisitPromo('акция! 20% скидка на первую запись')).toBe(true)
  })

  it('tolerates extra whitespace and line breaks', () => {
    expect(commentMentionsFirstVisitPromo('Акция!   20%   скидка   на   первую   запись')).toBe(true)
    expect(commentMentionsFirstVisitPromo('Акция! 20% скидка\nна первую запись')).toBe(true)
  })

  it('tolerates a dash between "Акция" and the rest', () => {
    expect(commentMentionsFirstVisitPromo('Акция - 20% скидка на первую запись')).toBe(true)
    expect(commentMentionsFirstVisitPromo('Акция – 20% скидка на первый визит')).toBe(true)
  })

  it('returns false for unrelated comments', () => {
    expect(commentMentionsFirstVisitPromo('Клиент попросил дополнительный свет')).toBe(false)
    expect(commentMentionsFirstVisitPromo('Скидка 10% за постоянство')).toBe(false)
  })

  it('returns false for null/empty comments', () => {
    expect(commentMentionsFirstVisitPromo(null)).toBe(false)
    expect(commentMentionsFirstVisitPromo(undefined)).toBe(false)
    expect(commentMentionsFirstVisitPromo('')).toBe(false)
  })

  it('works across repeated calls (global regex lastIndex does not leak state)', () => {
    expect(commentMentionsFirstVisitPromo('Акция! 20% скидка на первую запись')).toBe(true)
    expect(commentMentionsFirstVisitPromo('Акция! 20% скидка на первую запись')).toBe(true)
    expect(commentMentionsFirstVisitPromo('Акция! 20% скидка на первую запись')).toBe(true)
  })
})

describe('getOrderPromotion — структурированное поле важнее текста', () => {
  it('returns FIRST_VISIT_20 when the structured field is set, regardless of comment text', () => {
    expect(getOrderPromotion({ promotionType: 'FIRST_VISIT_20', comment: 'Обычный комментарий' }))
      .toBe('FIRST_VISIT_20')
  })

  it('falls back to legacy text detection when the structured field is empty', () => {
    expect(getOrderPromotion({ promotionType: null, comment: 'Акция! 20% скидка на первую запись' }))
      .toBe('FIRST_VISIT_20')
  })

  it('returns null when neither the structured field nor the comment mention a promo', () => {
    expect(getOrderPromotion({ promotionType: null, comment: 'Обычный комментарий' })).toBeNull()
    expect(getOrderPromotion({ promotionType: null, comment: null })).toBeNull()
  })
})

describe('stripPromotionTextFromComment — очистка превью комментария', () => {
  it('removes the promo phrase and keeps the rest of a mixed comment', () => {
    const original = 'Нужен дополнительный свет.\nАкция! 20% скидка на первую запись'
    expect(stripPromotionTextFromComment(original)).toBe('Нужен дополнительный свет.')
  })

  it('removes the promo phrase when it appears before the rest of the text', () => {
    const original = 'Акция! 20% скидка на первую запись\nКлиент попросил доп. свет'
    expect(stripPromotionTextFromComment(original)).toBe('Клиент попросил доп. свет')
  })

  it('returns null when nothing is left after stripping the promo phrase', () => {
    expect(stripPromotionTextFromComment('Акция! 20% скидка на первую запись')).toBeNull()
    expect(stripPromotionTextFromComment('20% скидка на первый визит')).toBeNull()
  })

  it('returns the comment unchanged when there is no promo phrase in it', () => {
    expect(stripPromotionTextFromComment('Клиент попросил дополнительный свет')).toBe('Клиент попросил дополнительный свет')
  })

  it('returns null for null/empty input', () => {
    expect(stripPromotionTextFromComment(null)).toBeNull()
    expect(stripPromotionTextFromComment(undefined)).toBeNull()
    expect(stripPromotionTextFromComment('')).toBeNull()
  })

  it('does not leave a dangling empty line where the promo phrase used to be', () => {
    const original = 'Первая строка\nАкция! 20% скидка на первую запись\nВторая строка'
    expect(stripPromotionTextFromComment(original)).toBe('Первая строка\nВторая строка')
  })
})

describe('getVisibleOrderComment — итоговый текст для таблицы/tooltip', () => {
  it('matches stripPromotionTextFromComment for the same input', () => {
    const order = { comment: 'Нужен доп. свет.\nАкция! 20% скидка на первую запись' }
    expect(getVisibleOrderComment(order)).toBe('Нужен доп. свет.')
  })

  it('returns null when the comment is only the promo phrase', () => {
    expect(getVisibleOrderComment({ comment: 'Акция! 20% скидка на первую запись' })).toBeNull()
  })
})

describe('PROMOTION_PILL_LABEL — единый текст капсулы', () => {
  it('is the short "−20% первый визит" label', () => {
    expect(PROMOTION_PILL_LABEL.FIRST_VISIT_20).toBe('−20% первый визит')
  })
})
