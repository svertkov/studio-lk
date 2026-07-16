-- Делает cms_audit_log append-only на уровне БД: любая попытка UPDATE/DELETE
-- по существующей строке или TRUNCATE всей таблицы отклоняется исключением —
-- независимо от того, кто выполняет запрос (текущее приложение, ad-hoc
-- скрипт, будущая роль с правами на всё). INSERT/SELECT не ограничены.
--
-- Причина: 2026-07-15 одноразовый ad-hoc скрипт с ошибкой в пути поля
-- (undefined в Prisma where => "условие не задано") превратил точечное
-- удаление одной строки в deleteMany() без условия и стёр все 1799 строк
-- журнала аудита. Ни одна прикладная проверка в коде такое не ловит — защита
-- нужна на уровне самой таблицы. См. память: project_studio_lk_audit_log_incident.
--
-- НЕ управляется Prisma (schema.prisma не знает о триггерах/функциях) —
-- `prisma db push`/`prisma migrate` не создаёт и не удаляет их. Применяется
-- вручную один раз через psql (см. команду ниже) и переприменяется только
-- если кластер/база пересоздаётся с нуля.
--
-- Применение:
--   set -a && source .env.local && set +a
--   psql "$DATABASE_URL" -f prisma/manual-sql/audit-log-append-only.sql
--
-- Откат (если когда-нибудь понадобится, например для контролируемой
-- регламентной архивации — см. AGENTS.md, раздел Data Safety):
--   DROP TRIGGER IF EXISTS audit_log_append_only ON cms_audit_log;
--   DROP FUNCTION IF EXISTS reject_audit_log_mutation();

CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cms_audit_log is append-only: % is not allowed (row id=%). '
    'History must never be deleted or edited — see AGENTS.md "Data Safety and Audit Integrity".',
    TG_OP, COALESCE(OLD.id, 'n/a');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON cms_audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON cms_audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

-- TRUNCATE не построчный — нужен отдельный statement-level триггер.
DROP TRIGGER IF EXISTS audit_log_append_only_truncate ON cms_audit_log;
CREATE TRIGGER audit_log_append_only_truncate
  BEFORE TRUNCATE ON cms_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation();
