// Общие типы SMM Excel-миграции (docs/business/SMM.md, «Готовность к миграции
// старых Excel-таблиц»). Импортёр — maintenance-tooling (см. п.45 ТЗ), живёт
// вне src/, не подключается к обычному SMM UI.

export type SmmPublicationPlatform = 'INSTAGRAM' | 'TELEGRAM' | 'VK' | 'YOUTUBE' | 'RUTUBE' | 'OTHER'
export type SmmMetricType =
  | 'VIEWS' | 'REACH' | 'LIKES' | 'COMMENTS' | 'SHARES' | 'SAVES' | 'REACTIONS'
  | 'FOLLOWERS_GAINED' | 'RETENTION_PERCENT' | 'WATCH_TIME'
export type SmmMaterialType = 'SOURCE_VIDEO' | 'SOURCE_AUDIO' | 'SELECTED_SOURCE' | 'MASTER' | 'COVER' | 'REFERENCE' | 'DOCUMENT' | 'IMAGE' | 'OTHER'

// ============================================================
// Классификация workbook/sheet (ТЗ п.3/п.50.3)
// ============================================================

export type WorkbookType =
  | 'PRODUCTION'
  | 'CONTENT_PLAN'
  | 'ANALYTICS'
  | 'WORK_PAYMENTS'
  | 'TEAM_PAYOUTS'
  | 'SCRIPT_LIBRARY'
  | 'UNKNOWN'

export interface SheetClassification {
  file: string
  sheet: string
  type: WorkbookType
  // Может сочетать несколько типов (напр. CONTENT_PLAN сразу и ANALYTICS) —
  // основной тип в `type`, дополнительные здесь (ТЗ явно допускает такие
  // "combined" листы — большинство реальных клиентских контент-планов).
  secondaryTypes: WorkbookType[]
  evidence: string[]
  dimensions: string
  maxRow: number
  maxCol: number
}

// ============================================================
// Schema drift (ТЗ п.4)
// ============================================================

export type DriftKind =
  | 'COLUMN_ORDER_CHANGED'
  | 'HEADER_MISMATCH'
  | 'SHEET_SCHEMA_DIFFERS'
  | 'DATE_AS_TEXT'
  | 'AMOUNT_AS_TEXT'
  | 'PLATFORM_NAME_VARIANT'
  | 'PERSON_NAME_VARIANT'
  | 'LEGACY_INDEX_VARIANT'
  | 'WEEKEND_MARKER_IN_DATE'
  | 'WEEKEND_MARKER_IN_TITLE'
  | 'EMPTY_OR_BROKEN_URL'
  | 'MERGED_CELLS'
  | 'HIDDEN_ROWS'
  | 'FORMULA_INSTEAD_OF_VALUE'
  | 'INVALID_DATE_SERIAL'
  | 'SPARSE_SHEET_DIMENSIONS'

export interface DriftIssue {
  file: string
  sheet: string
  kind: DriftKind
  description: string
  row?: number
  column?: string
}

// ============================================================
// "Сырая" строка листа после извлечения (ТЗ п.9 — что является ContentItem)
// ============================================================

export interface RowTrace {
  file: string
  sheet: string
  row: number
}

export interface PlatformCell {
  platform: SmmPublicationPlatform
  title: string | null
  url: string | null
  metrics: Partial<Record<SmmMetricType, number>>
}

export interface SourceContentRow {
  trace: RowTrace
  date: string | null // ISO, если распознана
  legacyCode: string | null
  title: string
  description: string | null
  productionBrief: string | null
  sourceUrl: string | null
  masterUrl: string | null
  platforms: PlatformCell[]
  shootNote: string | null
  clientHint: string // из имени файла/листа — до matching
}

export interface SourceWorkPaymentRow {
  trace: RowTrace
  clientHint: string
  legacyCode: string | null
  title: string | null
  date: string | null
  amount: number | null
  performerHint: string | null // явное имя, если есть (иначе — работа "по коду клиента")
}

export interface SourceTeamPayoutRow {
  trace: RowTrace
  performerHint: string
  clientHint: string | null
  month: string | null
  dueDates: string[] // ISO
  amounts: number[]
  paid: boolean | null
}

// ============================================================
// Matching (ТЗ п.6/п.21)
// ============================================================

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ClientMatch {
  source: string // "файл.xlsx" или "файл.xlsx / Лист"
  clientHint: string
  proposedClientId: string | null
  proposedClientName: string | null
  proposedSmmProjectId: string | null
  proposedProjectCode: string | null
  confidence: Confidence
  evidence: string[]
  missingClient: boolean
  missingProject: boolean
}

export interface EditorMatch {
  nameHint: string
  proposedEditorId: string | null
  proposedEditorName: string | null
  proposedEditorCode: string | null
  confidence: Confidence
  evidence: string[]
  notFound: boolean
}

