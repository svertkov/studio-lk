'use client'

import { useState } from 'react'
import {
  Upload, FileSpreadsheet, FileText, Link2, Loader2, File as FileIcon,
  X, Info, AlertCircle, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  parseExcelFile, parsePdfFile, parseGoogleSheetUrl, analyzeImportTable, confirmImport,
  type AnalyzeResult, type PreviewClient,
} from '@/lib/actions/client-import'
import { FIELD_LABELS, type ImportField } from '@/lib/import/detect'

interface Props {
  onSuccess: () => void
}

type Mode = 'excel' | 'pdf' | 'sheet'

const IMPORT_SOURCE: Record<Mode, 'EXCEL' | 'PDF' | 'GOOGLE_SHEET'> = {
  excel: 'EXCEL', pdf: 'PDF', sheet: 'GOOGLE_SHEET',
}

const FORMATS: { mode: Mode; label: string; icon: typeof FileSpreadsheet }[] = [
  { mode: 'excel', label: 'Excel / CSV', icon: FileSpreadsheet },
  { mode: 'pdf', label: 'PDF', icon: FileText },
  { mode: 'sheet', label: 'Google-таблица', icon: Link2 },
]

const ALL_FIELDS = Object.keys(FIELD_LABELS) as ImportField[]

const LABEL_CLASS = 'block text-zinc-400 text-xs font-medium mb-2'
const INPUT_CLASS = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT_CLASS = 'bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md px-2 py-1.5 outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

const STATUS_BADGE: Record<PreviewClient['status'], { label: string; className: string }> = {
  new:                { label: 'Новый',          className: 'border-zinc-700 text-zinc-400' },
  existing:           { label: 'Уже есть',       className: 'border-blue-700 text-blue-400' },
  possible_duplicate: { label: 'Возможно дубль', className: 'border-amber-700 text-amber-400' },
}

