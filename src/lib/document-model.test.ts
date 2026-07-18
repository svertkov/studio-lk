import { describe, it, expect } from 'vitest'
import {
  getDocumentDisplayNumber, suggestDocumentFlowType, getDocumentPaymentState,
  getWorkDocumentAttentionReasons, getClientContractAttentionReasons,
  computeLineItemTotal, computeLineItemsTotal,
} from '@/lib/document-model'

describe('getDocumentDisplayNumber', () => {
  it('formats a contract by its own sequential number', () => {
    expect(getDocumentDisplayNumber({ type: 'CONTRACT', number: 18, suffix: null }, null)).toBe('№18')
  })

  it('returns a placeholder for a contract with no number yet', () => {
    expect(getDocumentDisplayNumber({ type: 'CONTRACT', number: null, suffix: null }, null)).toBe('Без номера')
  })

  it('formats an invoice/act from the WORK package number, not a stored field', () => {
    expect(getDocumentDisplayNumber({ type: 'INVOICE', number: null, suffix: null }, 127)).toBe('№127')
    expect(getDocumentDisplayNumber({ type: 'ACT', number: null, suffix: null }, 127)).toBe('№127')
  })

  it('appends the suffix for multiple invoices of the same work', () => {
    expect(getDocumentDisplayNumber({ type: 'INVOICE', number: null, suffix: '1' }, 127)).toBe('№127-1')
    expect(getDocumentDisplayNumber({ type: 'INVOICE', number: null, suffix: '2' }, 127)).toBe('№127-2')
  })

  it('returns a placeholder when the work has no package number assigned', () => {
    expect(getDocumentDisplayNumber({ type: 'INVOICE', number: null, suffix: null }, null)).toBe('Без номера')
  })

  it('formats an appendix by its own per-contract number, ignoring workPackageNumber', () => {
    expect(getDocumentDisplayNumber({ type: 'APPENDIX', number: 1, suffix: null }, 127)).toBe('№1')
    expect(getDocumentDisplayNumber({ type: 'APPENDIX', number: 3, suffix: null }, null)).toBe('№3')
  })

  it('returns a placeholder for an appendix with no number yet', () => {
    expect(getDocumentDisplayNumber({ type: 'APPENDIX', number: null, suffix: null }, null)).toBe('Без номера')
  })
})

describe('suggestDocumentFlowType — только предложение для формы создания, не автоматический вывод постфактум', () => {
  it('suggests full contract+invoice+act flow for LLC/IP clients', () => {
    expect(suggestDocumentFlowType('LLC', null)).toBe('CONTRACT_INVOICE_ACT')
    expect(suggestDocumentFlowType('IP', null)).toBe('CONTRACT_INVOICE_ACT')
  })

  it('suggests invoice+act (no contract) for agencies', () => {
    expect(suggestDocumentFlowType('AGENCY', null)).toBe('INVOICE_AND_ACT')
  })

  it('suggests no documents for individuals paying by cash/card', () => {
    expect(suggestDocumentFlowType('INDIVIDUAL', 'CASH')).toBe('NOT_REQUIRED')
    expect(suggestDocumentFlowType('INDIVIDUAL', 'CARD')).toBe('NOT_REQUIRED')
  })

  it('falls back to UNKNOWN when nothing can be inferred', () => {
    expect(suggestDocumentFlowType('INDIVIDUAL', null)).toBe('UNKNOWN')
    expect(suggestDocumentFlowType(null, null)).toBe('UNKNOWN')
  })
})

describe('getDocumentPaymentState — читается из существующего платёжного источника, не хранится на Document', () => {
  it('maps order payment statuses', () => {
    expect(getDocumentPaymentState('PAID', null)).toBe('PAID')
    expect(getDocumentPaymentState('PARTIALLY_PAID', null)).toBe('PARTIALLY_PAID')
    expect(getDocumentPaymentState('UNPAID', null)).toBe('PENDING')
    expect(getDocumentPaymentState('SUBSCRIPTION', null)).toBe('NOT_REQUIRED')
  })

  it('falls back to the montage payment status when there is no order', () => {
    expect(getDocumentPaymentState(null, 'PAID')).toBe('PAID')
    expect(getDocumentPaymentState(null, 'PENDING')).toBe('PENDING')
    expect(getDocumentPaymentState(null, 'NOT_REQUIRED')).toBe('NOT_REQUIRED')
  })

  it('is UNKNOWN when neither source has a recognizable status', () => {
    expect(getDocumentPaymentState(null, null)).toBe('UNKNOWN')
    expect(getDocumentPaymentState('NOT_SPECIFIED', null)).toBe('UNKNOWN')
  })
})

