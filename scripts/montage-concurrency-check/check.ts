// Проверка гонки ensureMontageProjectForOrder (аудит 2026-08-04, см.
// комментарий у функции в src/lib/actions/montage.ts). Не юнит-тест —
// vitest.config.ts намеренно ограничен чистыми функциями без БД, тестовой
// базы в проекте нет (см. комментарий в vitest.config.ts). Этот скрипт
// проверяет РЕАЛЬНУЮ конкурентность на настоящем Postgres: создаёт временный
// тестовый заказ, запускает два по-настоящему параллельных вызова
// ensureMontageProjectForOrder для одного orderId (Promise.all — оба уходят
// в пул соединений Prisma одновременно, не последовательно), затем проверяет,
// что создался ровно один MontageProject. В конце всегда удаляет за собой
// тестовые данные (с проверкой имени перед удалением, см. DATA_SAFETY.md).
//
// Запуск: npx tsx scripts/montage-concurrency-check/check.ts

import { prisma } from '../../src/lib/prisma'
import { ensureMontageProjectForOrder } from '../../src/lib/actions/montage'

const TEST_TITLE = 'ТЕСТ Concurrency Check (montage-concurrency-check)'

async function main() {
  console.log('Создаю временный тестовый заказ...')
  const order = await prisma.order.create({
    data: {
      status: 'BOOKED',
      source: 'MANUAL',
      title: TEST_TITLE,
      clientName: TEST_TITLE,
      serviceType: 'Подкаст',
    },
  })
  console.log('Заказ создан:', order.id)

  try {
    const ROUNDS = 5
    for (let round = 1; round <= ROUNDS; round++) {
      // Полностью параллельный запуск — оба промиса стартуют до того, как
      // первый успеет что-либо закоммитить, это и есть воспроизведение TOCTOU.
      await Promise.all([
        ensureMontageProjectForOrder(order.id),
        ensureMontageProjectForOrder(order.id),
      ])

      const count = await prisma.montageProject.count({ where: { orderId: order.id } })
      console.log(`Раунд ${round}/${ROUNDS}: проектов монтажа после двух параллельных вызовов = ${count}`)

      if (count !== 1) {
        console.error(`ПРОВАЛ: ожидался ровно 1 проект, получено ${count}.`)
        process.exitCode = 1
        return
      }
    }

    // Ещё раз, для проверки идемпотентности уже существующего проекта —
    // повторные параллельные вызовы для заказа, у которого проект УЖЕ есть,
    // не должны создавать второй.
    await Promise.all([
      ensureMontageProjectForOrder(order.id),
      ensureMontageProjectForOrder(order.id),
      ensureMontageProjectForOrder(order.id),
    ])
    const finalCount = await prisma.montageProject.count({ where: { orderId: order.id } })
    console.log('После дополнительных 3 параллельных вызовов на уже существующий проект:', finalCount)
    if (finalCount !== 1) {
      console.error(`ПРОВАЛ: ожидался ровно 1 проект, получено ${finalCount}.`)
      process.exitCode = 1
      return
    }

    console.log('УСПЕХ: во всех раундах создан ровно один проект монтажа на заказ.')
  } finally {
    console.log('Удаляю тестовые данные...')
    const toDelete = await prisma.order.findUnique({ where: { id: order.id }, select: { id: true, title: true } })
    if (toDelete && toDelete.title === TEST_TITLE) {
      await prisma.montageProject.deleteMany({ where: { orderId: order.id } })
      await prisma.order.delete({ where: { id: order.id } })
      console.log('Тестовые данные удалены.')
    } else {
      console.error('ВНИМАНИЕ: не смог безопасно подтвердить тестовую запись перед удалением, оставляю как есть для ручной проверки:', order.id)
    }
  }
}

main()
  .catch(e => {
    console.error('Ошибка скрипта:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
