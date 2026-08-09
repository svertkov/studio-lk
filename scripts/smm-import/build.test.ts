import { describe, it, expect } from 'vitest'
import { buildContentEntities, buildWorkItemCandidates, buildRecurringPayoutCandidates } from './build'
import { dedupContentRows } from './dedup'
import type { ClientMatch, EditorMatch, SourceContentRow, SourceTeamPayoutRow, SourceWorkPaymentRow } from './types'

function contentRow(overrides: Partial<SourceContentRow>): SourceContentRow {
  return {
    trace: { file: 'f.xlsx', sheet: 's', row: 1 },
    date: null, legacyCode: null, title: 'Ролик', description: null, productionBrief: null,
    sourceUrl: null, masterUrl: null, platforms: [], shootNote: null, clientHint: 'Диамед',
    ...overrides,
  }
}

const resolvedClientMatch: ClientMatch = {
  source: 'f', clientHint: 'Диамед', proposedClientId: 'c1', proposedClientName: 'Диамед',
  proposedSmmProjectId: 'p1', proposedProjectCode: 'DIA', confidence: 'HIGH', evidence: [],
  missingClient: false, missingProject: false,
}
const unresolvedClientMatch: ClientMatch = {
  ...resolvedClientMatch, proposedSmmProjectId: null, missingProject: true,
}

describe('buildContentEntities', () => {
  it('always marks migrated content as FILE_CODE_UNRESOLVED (ТЗ: не выдумывать историческую последовательность)', () => {
    const groups = dedupContentRows([contentRow({ legacyCode: 'Д186' })])
    const result = buildContentEntities(groups, new Map([['Диамед', resolvedClientMatch]]))
    expect(result.contentItems[0].fileCodeStatus).toBe('UNRESOLVED')
    expect(result.contentItems[0].fileCodeBase).toBeNull()
    expect(result.exceptions.some(e => e.category === 'FILE_CODE_UNRESOLVED')).toBe(true)
  })

  it('flags NEEDS_CLIENT_MAPPING and leaves smmProjectId null when the project is missing', () => {
    const groups = dedupContentRows([contentRow({ legacyCode: 'Д1' })])
    const result = buildContentEntities(groups, new Map([['Диамед', unresolvedClientMatch]]))
    expect(result.contentItems[0].smmProjectId).toBeNull()
    expect(result.exceptions.some(e => e.category === 'NEEDS_CLIENT_MAPPING')).toBe(true)
  })

  it('does not flag a metric conflict for the same metric on different dates (legitimate growth over time)', () => {
    const rows = [
      contentRow({
        legacyCode: 'Д1', date: '2026-08-05',
        platforms: [{ platform: 'INSTAGRAM', title: 'Ролик', url: null, metrics: { VIEWS: 100 } }],
      }),
      contentRow({
        legacyCode: 'Д1', date: '2026-08-12',
        platforms: [{ platform: 'INSTAGRAM', title: 'Ролик', url: null, metrics: { VIEWS: 400 } }],
      }),
    ]
    const groups = dedupContentRows(rows)
    const result = buildContentEntities(groups, new Map([['Диамед', resolvedClientMatch]]))
    expect(result.exceptions.some(e => e.category === 'METRIC_CONFLICT')).toBe(false)
    expect(result.metrics).toHaveLength(2)
  })

  it('flags METRIC_CONFLICT when two sources disagree on the same metric for the same date', () => {
    const rows = [
      contentRow({
        legacyCode: 'Д1', date: '2026-08-05',
        platforms: [{ platform: 'INSTAGRAM', title: 'Ролик', url: null, metrics: { VIEWS: 100 } }],
      }),
      contentRow({
        legacyCode: 'Д1', date: '2026-08-05',
        platforms: [{ platform: 'INSTAGRAM', title: 'Ролик', url: null, metrics: { VIEWS: 999 } }],
      }),
    ]
    const groups = dedupContentRows(rows)
    const result = buildContentEntities(groups, new Map([['Диамед', resolvedClientMatch]]))
    expect(result.exceptions.some(e => e.category === 'METRIC_CONFLICT')).toBe(true)
    expect(result.metrics).toHaveLength(1)
  })
})