describe('getWorkDocumentAttentionReasons', () => {
  const base: Parameters<typeof getWorkDocumentAttentionReasons>[0] = {
    documentFlowType: null,
    montageDocumentMode: null,
    isCompleted: false,
    isCancelledOrArchived: false,
    hasInvoice: false,
    hasAct: false,
    paymentState: 'UNKNOWN',
  }

  it('cancelled or archived work is never flagged, regardless of missing documents', () => {
    expect(getWorkDocumentAttentionReasons({ ...base, documentFlowType: 'CONTRACT_INVOICE_ACT', isCancelledOrArchived: true })).toEqual([])
  })

  it('flags a missing invoice when the flow type requires one', () => {
    expect(getWorkDocumentAttentionReasons({ ...base, documentFlowType: 'INVOICE_ONLY' })).toContain('MISSING_INVOICE')
  })

  it('does not flag a missing invoice when documents are not required', () => {
    expect(getWorkDocumentAttentionReasons({ ...base, documentFlowType: 'NOT_REQUIRED' })).toEqual([])
  })

  it('flags a missing act only once the work is completed', () => {
    const inProgress = getWorkDocumentAttentionReasons({ ...base, documentFlowType: 'INVOICE_AND_ACT', hasInvoice: true, isCompleted: false })
    expect(inProgress).not.toContain('MISSING_ACT')
    const completed = getWorkDocumentAttentionReasons({ ...base, documentFlowType: 'INVOICE_AND_ACT', hasInvoice: true, isCompleted: true })
    expect(completed).toContain('MISSING_ACT')
  })

  it('flags an unpaid or partially paid invoice', () => {
    expect(getWorkDocumentAttentionReasons({ ...base, hasInvoice: true, paymentState: 'PENDING' })).toContain('UNPAID_INVOICE')
    expect(getWorkDocumentAttentionReasons({ ...base, hasInvoice: true, paymentState: 'PARTIALLY_PAID' })).toContain('UNPAID_INVOICE')
    expect(getWorkDocumentAttentionReasons({ ...base, hasInvoice: true, paymentState: 'PAID' })).not.toContain('UNPAID_INVOICE')
  })

  it('flags a montage project with an undetermined document mode', () => {
    expect(getWorkDocumentAttentionReasons({ ...base, montageDocumentMode: 'UNKNOWN' })).toContain('MONTAGE_MODE_UNKNOWN')
    expect(getWorkDocumentAttentionReasons({ ...base, montageDocumentMode: 'INCLUDED_IN_ORDER' })).not.toContain('MONTAGE_MODE_UNKNOWN')
  })

  it('a fully satisfied work (all required documents present, paid) has no reasons', () => {
    expect(getWorkDocumentAttentionReasons({
      ...base, documentFlowType: 'INVOICE_AND_ACT', hasInvoice: true, hasAct: true, isCompleted: true, paymentState: 'PAID',
    })).toEqual([])
  })
})

describe('getClientContractAttentionReasons', () => {
  it('flags an LLC/IP client with an unspecified contract state', () => {
    expect(getClientContractAttentionReasons('LLC', 'UNSPECIFIED')).toEqual(['CONTRACT_STATE_UNSPECIFIED'])
    expect(getClientContractAttentionReasons('IP', 'UNSPECIFIED')).toEqual(['CONTRACT_STATE_UNSPECIFIED'])
  })

  it('does not flag an individual/self-employed client with an unspecified contract state (normal, not an error)', () => {
    expect(getClientContractAttentionReasons('INDIVIDUAL', 'UNSPECIFIED')).toEqual([])
    expect(getClientContractAttentionReasons('SELF_EMPLOYED', 'UNSPECIFIED')).toEqual([])
  })

  it('does not flag a legal client once a contract state has been consciously chosen', () => {
    expect(getClientContractAttentionReasons('LLC', 'NO_CONTRACT')).toEqual([])
    expect(getClientContractAttentionReasons('LLC', 'ACTIVE')).toEqual([])
    expect(getClientContractAttentionReasons('LLC', 'PREPARING')).toEqual([])
  })
})

describe('computeLineItemTotal / computeLineItemsTotal', () => {
  it('multiplies quantity by unit price for a single line', () => {
    expect(computeLineItemTotal({ quantity: 2, unitPrice: 5000 })).toBe(10000)
  })

  it('supports fractional quantity (e.g. hours)', () => {
    expect(computeLineItemTotal({ quantity: 1.5, unitPrice: 2000 })).toBe(3000)
  })

  it('sums multiple line items', () => {
    expect(computeLineItemsTotal([
      { quantity: 1, unitPrice: 15000 },
      { quantity: 2, unitPrice: 5000 },
      { quantity: 3, unitPrice: 1000 },
    ])).toBe(28000)
  })

  it('an empty list of line items totals to zero', () => {
    expect(computeLineItemsTotal([])).toBe(0)
  })
})
