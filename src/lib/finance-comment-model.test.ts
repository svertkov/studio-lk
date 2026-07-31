import { describe, it, expect } from 'vitest'
import { appendFinanceCommentTemplate } from './finance-comment-model'

describe('appendFinanceCommentTemplate', () => {
  it('fills an empty comment with the template text', () => {
    expect(appendFinanceCommentTemplate('', 'Налог 9%')).toBe('Налог 9%')
  })

  it('treats a whitespace-only comment as empty', () => {
    expect(appendFinanceCommentTemplate('   \n  ', 'Налог 9%')).toBe('Налог 9%')
  })

  it('appends the template on a new line without erasing existing text', () => {
    expect(appendFinanceCommentTemplate('Оплата наличными', 'Налог 9%')).toBe('Оплата наличными\nНалог 9%')
  })

  it('does not duplicate a template already present', () => {
    expect(appendFinanceCommentTemplate('Налог 9%', 'Налог 9%')).toBe('Налог 9%')
    expect(appendFinanceCommentTemplate('Оплата наличными\nНалог 9%', 'Налог 9%')).toBe('Оплата наличными\nНалог 9%')
  })

  it('detects the template even when embedded inside a longer line', () => {
    expect(appendFinanceCommentTemplate('Уже удержан Налог 9% за прошлый месяц', 'Налог 9%')).toBe(
      'Уже удержан Налог 9% за прошлый месяц',
    )
  })
})
