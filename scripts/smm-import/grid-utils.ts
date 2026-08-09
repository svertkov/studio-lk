// Общие утилиты работы с "сырым" гридом (merge-fill, парсинг диапазонов) —
// вынесены из extract.ts, т.к. нужны и classify.ts в перспективе.

import type { RawGrid } from './xlsx-read'

function parseCellRef(ref: string): { row: number; col: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return { row: 1, col: 1 }
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: parseInt(m[2], 10), col }
}

export function parseRange(range: string): { r1: number; c1: number; r2: number; c2: number } {
  const [a, b] = range.split(':')
  const pa = parseCellRef(a)
  const pb = parseCellRef(b ?? a)
  return { r1: pa.row, c1: pa.col, r2: pb.row, c2: pb.col }
}

// Объединённые ячейки Excel физически хранят значение только в верхней
// левой ячейке диапазона — остальные читаются как null. Для реконструкции
// многоуровневых заголовков (Площадка → Инстаграм → просмотры) и
// действительно объединённых значений данных нужно "растянуть" значение
// на весь диапазон. Возвращает НОВУЮ матрицу, не мутирует grid.rows.
export function fillMergedCells(grid: RawGrid): unknown[][] {
  const rows = grid.rows.map(r => [...r])
  for (const range of grid.mergedRanges) {
    const { r1, c1, r2, c2 } = parseRange(range)
    const master = rows[r1 - 1]?.[c1 - 1] ?? null
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue
        if (rows[r - 1]) rows[r - 1][c - 1] = master
      }
    }
  }
  return rows
}