export default function ImportClientsModal({ onSuccess }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('excel')
  const [fileName, setFileName] = useState<string | null>(null)
  const [sheetUrl, setSheetUrl] = useState('')

  const [table, setTable] = useState<string[][] | null>(null)
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ createdClients: number; updatedClients: number; createdVisits: number; skippedVisits: number } | null>(null)

  function reset() {
    setFileName(null)
    setSheetUrl('')
    setTable(null)
    setAnalysis(null)
    setError(null)
    setImportResult(null)
  }

  function switchMode(m: Mode) {
    setMode(m)
    reset()
  }

  function clearFile() {
    setFileName(null)
    setTable(null)
    setAnalysis(null)
    setError(null)
    setImportResult(null)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError(null)
    setAnalysis(null)
    setImportResult(null)
    setParsing(true)

    const formData = new FormData()
    formData.set('file', file)

    if (mode === 'pdf') {
      const res = await parsePdfFile(formData)
      setTable(null)
      setAnalysis(res)
      if (!res.ok) setError(res.error ?? 'Не удалось обработать файл')
    } else {
      const raw = await parseExcelFile(formData)
      if (!raw.ok) {
        setError(raw.error ?? 'Не удалось прочитать файл')
        setParsing(false)
        return
      }
      setTable(raw.table)
      const res = await analyzeImportTable(raw.table)
      setAnalysis(res)
      if (!res.ok) setError(res.error ?? 'Не удалось проанализировать файл')
    }
    setParsing(false)
  }

  async function handleCheckSheet() {
    if (!sheetUrl.trim()) return
    setError(null)
    setAnalysis(null)
    setImportResult(null)
    setParsing(true)

    const raw = await parseGoogleSheetUrl(sheetUrl.trim())
    if (!raw.ok) {
      setError(raw.error ?? 'Не удалось загрузить таблицу')
      setTable(null)
      setParsing(false)
      return
    }
    setTable(raw.table)
    const res = await analyzeImportTable(raw.table)
    setAnalysis(res)
    if (!res.ok) setError(res.error ?? 'Не удалось проанализировать таблицу')
    setParsing(false)
  }

  async function handleOverrideColumn(index: number, field: ImportField | null) {
    if (!table || !analysis) return
    // Передаём поле для ВСЕХ колонок (не только изменённую), чтобы результат
    // первого анализа (в т.ч. распознанный ИИ) закрепился и не пересчитывался заново
    const overrideList = analysis.columns.map(c => ({
      index: c.index,
      field: c.index === index ? field : c.field,
    }))
    setParsing(true)
    const res = await analyzeImportTable(table, overrideList)
    setAnalysis(res)
    setError(res.ok ? null : (res.error ?? 'Не удалось проанализировать таблицу'))
    setParsing(false)
  }

  async function handleImport() {
    if (!analysis?.ok || analysis.clients.length === 0) return
    setImporting(true)
    const res = await confirmImport(analysis.clients, IMPORT_SOURCE[mode])
    setImporting(false)
    if (res.ok) {
      setImportResult({ createdClients: res.createdClients, updatedClients: res.updatedClients, createdVisits: res.createdVisits, skippedVisits: res.skippedVisits })
      setAnalysis(null)
      setFileName(null)
      setTable(null)
      onSuccess()
    } else {
      setError(res.error ?? 'Не удалось импортировать клиентов')
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) { reset(); setMode('excel') }
  }

  const canImport = Boolean(analysis?.ok && analysis.clients.length > 0)
  const newCount = analysis?.ok ? analysis.clients.filter(c => c.status === 'new').length : 0
  const existingCount = analysis?.ok ? analysis.clients.filter(c => c.status === 'existing').length : 0
  const dupCount = analysis?.ok ? analysis.clients.filter(c => c.status === 'possible_duplicate').length : 0
  const visitsCount = analysis?.ok ? analysis.clients.reduce((s, c) => s + c.visitsCount, 0) : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors">
        <Upload className="w-4 h-4" />
        Импортировать базу
      </DialogTrigger>

      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg sm:max-w-2xl max-h-[88vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-5 border-b border-zinc-800 flex-shrink-0">
          <DialogTitle className="text-white text-base font-semibold">Импорт клиентов</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Выбор формата */}
          <div className="grid grid-cols-3 gap-2.5">
            {FORMATS.map(({ mode: m, label, icon: Icon }) => {
              const active = mode === m
              return (
                <button key={m} type="button" onClick={() => switchMode(m)}
                  className={`flex flex-col items-center justify-center gap-2 h-20 rounded-xl border px-2 text-center transition-colors cursor-pointer ${
                    active
                      ? 'border-[#00c26b] bg-[#00c26b]/10 text-white'
                      : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200'
                  }`}>
                  <Icon className={`w-5 h-5 ${active ? 'text-[#00c26b]' : 'text-zinc-500'}`} />
                  <span className="text-xs font-medium leading-tight">{label}</span>
                </button>
              )
            })}
          </div>

          {/* Файл: Excel/CSV или PDF */}
          {(mode === 'excel' || mode === 'pdf') && (
            <div>
              <label className={LABEL_CLASS}>
                {mode === 'excel' ? 'Файл Excel (.xlsx) или CSV' : 'PDF-файл со списком клиентов'}
              </label>

              {!fileName ? (
                <label className="w-full flex items-center justify-center gap-2 border border-dashed border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/40 rounded-lg py-5 text-sm text-zinc-400 hover:text-zinc-300 transition-colors cursor-pointer">
                  <Upload className="w-4 h-4" />
                  Выберите файл
                  <input type="file" accept={mode === 'excel' ? '.xlsx,.xls,.csv' : '.pdf'}
                    onChange={handleFile} className="hidden" />
                </label>
              ) : (
                <div className="flex items-center gap-2.5 border border-zinc-700 bg-zinc-800/60 rounded-lg px-3 py-2.5">
                  <FileIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <span className="flex-1 text-sm text-zinc-200 truncate min-w-0">{fileName}</span>
                  <button type="button" onClick={clearFile}
                    className="flex-shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {mode === 'excel' ? (
                <div className="flex gap-2.5 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2.5 mt-3">
                  <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="text-zinc-300">Колонки могут называться как угодно — система сама попробует их распознать</p>
                    <p className="text-zinc-500">Имя, Телефон, Email, Зал, Формат, Часы, Сумма и т.д. — ниже можно поправить вручную</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2.5 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2.5 mt-3">
                  <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-400">
                    Распознавание из PDF менее надёжно, чем из таблицы — проверьте результат в превью перед импортом
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Ссылка на Google-таблицу */}
          {mode === 'sheet' && (
            <div>
              <label className={LABEL_CLASS}>Ссылка на Google Таблицу</label>
              <div className="flex gap-2">
                <input className={INPUT_CLASS} placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} />
                <button onClick={handleCheckSheet} disabled={parsing || !sheetUrl.trim()}
                  className="flex-shrink-0 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 text-zinc-200 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors cursor-pointer">
                  Проверить
                </button>
              </div>
              <div className="flex gap-2.5 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2.5 mt-3">
                <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-400">
                  Таблица должна быть доступна по ссылке: «Настройки доступа» → «Все, у кого есть ссылка» → «Читатель». Если в ссылке есть <code className="text-zinc-300">#gid=...</code>, импортируется именно этот лист.
                </p>
              </div>
            </div>
          )}

          {/* Статусы */}
          {parsing && (
            <div className="flex items-center gap-2 text-zinc-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Анализирую данные...
            </div>
          )}

          {error && (
            <div className="flex gap-2.5 text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {analysis?.ok && (
            <div className="space-y-4">
              {/* Сводка */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <SummaryStat label="Строк найдено" value={analysis.totalRows} />
                <SummaryStat label="Новых клиентов" value={newCount} />
                <SummaryStat label="Уже есть в базе" value={existingCount} />
                <SummaryStat label="Визитов будет добавлено" value={visitsCount} />
              </div>
              {(dupCount > 0 || analysis.skippedNoName > 0) && (
                <p className="text-amber-400 text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {dupCount > 0 && `Возможных дублей: ${dupCount}. `}
                  {analysis.skippedNoName > 0 && `Пропущено строк без имени: ${analysis.skippedNoName}.`}
                </p>
              )}

              {/* Сопоставление колонок — только для табличных источников */}
              {analysis.columns.length > 0 && (
                <div className="border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400 font-medium">Сопоставление колонок</div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-zinc-800/60">
                    {analysis.columns.map(col => (
                      <div key={col.index} className="flex items-center gap-2 px-3 py-2">
                        <span className="flex-1 text-xs text-zinc-300 truncate">{col.header || `Колонка ${col.index + 1}`}</span>
                        {col.confidence === 'low' && (
                          <span className="text-[10px] text-amber-400 border border-amber-700/60 rounded px-1.5 py-0.5 flex-shrink-0">проверьте</span>
                        )}
                        {col.confidence === 'ai' && (
                          <span className="text-[10px] text-[#00c26b] border border-[#00c26b]/40 rounded px-1.5 py-0.5 flex-shrink-0">определено ИИ</span>
                        )}
                        <select className={SELECT_CLASS} value={col.field ?? ''}
                          onChange={e => handleOverrideColumn(col.index, (e.target.value || null) as ImportField | null)}>
                          <option value="">Игнорировать</option>
                          {ALL_FIELDS.map(f => (
                            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Клиенты */}
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-56">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-800/60 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-zinc-400 font-medium">Клиент</th>
                        <th className="text-left px-3 py-2 text-zinc-400 font-medium">Контакт</th>
                        <th className="text-left px-3 py-2 text-zinc-400 font-medium">Визитов</th>
                        <th className="text-left px-3 py-2 text-zinc-400 font-medium">Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.clients.slice(0, 50).map((c: PreviewClient) => (
                        <tr key={c.key} className="border-t border-zinc-800/60">
                          <td className="px-3 py-1.5 text-zinc-200">
                            <span className="flex items-center gap-1.5">
                              {[c.lastName, c.firstName, c.patronymic].filter(Boolean).join(' ')}
                              {c.warnings.length > 0 && (
                                <span title={c.warnings.join('; ')}>
                                  <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-zinc-400">{c.phone ?? c.email ?? c.telegram ?? '—'}</td>
                          <td className="px-3 py-1.5 text-zinc-400">{c.visitsCount}</td>
                          <td className="px-3 py-1.5">
                            <span className={`text-[10px] border rounded px-1.5 py-0.5 ${STATUS_BADGE[c.status].className}`}>
                              {STATUS_BADGE[c.status].label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {analysis.clients.length > 50 && (
                  <p className="text-zinc-500 text-xs px-3 py-2 border-t border-zinc-800">
                    ...и ещё {analysis.clients.length - 50}
                  </p>
                )}
              </div>
            </div>
          )}

          {importResult && (
            <div className="flex gap-2.5 text-[#00c26b] text-sm bg-[#00c26b]/10 border border-[#00c26b]/30 rounded-lg px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>
                Новых клиентов: {importResult.createdClients}, обновлено существующих: {importResult.updatedClients}, добавлено визитов: {importResult.createdVisits}
                {importResult.skippedVisits > 0 && <>, пропущено уже загруженных: {importResult.skippedVisits}</>}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button type="button" disabled={!canImport || importing}
            onClick={handleImport}
            className="flex-[2] flex items-center justify-center gap-2 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#00c26b] text-white font-semibold text-sm py-2.5 rounded-lg transition-colors cursor-pointer">
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            {importing ? 'Импортируем...' : `Импортировать${analysis?.ok ? ` ${analysis.clients.length}` : ''} клиентов`}
          </button>
          <button type="button" onClick={() => setOpen(false)}
            className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition-colors cursor-pointer">
            Закрыть
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2.5">
      <p className="text-white text-lg font-semibold">{value}</p>
      <p className="text-zinc-500 text-[11px] mt-0.5 leading-tight">{label}</p>
    </div>
  )
}
