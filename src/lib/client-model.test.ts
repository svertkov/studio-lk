import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { describeClientActionError } from './client-model'

// Регресс-тест на реальный кейс 2026-08-08: createClient/updateClient ловили
// ЛЮБУЮ ошибку (включая обрыв связи с БД — управляемый кластер PostgreSQL был
// остановлен) в один и тот же generic текст "Не удалось создать клиента",
// без возможности отличить обрыв связи от чего-либо ещё.
describe('describeClientActionError — расшифровка ошибок createClient/updateClient', () => {
  it('распознаёт обрыв связи с БД (PrismaClientInitializationError) и не показывает сырой текст', () => {
    const dbDownError = new Prisma.PrismaClientInitializationError(
      "Can't reach database server at `rc1b-oj3hf0cbi7l2opnq.mdb.yandexcloud.net:6432`",
      '5.22.0',
    )
    const message = describeClientActionError(dbDownError, 'Не удалось создать клиента')
    expect(message).toBe('Нет связи с базой данных. Попробуйте ещё раз через минуту — если не поможет, сообщите администратору.')
    expect(message).not.toContain('yandexcloud.net')
    expect(message).not.toContain('rc1b-oj3hf0cbi7l2opnq')
  })

  it('распознаёт нарушение уникального ограничения (P2002)', () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: '5.22.0', meta: { target: ['phone'] },
    })
    expect(describeClientActionError(uniqueError, 'Не удалось создать клиента')).toBe('Клиент с такими данными уже существует.')
  })

  it('распознаёт нарушение внешнего ключа (P2003)', () => {
    const fkError = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003', clientVersion: '5.22.0',
    })
    expect(describeClientActionError(fkError, 'Не удалось создать клиента'))
      .toBe('Не удалось сохранить: указана несуществующая связанная запись (например, ответственный сотрудник).')
  })

  it('другие коды PrismaClientKnownRequestError падают на fallback, а не на неверный текст', () => {
    const otherError = new Prisma.PrismaClientKnownRequestError('Some other error', {
      code: 'P2025', clientVersion: '5.22.0',
    })
    expect(describeClientActionError(otherError, 'Не удалось создать клиента')).toBe('Не удалось создать клиента')
  })

  it('для полностью неизвестной ошибки возвращает переданный fallback, не раскрывая e.message', () => {
    const unknownError = new Error('some internal detail nobody should see')
    expect(describeClientActionError(unknownError, 'Не удалось обновить клиента')).toBe('Не удалось обновить клиента')
  })

  it('не падает на нестандартных значениях (строка, null, undefined)', () => {
    expect(describeClientActionError('plain string', 'fallback')).toBe('fallback')
    expect(describeClientActionError(null, 'fallback')).toBe('fallback')
    expect(describeClientActionError(undefined, 'fallback')).toBe('fallback')
  })
})