describe('buildWorkItemCandidates', () => {
  it('flags CONTENT_MATCH_NOT_FOUND when the legacy code has no matching content item', () => {
    const row: SourceWorkPaymentRow = { trace: { file: 'f', sheet: 's', row: 1 }, clientHint: 'Диамед', legacyCode: 'Д999', title: null, date: null, amount: 1000, performerHint: null }
    const result = buildWorkItemCandidates([row], [], new Map([['Диамед', resolvedClientMatch]]))
    expect(result.exceptions.some(e => e.category === 'CONTENT_MATCH_NOT_FOUND')).toBe(true)
  })

  it('always flags NEEDS_EDITOR_MAPPING (source has no performer column at all) and creates no fake WorkItem', () => {
    const row: SourceWorkPaymentRow = { trace: { file: 'f', sheet: 's', row: 1 }, clientHint: 'Диамед', legacyCode: 'Д1', title: 'X', date: null, amount: 1000, performerHint: null }
    const groups = dedupContentRows([contentRow({ legacyCode: 'Д1' })])
    const built = buildContentEntities(groups, new Map([['Диамед', resolvedClientMatch]]))
    const result = buildWorkItemCandidates([row], built.contentItems, new Map([['Диамед', resolvedClientMatch]]))
    expect(result.workItems).toHaveLength(0)
    expect(result.exceptions.some(e => e.category === 'NEEDS_EDITOR_MAPPING')).toBe(true)
  })
})

describe('buildRecurringPayoutCandidates', () => {
  const editorMatch: EditorMatch = { nameHint: 'Лиза Терентьева', proposedEditorId: 'e1', proposedEditorName: 'Лиза Терентьева', proposedEditorCode: null, confidence: 'HIGH', evidence: [], notFound: false }

  function teamRow(overrides: Partial<SourceTeamPayoutRow>): SourceTeamPayoutRow {
    return { trace: { file: 'f', sheet: 's', row: 1 }, performerHint: 'Лиза Терентьева', clientHint: 'Диамед', month: 'Июль', dueDates: ['2026-07-02', '2026-07-17'], amounts: [20000, 20000], paid: true, ...overrides }
  }

  it('proposes a recurring payout only when the pattern repeats across 2+ distinct months', () => {
    const rows = [teamRow({ month: 'Июль' }), teamRow({ month: 'Август', dueDates: ['2026-08-02', '2026-08-17'] })]
    const result = buildRecurringPayoutCandidates(rows, new Map([['Лиза Терентьева', editorMatch]]), new Map([['Диамед', resolvedClientMatch]]))
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].daysOfMonth).toEqual([2, 17])
  })

  it('does not propose a recurring payout from a single month of evidence (real ТЗ requirement)', () => {
    const rows = [teamRow({ month: 'Июль' })]
    const result = buildRecurringPayoutCandidates(rows, new Map([['Лиза Терентьева', editorMatch]]), new Map([['Диамед', resolvedClientMatch]]))
    expect(result.proposals).toHaveLength(0)
  })

  it('does not propose a payout for an unmatched performer (real "Подрядчики" bucket case)', () => {
    const unmatchedEditor: EditorMatch = { nameHint: 'Подрядчики', proposedEditorId: null, proposedEditorName: null, proposedEditorCode: null, confidence: 'LOW', evidence: [], notFound: true }
    const rows = [teamRow({ performerHint: 'Подрядчики', month: 'Июль' }), teamRow({ performerHint: 'Подрядчики', month: 'Август' })]
    const result = buildRecurringPayoutCandidates(rows, new Map([['Подрядчики', unmatchedEditor]]), new Map([['Диамед', resolvedClientMatch]]))
    expect(result.proposals).toHaveLength(0)
    expect(result.exceptions.some(e => e.category === 'NEEDS_EDITOR_MAPPING')).toBe(true)
  })
})
