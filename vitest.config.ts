import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Только модульные тесты чистых функций (src/lib/**/*.test.ts) — без БД,
// без рендера React. Не пытается покрыть серверные actions/UI: для этого
// в проекте пока нет тестовой БД/окружения (см. отчёт по доработке карточки
// клиента). scripts/**/*.test.ts — та же категория (чистые функции без
// обращения к БД), но для одноразовых/инфраструктурных Node-скриптов вне
// src/ (например, scripts/db-backup/core.mjs).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
