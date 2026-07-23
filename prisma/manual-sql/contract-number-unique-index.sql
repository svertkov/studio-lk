-- Частичный уникальный индекс: номер документа глобально уникален В РАМКАХ
-- СВОЕГО ТИПА для CONTRACT/INVOICE/ACT (по одному номеру на тип, не крест-накрест
-- — Счёт №5 и Акт №5 могут сосуществовать). Приложения (type='APPENDIX')
-- используют тот же столбец number, но их уникальность — в рамках одного
-- договора, уже покрыта декларативным @@unique([contractId, number]) в
-- schema.prisma — сюда не входят.
--
-- Причина ручного SQL: до 2026-07-22 в схеме стоял @@unique([type, number]),
-- который НЕПРЕДНАМЕРЕННО требовал глобальной уникальности номера и для
-- приложений — Договор №2 не смог бы завести Приложение №1, если оно уже
-- есть у Договора №1, хотя по ТЗ это должно быть разрешено. Prisma не умеет
-- декларативно выразить partial unique index ("уникально только когда
-- type IN (...)"), поэтому это вынесено сюда — тот же приём, что уже
-- используется для append-only триггера audit log
-- (prisma/manual-sql/audit-log-append-only.sql). НЕ управляется Prisma —
-- `prisma db push`/`migrate` не знает об этом индексе.
--
-- 2026-07-23: расширен с CONTRACT-only на CONTRACT/INVOICE/ACT — счета и
-- акты теперь тоже поддерживают ручной номер (см. AGENTS.md, "Реестр
-- документов"; getDocumentDisplayNumber, document-model.ts). Индекс на
-- (type, number), а не только (number) — иначе счёт №5 и акт №5 конфликтовали
-- бы друг с другом, хотя это разные документы разных типов. Прежний индекс
-- (только по number, только для CONTRACT) переименован и пересоздан —
-- поведение для CONTRACT не меняется (у него всегда ровно один тип в выборке).
-- Дополнительно исключены CANCELLED-документы (status <> 'CANCELLED') —
-- тот же принцип, что уже применяется к проверке номера приложения
-- (updateDocument, actions/documents.ts): аннулированный документ не должен
-- вечно "занимать" номер и мешать выдать его заново.
--
-- Применение (безопасно перезапускать — старый индекс дропается по имени,
-- новый создаётся с IF NOT EXISTS):
--   set -a && source .env.local && set +a
--   psql "$DATABASE_URL" -f prisma/manual-sql/contract-number-unique-index.sql
--
-- Откат (если понадобится):
--   DROP INDEX IF EXISTS cms_document_numbered_type_unique;

DROP INDEX IF EXISTS cms_document_contract_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS cms_document_numbered_type_unique
  ON cms_document (type, number)
  WHERE type IN ('CONTRACT', 'INVOICE', 'ACT') AND status <> 'CANCELLED';
