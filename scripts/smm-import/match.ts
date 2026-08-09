// Сопоставление подсказок (из имени файла/легаси-кода/имени сотрудника) с
// РЕАЛЬНЫМИ Client/SmmProject/EditorProfile (ТЗ п.6/21) — чистые функции,
// принимающие уже загруженные из БД списки (тестируемо без БД; сам запрос
// к Prisma — в dry-run.ts).

import type { ClientMatch, Confidence, EditorMatch } from './types'
import { CLIENT_NAME_SYNONYMS, normalizeName } from './dictionaries'

export interface ExistingClient {
  id: string
  name: string
}
export interface ExistingSmmProject {
  id: string
  clientId: string
  projectCode: string | null
}
export interface ExistingEditor {
  id: string
  displayName: string
  editorCode: string | null
}

function synonymsFor(clientHint: string): string[] {
  const canonical = Object.keys(CLIENT_NAME_SYNONYMS).find(k => normalizeName(k) === normalizeName(clientHint))
  if (canonical) return CLIENT_NAME_SYNONYMS[canonical]
  return [normalizeName(clientHint)]
}

// Один clientHint → лучший найденный Client + (если есть) его SmmProject.
// Confidence HIGH только при точном совпадении нормализованного имени;
// частичное вхождение — MEDIUM (нужна проверка человеком, ТЗ п.6/11);
// ничего не найдено — missingClient/missingProject, не создаём нового клиента.
export function matchClient(
  source: string,
  clientHint: string,
  clients: ExistingClient[],
  projects: ExistingSmmProject[],
): ClientMatch {
  const synonyms = synonymsFor(clientHint)
  const hintNorm = normalizeName(clientHint)

  let bestClient: ExistingClient | null = null
  let confidence: Confidence = 'LOW'
  const evidence: string[] = []

  for (const c of clients) {
    const nameNorm = normalizeName(c.name)
    if (synonyms.includes(nameNorm) || nameNorm === hintNorm) {
      bestClient = c
      confidence = 'HIGH'
      evidence.push(`точное совпадение имени клиента: "${c.name}" ↔ подсказка "${clientHint}"`)
      break
    }
  }
  if (!bestClient) {
    for (const c of clients) {
      const nameNorm = normalizeName(c.name)
      if (nameNorm.includes(hintNorm) || hintNorm.includes(nameNorm) || synonyms.some(s => nameNorm.includes(s) || s.includes(nameNorm))) {
        bestClient = c
        confidence = 'MEDIUM'
        evidence.push(`частичное совпадение имени: "${c.name}" ~ подсказка "${clientHint}" — требует проверки`)
        break
      }
    }
  }

  if (!bestClient) {
    return {
      source, clientHint, proposedClientId: null, proposedClientName: null,
      proposedSmmProjectId: null, proposedProjectCode: null,
      confidence: 'LOW', evidence: [`клиент "${clientHint}" не найден среди существующих Client — нужен MISSING_CLIENT`],
      missingClient: true, missingProject: true,
    }
  }

  const project = projects.find(p => p.clientId === bestClient!.id)
  if (!project) {
    return {
      source, clientHint, proposedClientId: bestClient.id, proposedClientName: bestClient.name,
      proposedSmmProjectId: null, proposedProjectCode: null,
      confidence, evidence: [...evidence, `у клиента "${bestClient.name}" ещё нет SmmProject — нужен MISSING_PROJECT`],
      missingClient: false, missingProject: true,
    }
  }

  return {
    source, clientHint, proposedClientId: bestClient.id, proposedClientName: bestClient.name,
    proposedSmmProjectId: project.id, proposedProjectCode: project.projectCode,
    confidence, evidence, missingClient: false, missingProject: false,
  }
}

// Имя исполнителя из Excel → EditorProfile. Осознанно НЕ создаёт новый
// профиль на "похожесть" (ТЗ п.5/21) — только точное совпадение
// нормализованного displayName даёт HIGH; всё остальное — EDITOR_NOT_FOUND.
export function matchEditor(nameHint: string, editors: ExistingEditor[]): EditorMatch {
  const hintNorm = normalizeName(nameHint)
  const exact = editors.find(e => normalizeName(e.displayName) === hintNorm)
  if (exact) {
    return {
      nameHint, proposedEditorId: exact.id, proposedEditorName: exact.displayName, proposedEditorCode: exact.editorCode,
      confidence: 'HIGH', evidence: [`точное совпадение displayName: "${exact.displayName}"`], notFound: false,
    }
  }
  // Частичное совпадение (одно имя входит в другое) — MEDIUM, НЕ авто-применяется.
  const partial = editors.find(e => {
    const n = normalizeName(e.displayName)
    return n.includes(hintNorm) || hintNorm.includes(n)
  })
  if (partial) {
    return {
      nameHint, proposedEditorId: partial.id, proposedEditorName: partial.displayName, proposedEditorCode: partial.editorCode,
      confidence: 'MEDIUM', evidence: [`частичное совпадение: "${partial.displayName}" ~ "${nameHint}" — требует проверки человеком`], notFound: false,
    }
  }
  return {
    nameHint, proposedEditorId: null, proposedEditorName: null, proposedEditorCode: null,
    confidence: 'LOW', evidence: [`ни один EditorProfile не совпадает с "${nameHint}"`], notFound: true,
  }
}
