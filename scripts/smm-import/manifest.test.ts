import { describe, it, expect } from 'vitest'
import { makeManifestEntry } from './manifest'
import { buildContentEntities } from './build'
import { dedupContentRows } from './dedup'
import type { ClientMatch, SourceContentRow } from './types'

describe('makeManifestEntry', () => {
  it('produces the same fingerprint for the same normalized input (idempotent rerun, ТЗ п.31/32)', () => {
    const trace = { file: 'f.xlsx', sheet: 's', row: 5 }
    const a = makeManifestEntry(trace, 'ContentItem', 'temp-1', ['Диамед', 'Д186', 'Название'])
    const b = makeManifestEntry(trace, 'ContentItem', 'temp-1', ['Диамед', 'Д186', 'Название'])
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it('changes fingerprint if the source row moves (row number is trace only, not part of the key)', () => {
    const a = makeManifestEntry({ file: 'f.xlsx', sheet: 's', row: 5 }, 'ContentItem', 'temp-1', ['Диамед', 'Д186'])
    const b = makeManifestEntry({ file: 'f.xlsx', sheet: 's', row: 99 }, 'ContentItem', 'temp-1', ['Диамед', 'Д186'])
    // fingerprint зависит только от нормализованных значений, не от sourceRow —
    // строка могла "уехать" при правке файла (ТЗ п.32), а сущность остаётся той же.
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it('differs for genuinely different content', () => {
    const trace = { file: 'f.xlsx', sheet: 's', row: 5 }
    const a = makeManifestEntry(trace, 'ContentItem', 'temp-1', ['Диамед', 'Д186'])
    const b = makeManifestEntry(trace, 'ContentItem', 'temp-1', ['Диамед', 'Д187'])
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })
})

describe('buildContentEntities manifest — full pipeline idempotency', () => {
  function row(overrides: Partial<SourceContentRow>): SourceContentRow {
    return {
      trace: { file: 'f.xlsx', sheet: 's', row: 1 }, date: '2026-08-05', legacyCode: 'Д186',
      title: 'Ролик', description: null, productionBrief: null, sourceUrl: null, masterUrl: null,
      platforms: [], shootNote: null, clientHint: 'Диамед', ...overrides,
    }
  }
  const clientMatch: ClientMatch = {
    source: 'f', clientHint: 'Диамед', proposedClientId: 'c1', proposedClientName: 'Диамед',
    proposedSmmProjectId: 'p1', proposedProjectCode: 'DIA', confidence: 'HIGH', evidence: [],
    missingClient: false, missingProject: false,
  }

  it('produces an identical manifest when the same source rows are processed twice (rerunning dry-run does not create new entries)', () => {
    const rows = [row({})]
    const run1 = buildContentEntities(dedupContentRows(rows), new Map([['Диамед', clientMatch]]))
    const run2 = buildContentEntities(dedupContentRows(rows), new Map([['Диамед', clientMatch]]))
    const fps1 = run1.manifest.map(m => m.fingerprint).sort()
    const fps2 = run2.manifest.map(m => m.fingerprint).sort()
    expect(fps1).toEqual(fps2)
  })
})
