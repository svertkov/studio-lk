import type {
  DocumentType, DocumentStatus, InvoicePurpose, ClientContractState,
  DocumentFlowType, MontageDocumentMode, ClientType, PaymentMethod,
  InvoiceLineItemUnit, VatRate,
} from '@prisma/client'

export type { DocumentType, DocumentStatus, InvoicePurpose, ClientContractState, DocumentFlowType, MontageDocumentMode, InvoiceLineItemUnit, VatRate }

export const INVOICE_LINE_ITEM_UNIT_LABELS: Record<InvoiceLineItemUnit, string> = {
  PIECE: 'шт.',
  HOUR: 'ч.',
  DAY: 'дн.',
  SERVICE: 'услуга',
}

export const VAT_RATE_LABELS: Record<VatRate, string> = {
  NOT_APPLICABLE: 'Без НДС',
  ZERO: 'НДС 0%',
  RATE_10: 'НДС 10%',
  RATE_20: 'НДС 20%',
}

// ============================================================
// РЕЕСТР ДОКУМЕНТОВ — реестр номеров/статусов договоров, счетов, актов.
// Платформа НЕ хранит файлы/ссылки/интеграции ЭДО на этом этапе (см.
// AGENTS.md, "Реестр документов") — эти функции работают только со
// структурированными полями: тип, номер, дата, статус, связи.
// ============================================================

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  CONTRACT: 'Договор',
  APPENDIX: 'Приложение',
  INVOICE: 'Счёт',
  ACT: 'Акт',
}

// Один общий enum на все три типа (тот же приём, что MontageStatus) — набор
// для конкретного дропдауна сужается здесь же, а не отдельным enum на тип.
export const DOCUMENT_STATUS_OPTIONS_BY_TYPE: Record<DocumentType, DocumentStatus[]> = {
  CONTRACT: ['ACTIVE', 'ARCHIVED', 'CANCELLED'],
  APPENDIX: ['ACTIVE', 'ARCHIVED', 'CANCELLED'],
  INVOICE: ['DRAFT', 'ISSUED', 'CANCELLED'],
  ACT: ['NOT_PREPARED', 'PREPARED', 'DELIVERED', 'SIGNED', 'NEEDS_CORRECTION', 'ARCHIVED', 'CANCELLED'],
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: 'Черновик',
  ISSUED: 'Выставлен',
  NOT_PREPARED: 'Не подготовлен',
  PREPARED: 'Подготовлен',
  DELIVERED: 'Передан клиенту',
  SIGNED: 'Подписан',
  NEEDS_CORRECTION: 'Требует исправления',
  ACTIVE: 'Действует',
  ARCHIVED: 'Архив',
  CANCELLED: 'Аннулирован',
}

export const INVOICE_PURPOSE_LABELS: Record<InvoicePurpose, string> = {
  ADVANCE: 'Аванс',
  FINAL_PAYMENT: 'Окончательный расчёт',
  FULL_PAYMENT: 'Полная оплата',
  ADDITIONAL_SERVICE: 'Дополнительная услуга',
  OTHER: 'Прочее',
}

export const CLIENT_CONTRACT_STATE_LABELS: Record<ClientContractState, string> = {
  ACTIVE: 'Договор действует',
  PREPARING: 'Договор готовится',
  NO_CONTRACT: 'Работа без договора',
  ARCHIVED: 'Договор архивирован',
  UNSPECIFIED: 'Статус не указан',
}

// zinc — нейтральный ("работа без договора", осознанный выбор, НЕ ошибка),
// amber — "требует внимания, но не критично" (готовится/архив).
// UNSPECIFIED сам по себе не в этой таблице — см. getContractStateColor:
// для физлица/самозанятого это норма (zinc), для ИП/ООО — реальная проблема
// (red), см. ТЗ разд.4: "для ИП и юрлица без статуса — предупреждение".
export const CLIENT_CONTRACT_STATE_COLOR: Record<Exclude<ClientContractState, 'UNSPECIFIED'>, 'green' | 'amber' | 'zinc'> = {
  ACTIVE: 'green',
  PREPARING: 'amber',
  NO_CONTRACT: 'zinc',
  ARCHIVED: 'zinc',
}

