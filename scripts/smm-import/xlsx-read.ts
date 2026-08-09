// Чтение "сырого" грида листа через ExcelJS (уже зависимость проекта, см.
// src/lib/import/fetch-sheet.ts) — единственное место, которое трогает
// файловую систему/библиотеку парсинга. Всё остальное (classify/extract/...)
// работает над уже прочитанным RawGrid и не знает про ExcelJS вообще.

import ExcelJS from 'exceljs'
import path from 'node:path'

export interface RawGrid {
  file: string
  sheet: string
  dimensions: string
  maxRow: number
  maxCol: number
  // Excel часто форматирует лист на 1000+ строк вперёд, даже если реальных
  // данных в разы меньше — worksheet.rowCount/columnCount отражают это
  // "объявленное" число, а maxRow/maxCol выше — реальный использованный
  // диапазон (worksheet.dimensions). Расхождение между ними — сигнал
  // SPARSE_SHEET_DIMENSIONS для classify.ts, сама итерация всегда идёт по
  // реальному диапазону (иначе на 10 файлах читали бы лишние тысячи пустых строк).
  declaredMaxRow: number
  declaredMaxCol: number
  // rows[r][c], 0-based; ExcelJS-значения приведены к простым типам
  // (Date/number/string/null) — richText/formula-результат уже развёрнуты.
  rows: unknown[][]
  mergedRanges: string[]
  hiddenRows: number[]
  hiddenCols: number[]
}

// Разворачивает ExcelJS.CellValue до простого значения (Date/number/string/
// null) — тот же принцип, что cellToString в fetch-sheet.ts/client-import.ts,
// но здесь сохраняем тип (Date остаётся Date, число остаётся числом), а не
// сразу приводим к строке — normalize.ts сам решает, как каждый тип разбирать.
function cellToPlain(v: ExcelJS.CellValue): unknown {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map(r => r.text).join('')
    if ('result' in v) return cellToPlain((v as { result: ExcelJS.CellValue }).result)
    // Гиперссылка-ячейка: { text: <строка | richText>, hyperlink: <url> } — text
    // рекурсивно разворачивается (сам может быть richText-объектом, реальный
    // случай в ЗубовЛаб Рабочая.xlsx), hyperlink — запасной вариант, если text пуст.
    if ('text' in v) {
      const resolved = cellToPlain((v as { text: ExcelJS.CellValue }).text)
      if (typeof resolved === 'string' && resolved.trim() !== '') return resolved
      if ('hyperlink' in v) return String((v as { hyperlink: unknown }).hyperlink)
      return resolved
    }
    if ('hyperlink' in v) return String((v as { hyperlink: unknown }).hyperlink)
    if ('error' in v) return null // формула вернула #REF!/#N/A и т.п. — не выдаём как значение
    return null
  }
  return v
}

export async function readWorkbookGrids(filePath: string): Promise<RawGrid[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const fileName = path.basename(filePath)
  const grids: RawGrid[] = []

  for (const worksheet of workbook.worksheets) {
    const declaredMaxRow = worksheet.rowCount
    const declaredMaxCol = worksheet.columnCount
    // worksheet.dimensions — реально ИСПОЛЬЗОВАННЫЙ диапазон (ExcelJS сам
    // сканирует, где данные реально заканчиваются), а не "объявленный"
    // Excel'ем диапазон форматирования — на реальных файлах разница доходит
    // до 1000 против 45 строк (см. комментарий у declaredMaxRow в RawGrid).
    const usedRef = worksheet.dimensions
    const maxRow = usedRef ? usedRef.bottom : declaredMaxRow
    const maxCol = usedRef ? usedRef.right : declaredMaxCol

    const rows: unknown[][] = []
    for (let r = 1; r <= maxRow; r++) {
      const row = worksheet.getRow(r)
      const cells: unknown[] = []
      for (let c = 1; c <= maxCol; c++) {
        cells.push(cellToPlain(row.getCell(c).value))
      }
      rows.push(cells)
    }

    const hiddenRows: number[] = []
    for (let r = 1; r <= maxRow; r++) {
      if (worksheet.getRow(r).hidden) hiddenRows.push(r)
    }
    const hiddenCols: number[] = []
    worksheet.columns?.forEach((col, idx) => {
      if (col?.hidden) hiddenCols.push(idx + 1)
    })

    const mergedRanges: string[] = []
    // ExcelJS хранит merges в приватной структуре без публичного enumerable
    // API одной строкой — model.merges даёт список строк вида "A1:B2".
    const model = worksheet.model as unknown as { merges?: string[] }
    if (model.merges) mergedRanges.push(...model.merges)

    grids.push({
      file: fileName,
      sheet: worksheet.name,
      dimensions: usedRef?.toString?.() ?? `A1:${colLetter(maxCol)}${maxRow}`,
      maxRow,
      maxCol,
      declaredMaxRow,
      declaredMaxCol,
      rows,
      mergedRanges,
      hiddenRows,
      hiddenCols,
    })
  }
  return grids
}

export function colLetter(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const rem = (x - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}
