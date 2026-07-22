-- Частичный уникальный индекс: номер документа глобально уникален ТОЛЬКО для
-- договоров (type='CONTRACT'). Приложения (type='APPENDIX') используют тот
-- же столбец number, но их уникальность — в рамках одного договора, уже
-- покрыта декларативным @@unique([contractId, number]) в schema.prisma.
--
-- Причина ручного SQL: до 2026-07-22 в схеме стоял @@unique([type, number]),
-- который НЕПРЕДНАМЕРЕННО требовал глобальной уникальности номера и для
-- приложений — Договор №2 не смог бы завести Приложение №1, если оно уже
-- есть у Договора №1, хотя по ТЗ это должно быть разрешено. Prisma не умеет
-- декларативно выразить partial unique index ("уникально только когда
-- type=CONTRACT"), поэтому это вынесено сюда — тот же приём, что уже
-- используется для append-only триггера audit log
-- (prisma/manual-sql/audit-log-append-only.sql). НЕ управляется Prisma —
-- `prisma db push`/`migrate` не знает об этом индексе.
--
-- Применение (один раз; безопасно перезапускать — CREATE INDEX IF NOT EXISTS):
--   set -a && source .env.local && set +a
--   psql "$DATABASE_URL" -f prisma/manual-sql/contract-number-unique-index.sql
--
-- Откат (если понадобится):
--   DROP INDEX IF EXISTS cms_document_contract_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS cms_document_contract_number_unique
  ON cms_document (number)
  WHERE type = 'CONTRACT';