export function getContractStateColor(clientType: ClientType, contractState: ClientContractState): 'green' | 'amber' | 'zinc' | 'red' {
  if (contractState === 'UNSPECIFIED') {
    return clientType === 'LLC' || clientType === 'IP' ? 'red' : 'zinc'
  }
  return CLIENT_CONTRACT_STATE_COLOR[contractState]
}

export const DOCUMENT_FLOW_TYPE_LABELS: Record<DocumentFlowType, string> = {
  NOT_REQUIRED: 'Документы не требуются',
  INVOICE_ONLY: 'Только счёт',
  INVOICE_AND_ACT: 'Счёт и акт',
  CONTRACT_INVOICE_ACT: 'Договор, счёт и акт',
  UNKNOWN: 'Не определено',
}

export const MONTAGE_DOCUMENT_MODE_LABELS: Record<MontageDocumentMode, string> = {
  INCLUDED_IN_ORDER: 'Документы в заказе',
  SEPARATE: 'Отдельные документы',
  NOT_REQUIRED: 'Не требуются',
  UNKNOWN: 'Не определено',
}

const FLOW_TYPES_REQUIRING_ACT: DocumentFlowType[] = ['INVOICE_AND_ACT', 'CONTRACT_INVOICE_ACT']
const FLOW_TYPES_REQUIRING_INVOICE: DocumentFlowType[] = ['INVOICE_ONLY', 'INVOICE_AND_ACT', 'CONTRACT_INVOICE_ACT']

// ============================================================
// ОТОБРАЖАЕМЫЙ НОМЕР — чистая функция, не хранимое поле (см. AGENTS.md:
// номер комплекта живёт на Order/MontageProject, не копируется в Document).
// ============================================================

export interface DocumentNumberInput {
  type: DocumentType
  number: number | null
  suffix: string | null
}

export function getDocumentDisplayNumber(document: DocumentNumberInput, workPackageNumber: number | null): string {
  // CONTRACT — сквозной номер платформы; APPENDIX — сквозной номер В РАМКАХ
  // СВОЕГО ДОГОВОРА (contractId+number, см. getNextAppendixNumber). Оба
  // хранятся напрямую в document.number, не собираются из workPackageNumber.
  if (document.type === 'CONTRACT' || document.type === 'APPENDIX') {
    return document.number != null ? `№${document.number}` : 'Без номера'
  }
  if (workPackageNumber == null) return 'Без номера'
  return document.suffix ? `№${workPackageNumber}-${document.suffix}` : `№${workPackageNumber}`
}

// ============================================================
// ПОДСКАЗКА DOCUMENTFLOWTYPE — только предзаполнение формы создания заказа,
// администратор всегда может изменить вручную (см. ТЗ п.27: "не делать
// юридические выводы автоматически без возможности проверки"). Никогда не
// вызывается повторно поверх уже сохранённого значения.
// ============================================================

export function suggestDocumentFlowType(clientType: ClientType | null, paymentMethod: PaymentMethod | null): DocumentFlowType {
  if (clientType === 'LLC' || clientType === 'IP') return 'CONTRACT_INVOICE_ACT'
  if (clientType === 'AGENCY') return 'INVOICE_AND_ACT'
  if (paymentMethod === 'CASH' || paymentMethod === 'CARD') return 'NOT_REQUIRED'
  return 'UNKNOWN'
}

// ============================================================
// ОПЛАТА СЧЁТА — сознательно не хранится на Document (см. AGENTS.md).
// Источник: Order.paymentStatus (через payment-model.ts) для счетов заказа,
// MontageProject.clientPaymentStatus для счетов монтажа. Показывает статус
// оплаты ВСЕЙ работы — при нескольких счетах одной работы (аванс+окончательный)
// оба сейчас отображают один и тот же статус работы (известное упрощение,
// раздельный учёт по конкретному счёту потребовал бы отдельной новой
// финансовой подсистемы, вне рамок реестра номеров).
// ============================================================

export type DocumentPaymentState = 'PAID' | 'PARTIALLY_PAID' | 'PENDING' | 'NOT_REQUIRED' | 'UNKNOWN'

