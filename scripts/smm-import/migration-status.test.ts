import { describe, it, expect } from 'vitest'
import { decideMigrationStatus, meetsConfidenceThreshold, computeNextBatchId } from './migration-status'

describe('decideMigrationStatus', () => {
  it('is NEW when no existing record matches the entityKey', () => {
    expect(decideMigrationStatus(null, 'fp-1')).toBe('NEW')
  })

  it('is ALREADY_APPLIED when entityKey and fingerprint both match (safe rerun, no duplicate)', () => {
    expect(decideMigrationStatus({ fingerprint: 'fp-1' }, 'fp-1')).toBe('ALREADY_APPLIED')
  })

  it('is SOURCE_CHANGED_AFTER_APPLY when entityKey matches but fingerprint differs (title/date edited in source after a prior apply)', () => {
    expect(decideMigrationStatus({ fingerprint: 'fp-1' }, 'fp-2')).toBe('SOURCE_CHANGED_AFTER_APPLY')
  })
})

describe('meetsConfidenceThreshold', () => {
  it('HIGH meets a HIGH threshold', () => {
    expect(meetsConfidenceThreshold('HIGH', 'HIGH')).toBe(true)
  })
  it('MEDIUM does not meet a HIGH threshold (first apply must be HIGH-only)', () => {
    expect(meetsConfidenceThreshold('MEDIUM', 'HIGH')).toBe(false)
  })
  it('LOW does not meet a HIGH threshold', () => {
    expect(meetsConfidenceThreshold('LOW', 'HIGH')).toBe(false)
  })
  it('HIGH meets a lower MEDIUM threshold too', () => {
    expect(meetsConfidenceThreshold('HIGH', 'MEDIUM')).toBe(true)
  })
})

describe('computeNextBatchId', () => {
  it('starts at v1 when no prior batch exists for this migration+project', () => {
    expect(computeNextBatchId('smm-excel-2026-08', 'DIA', [])).toBe('smm-excel-2026-08-dia-v1')
  })

  it('increments from the highest existing version for the same migration+project', () => {
    const existing = ['smm-excel-2026-08-dia-v1', 'smm-excel-2026-08-dia-v2', 'smm-excel-2026-08-tok-v1']
    expect(computeNextBatchId('smm-excel-2026-08', 'DIA', existing)).toBe('smm-excel-2026-08-dia-v3')
  })

  it('does not let an unrelated project batch affect the version count', () => {
    const existing = ['smm-excel-2026-08-tok-v1', 'smm-excel-2026-08-tok-v2', 'smm-excel-2026-08-tok-v3']
    expect(computeNextBatchId('smm-excel-2026-08', 'DIA', existing)).toBe('smm-excel-2026-08-dia-v1')
  })
})
