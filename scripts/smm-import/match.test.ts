import { describe, it, expect } from 'vitest'
import { matchClient, matchEditor, type ExistingClient, type ExistingEditor, type ExistingSmmProject } from './match'

const clients: ExistingClient[] = [
  { id: 'c1', name: 'Диамед' },
  { id: 'c2', name: 'Виктор Пастернак' },
]
const projects: ExistingSmmProject[] = [
  { id: 'p1', clientId: 'c1', projectCode: 'DIA' },
]
const editors: ExistingEditor[] = [
  { id: 'e1', displayName: 'Лиза Терентьева', editorCode: null },
]

describe('matchClient', () => {
  it('matches by exact synonym with HIGH confidence and resolves the existing SmmProject', () => {
    const m = matchClient('src', 'Диамед', clients, projects)
    expect(m.confidence).toBe('HIGH')
    expect(m.proposedClientId).toBe('c1')
    expect(m.proposedSmmProjectId).toBe('p1')
    expect(m.missingClient).toBe(false)
    expect(m.missingProject).toBe(false)
  })

  it('flags missingProject when the client exists but has no SmmProject yet', () => {
    const m = matchClient('src', 'Пастернак', clients, projects)
    expect(m.missingClient).toBe(false)
    expect(m.missingProject).toBe(true)
    expect(m.proposedClientId).toBe('c2')
  })

  it('does not invent a client for an unknown hint (MISSING_CLIENT)', () => {
    const m = matchClient('src', 'ЗубовЛаб', clients, projects)
    expect(m.missingClient).toBe(true)
    expect(m.proposedClientId).toBeNull()
  })

  it('does not silently merge a typo variant at HIGH confidence (real "Иван Алеексеев" vs "Иван Алексеев" case)', () => {
    const withTypo: ExistingClient[] = [{ id: 'c3', name: 'Иван Алексеев' }]
    const m = matchClient('src', 'Иван Алеексеев', withTypo, [])
    expect(m.confidence).not.toBe('HIGH')
  })
})

describe('matchEditor', () => {
  it('matches an exact displayName at HIGH confidence', () => {
    const m = matchEditor('Лиза Терентьева', editors)
    expect(m.confidence).toBe('HIGH')
    expect(m.proposedEditorId).toBe('e1')
    expect(m.notFound).toBe(false)
  })

  it('does not auto-create/merge a different real person (real "Лиза Ваниосова" case)', () => {
    const m = matchEditor('Лиза Ваниосова', editors)
    expect(m.notFound).toBe(true)
    expect(m.proposedEditorId).toBeNull()
  })

  it('does not match a generic bucket like "Подрядчики" to any real editor', () => {
    const m = matchEditor('Подрядчики', editors)
    expect(m.notFound).toBe(true)
  })
})