export function getDocumentPaymentState(
  orderPaymentStatus: string | null,
  montagePaymentStatus: string | null,
): DocumentPaymentState {
  const status = orderPaymentStatus ?? montagePaymentStatus
  if (status === 'PAID') return 'PAID'
  if (status === 'PARTIALLY_PAID') return 'PARTIALLY_PAID'
  if (status === 'UNPAID' || status === 'PENDING') return 'PENDING'
  if (status === 'SUBSCRIPTION' || status === 'NOT_REQUIRED') return 'NOT_REQUIRED'
  return 'UNKNOWN'
}

export const DOCUMENT_PAYMENT_STATE_LABELS: Record<DocumentPaymentState, string> = {
  PAID: 'Оплачено',
  PARTIALLY_PAID: 'Частично оплачено',
  PENDING: 'Ожидает оплаты',
  NOT_REQUIRED: 'Не требуется',
  UNKNOWN: 'Не определено',
}

// ============================================================
// ТРЕБУЮТ ВНИМАНИЯ — единый источник для дашборда документов и главного
// дашборда платформы (тот же принцип, что getMontageAttentionReasons).
// ============================================================

export type DocumentAttentionReason =
  | 'CONTRACT_STATE_UNSPECIFIED'
  | 'MISSING_INVOICE'
  | 'MISSING_ACT'
  | 'UNPAID_INVOICE'
  | 'MONTAGE_MODE_UNKNOWN'

export const DOCUMENT_ATTENTION_LABELS: Record<DocumentAttentionReason, string> = {
  CONTRACT_STATE_UNSPECIFIED: 'Не указан статус договора',
  MISSING_INVOICE: 'Нет номера счёта',
  MISSING_ACT: 'Не прикреплён акт выполненных работ',
  UNPAID_INVOICE: 'Счёт не оплачен',
  MONTAGE_MODE_UNKNOWN: 'Не определён режим документов монтажа',
}

export interface DocumentWorkAttentionInput {
  documentFlowType: DocumentFlowType | null      // заказ; null — не заказ
  montageDocumentMode: MontageDocumentMode | null // монтаж; null — не монтаж
  isCompleted: boolean
  isCancelledOrArchived: boolean
  hasInvoice: boolean
  hasAct: boolean
  paymentState: DocumentPaymentState
}

export function getWorkDocumentAttentionReasons(input: DocumentWorkAttentionInput): DocumentAttentionReason[] {
  if (input.isCancelledOrArchived) return []
  const reasons: DocumentAttentionReason[] = []

  if (input.montageDocumentMode === 'UNKNOWN') reasons.push('MONTAGE_MODE_UNKNOWN')

  const needsInvoice = input.documentFlowType != null && FLOW_TYPES_REQUIRING_INVOICE.includes(input.documentFlowType)
  const needsAct = input.documentFlowType != null && FLOW_TYPES_REQUIRING_ACT.includes(input.documentFlowType)

  if (needsInvoice && !input.hasInvoice) reasons.push('MISSING_INVOICE')
  if (needsAct && input.isCompleted && !input.hasAct) reasons.push('MISSING_ACT')
  if (input.hasInvoice && (input.paymentState === 'PENDING' || input.paymentState === 'PARTIALLY_PAID')) {
    reasons.push('UNPAID_INVOICE')
  }

  return reasons
}

export function getClientContractAttentionReasons(clientType: ClientType, contractState: ClientContractState): DocumentAttentionReason[] {
  const isLegal = clientType === 'LLC' || clientType === 'IP'
  if (isLegal && contractState === 'UNSPECIFIED') return ['CONTRACT_STATE_UNSPECIFIED']
  return []
}

// ============================================================
// СТРОКИ СЧЁТА — по образцу computeMontageProfit: чистые функции, ничего не
// хранят сами по себе. Document.amount пересчитывается из суммы строк на
// сервере (см. recomputeDocumentAmount в actions/documents.ts) только для
// счетов, у которых есть хотя бы одна строка — старые счета без строк
// продолжают хранить amount как раньше.
// ============================================================

export interface InvoiceLineItemInput {
  quantity: number
  unitPrice: number
}

export function computeLineItemTotal(item: InvoiceLineItemInput): number {
  return item.quantity * item.unitPrice
}

export function computeLineItemsTotal(items: InvoiceLineItemInput[]): number {
  return items.reduce((sum, item) => sum + computeLineItemTotal(item), 0)
}