// ============================================================
// Exceptions (ТЗ п.42)
// ============================================================

export type ExceptionCategory =
  | 'NEEDS_CLIENT_MAPPING'
  | 'NEEDS_CONTENT_MATCH'
  | 'NEEDS_EDITOR_MAPPING'
  | 'NEEDS_SCHEDULE_MATCH'
  | 'FILE_CODE_UNRESOLVED'
  | 'METRIC_CONFLICT'
  | 'PAYMENT_CONFLICT'
  | 'UNSUPPORTED_SCRIPT_LIBRARY'
  | 'INVALID_URL'
  | 'INVALID_DATE'
  | 'CONTENT_MATCH_NOT_FOUND'
  | 'OTHER'

export interface MigrationException {
  category: ExceptionCategory
  message: string
  trace?: RowTrace
  context?: Record<string, unknown>
}

// ============================================================
// Dedup (ТЗ п.10/11)
// ============================================================

export interface ContentDedupGroup {
  key: string
  confidence: Confidence
  rows: SourceContentRow[]
  evidence: string[]
}

// ============================================================
// Proposed domain entities (ТЗ п.9/12/14/17/23/25/26 — то, что БУДЕТ
// создано при apply; в dry-run только считается и репортится)
// ============================================================

export interface ProposedContentItem {
  tempId: string
  smmProjectId: string | null // null → MISSING_PROJECT, попадёт в exceptions
  clientHint: string
  title: string
  description: string | null
  productionBrief: string | null
  legacyCode: string | null
  plannedPublishDate: string | null
  parentTempId: string | null
  fileCodeStatus: 'RESOLVED' | 'UNRESOLVED'
  fileCodeBase: string | null
  sources: RowTrace[]
  dedupConfidence: Confidence
}

export interface ProposedPublication {
  contentTempId: string
  platform: SmmPublicationPlatform
  plannedPublishAt: string | null
  publishedAt: string | null
  url: string | null
  status: 'PLANNED' | 'READY' | 'PUBLISHED' | 'CANCELLED'
  sources: RowTrace[]
}

export interface ProposedMetric {
  contentTempId: string
  platform: SmmPublicationPlatform
  metricType: SmmMetricType
  value: number
  capturedAt: string
  capturedAtIsApproximate: boolean
  sources: RowTrace[]
}

export interface ProposedMaterial {
  contentTempId: string
  materialType: SmmMaterialType
  url: string
  sources: RowTrace[]
}

export interface ProposedWorkItem {
  contentTempId: string | null
  clientHint: string
  performerHint: string
  proposedEditorId: string | null
  amount: number
  workDate: string | null
  description: string | null
  sources: RowTrace[]
}

export interface ProposedRecurringPayout {
  performerHint: string
  proposedEditorId: string | null
  clientHint: string | null
  proposedSmmProjectId: string | null
  amount: number
  daysOfMonth: number[]
  evidenceMonths: string[]
  sources: RowTrace[]
}

// ============================================================
// Manifest / idempotency (ТЗ п.31/32)
// ============================================================

export interface ManifestEntry {
  sourceFile: string
  sourceSheet: string
  sourceRow: number
  entityType: 'ContentItem' | 'Publication' | 'Metric' | 'Material' | 'WorkItem' | 'Payment' | 'RecurringPayout'
  tempId: string
  // Стабильный ключ "то же самое реальное содержимое" (client+legacy-код,
  // либо client+title, если кода нет) — НЕ включает всё смысловое
  // содержимое, поэтому переживает правку title/даты в источнике. Именно
  // entityKey ищется в SmmMigrationRecord при apply (ТЗ pre-apply hardening,
  // п.7/11) — fingerprint ниже используется отдельно, чтобы ОТЛИЧИТЬ
  // "тот же объект, ничего не изменилось" (ALREADY_APPLIED) от "тот же
  // объект, но источник поменялся" (SOURCE_CHANGED_AFTER_APPLY).
  entityKey: string
  fingerprint: string
}

// ============================================================
// Итог dry-run (ТЗ п.29 — минимальный состав отчёта)
// ============================================================

export interface DryRunResult {
  sheetClassifications: SheetClassification[]
  driftIssues: DriftIssue[]
  clientMatches: ClientMatch[]
  editorMatches: EditorMatch[]
  contentDedupGroups: ContentDedupGroup[]
  skippedServiceRows: number
  proposedContentItems: ProposedContentItem[]
  proposedPublications: ProposedPublication[]
  proposedMetrics: ProposedMetric[]
  proposedMaterials: ProposedMaterial[]
  proposedWorkItems: ProposedWorkItem[]
  proposedRecurringPayouts: ProposedRecurringPayout[]
  exceptions: MigrationException[]
  manifest: ManifestEntry[]
  warnings: string[]
}
