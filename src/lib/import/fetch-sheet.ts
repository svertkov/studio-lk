// Загрузка Google-таблицы по ссылке в "сырую" таблицу строк — без проверки прав
// доступа (это делает вызывающий код). Вынесено из client-import.ts, чтобы этой
// же логикой могла пользоваться и автоматическая синхронизация (см. revenue-sync.ts),
// у которой нет авторизованной сессии сотрудника.

import ExcelJS from 'exceljs'
import { Readable } from 'stream'

export interface FetchSheetResult {
  ok: boolean
  table: string[][]
  error?: string
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map(r => r.text).join('')
    if ('text' in v) return String((v as { text: unknown }).text)
    if ('result' in v) return String((v as { result: unknown }).result ?? '')
    return ''
  }
  return String(v).trim()
}

function worksheetToTable(worksheet: ExcelJS.Worksheet): string[][] {
  const table: string[][] = []
  worksheet.eachRow(row => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellToString)
    table.push(values)
  })
  return table
}

export async function fetchGoogleSheetTable(url: string): Promise<FetchSheetResult> {
  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (!match) return { ok: false, table: [], error: 'Не похоже на ссылку на Google Таблицу' }

    const gidMatch = url.match(/[#&?]gid=(\d+)/)
    const gid = gidMatch ? gidMatch[1] : '0'
    const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`

    const res = await fetch(csvUrl)
    if (!res.ok) {
      return {
        ok: false, table: [],
        error: 'Не удалось открыть таблицу. Убедитесь, что доступ настроен как "Все, у кого есть ссылка — Читатель"',
      }
    }
    const csvText = await res.text()
    if (csvText.trim().startsWith('<')) {
      return {
        ok: false, table: [],
        error: 'Таблица недоступна по ссылке. Откройте доступ: Настройки доступа → "Все, у кого есть ссылка"',
      }
    }

    const workbook = new ExcelJS.Workbook()
    await workbook.csv.read(Readable.from(Buffer.from(csvText, 'utf-8')))
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return { ok: false, table: [], error: 'Таблица пуста' }

    const table = worksheetToTable(worksheet)
    if (table.length === 0) return { ok: false, table: [], error: 'Таблица пуста' }
    return { ok: true, table }
  } catch (e) {
    console.error('[fetchGoogleSheetTable]', e)
    return { ok: false, table: [], error: 'Не удалось загрузить таблицу по ссылке' }
  }
}
