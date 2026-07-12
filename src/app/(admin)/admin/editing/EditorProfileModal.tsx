'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getEditorProfileDetail, getEditorMonthlyStats, createEditorProfile, updateEditorProfile,
  type EditorProfileDetailDTO,
} from '@/lib/actions/editors'
import { getMontageProjectsForEditor, type MontageProjectDTO } from '@/lib/actions/montage'
import type { EditorMonthlyStats } from '@/lib/montage-model'
import MontageStatusBadge from './MontageStatusBadge'

const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none'
const LABEL = 'block text-zinc-400 text-xs'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}
function FieldLabel({ children }: { children: ReactNode }) {
  return <label className={LABEL}>{children}</label>
}

function formatMoney(v: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}
function formatDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}
function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthKeyLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface Props {
  editorId: string | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  onOpenProject: (project: MontageProjectDTO) => void
}

export default function EditorProfileModal({ editorId, onOpenChange, onSaved, onOpenProject }: Props) {
  const isCreate = !editorId

  const [detail, setDetail] = useState<EditorProfileDetailDTO | null>(null)
  const [projects, setProjects] = useState<MontageProjectDTO[]>([])
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  const [monthlyStats, setMonthlyStats] = useState<EditorMonthlyStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [telegram, setTelegram] = useState('')
  const [email, setEmail] = useState('')
  const [specialization, setSpecialization] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)

  useEffect(() => {
    if (!editorId) return
    let cancelled = false
    getEditorProfileDetail(editorId).then(res => {
      if (cancelled || !res.ok) return
      setDetail(res.data)
      setDisplayName(res.data.displayName)
      setFirstName(res.data.firstName ?? '')
      setLastName(res.data.lastName ?? '')
      setPhone(res.data.phone ?? '')
      setTelegram(res.data.telegram ?? '')
      setEmail(res.data.email ?? '')
      setSpecialization(res.data.specialization ?? '')
      setNotes(res.data.notes ?? '')
      setActive(res.data.active)
    })
    getMontageProjectsForEditor(editorId).then(res => { if (!cancelled) setProjects(res.data) })
    return () => { cancelled = true }
  }, [editorId])

  useEffect(() => {
    if (!editorId) return
    let cancelled = false
    getEditorMonthlyStats(editorId, monthKey).then(res => { if (!cancelled && res.ok) setMonthlyStats(res.data) })
    return () => { cancelled = true }
  }, [editorId, monthKey])

  async function handleSave() {
    if (!displayName.trim()) { setError('Укажите имя монтажёра'); return }
    setSaving(true)
    setError(null)
    const input = {
      displayName, firstName: firstName || undefined, lastName: lastName || undefined,
      phone: phone || undefined, telegram: telegram || undefined, email: email || undefined,
      specialization: specialization || undefined, notes: notes || undefined, active,
    }
    const result = isCreate ? await createEditorProfile(input) : await updateEditorProfile(editorId!, input)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onSaved()
    if (!isCreate) onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-2xl max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0 pr-8">
          <DialogTitle className="text-white text-lg font-semibold">{isCreate ? 'Новый монтажёр' : (detail?.displayName ?? 'Монтажёр')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 mb-3">{error}</p>}

          {!isCreate && detail && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">Проектов всего</p>
                  <p className="text-white text-lg font-semibold">{detail.summary.totalProjects}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">Сдано</p>
                  <p className="text-white text-lg font-semibold">{detail.summary.deliveredProjects}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">В работе</p>
                  <p className="text-white text-lg font-semibold">{detail.summary.activeProjects}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">Ср. срок сдачи</p>
                  <p className="text-white text-lg font-semibold">{detail.summary.avgTurnaroundDays != null ? `${detail.summary.avgTurnaroundDays.toFixed(0)} дн.` : '—'}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">Заработал всего</p>
                  <p className="text-white text-lg font-semibold">{formatMoney(detail.summary.totalEarned)}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">Выплачено</p>
                  <p className="text-white text-lg font-semibold">{formatMoney(detail.summary.paidEarned)}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">Прибыль студии</p>
                  <p className="text-white text-lg font-semibold">{formatMoney(detail.summary.studioProfit)}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-zinc-500 text-[11px]">Средний чек</p>
                  <p className="text-white text-lg font-semibold">{detail.summary.avgProjectAmount != null ? formatMoney(detail.summary.avgProjectAmount) : '—'}</p>
                </div>
              </div>

              <p className={SECTION}>Аналитика по месяцам</p>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setMonthKey(k => shiftMonthKey(k, -1))} className="text-zinc-400 hover:text-white text-sm px-2">←</button>
                <p className="text-zinc-200 text-sm font-medium capitalize">{monthKeyLabel(monthKey)}</p>
                <button type="button" onClick={() => setMonthKey(k => shiftMonthKey(k, 1))} className="text-zinc-400 hover:text-white text-sm px-2">→</button>
              </div>
              {monthlyStats && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-2">
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-zinc-500 text-[11px]">Проектов</p>
                    <p className="text-zinc-100 text-sm font-medium">{monthlyStats.projectsCount}</p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-zinc-500 text-[11px]">Сдано / в работе</p>
                    <p className="text-zinc-100 text-sm font-medium">{monthlyStats.deliveredCount} / {monthlyStats.activeCount}</p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-zinc-500 text-[11px]">Просрочено</p>
                    <p className="text-zinc-100 text-sm font-medium">{monthlyStats.overdueCount}</p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-zinc-500 text-[11px]">Выплата монтажёру</p>
                    <p className="text-zinc-100 text-sm font-medium">{formatMoney(monthlyStats.editorEarned)}</p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-zinc-500 text-[11px]">Выручка от клиентов</p>
                    <p className="text-zinc-100 text-sm font-medium">{formatMoney(monthlyStats.clientRevenue)}</p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <p className="text-zinc-500 text-[11px]">Прибыль студии</p>
                    <p className="text-zinc-100 text-sm font-medium">{formatMoney(monthlyStats.studioProfit)}</p>
                  </div>
                </div>
              )}

              <p className={SECTION}>Проекты монтажёра</p>
              {projects.length === 0 ? (
                <p className="text-zinc-500 text-sm py-4">У этого монтажёра пока нет проектов</p>
              ) : (
                <div className="space-y-1.5">
                  {projects.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onOpenProject(p)}
                      className="w-full flex items-center justify-between gap-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-zinc-200 text-sm truncate">{p.title ?? p.clientName ?? 'Без названия'}</p>
                        <p className="text-zinc-500 text-xs truncate">{formatDate(p.sourceReceivedAt)} · {p.clientName ?? '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-zinc-400 text-xs">{formatMoney(p.editorAmount ?? 0)}</span>
                        <MontageStatusBadge status={p.status} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <p className={SECTION}>{isCreate ? 'Данные монтажёра' : 'Контактные данные'}</p>
          <div className="space-y-3">
            <Field>
              <FieldLabel>Имя для отображения *</FieldLabel>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Например: Сергей Зубарев" className={INPUT} />
            </Field>
            <Row>
              <Field><FieldLabel>Имя</FieldLabel><input value={firstName} onChange={e => setFirstName(e.target.value)} className={INPUT} /></Field>
              <Field><FieldLabel>Фамилия</FieldLabel><input value={lastName} onChange={e => setLastName(e.target.value)} className={INPUT} /></Field>
            </Row>
            <Row>
              <Field><FieldLabel>Телефон</FieldLabel><input value={phone} onChange={e => setPhone(e.target.value)} className={INPUT} /></Field>
              <Field><FieldLabel>Telegram</FieldLabel><input value={telegram} onChange={e => setTelegram(e.target.value)} className={INPUT} /></Field>
            </Row>
            <Row>
              <Field><FieldLabel>Email</FieldLabel><input value={email} onChange={e => setEmail(e.target.value)} className={INPUT} /></Field>
              <Field><FieldLabel>Специализация</FieldLabel><input value={specialization} onChange={e => setSpecialization(e.target.value)} placeholder="Монтаж, моушен, звук..." className={INPUT} /></Field>
            </Row>
            <Field>
              <FieldLabel>Заметки</FieldLabel>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={TEXTAREA} />
            </Field>
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-[#00c26b]" />
              Активен (доступен для назначения на новые проекты)
            </label>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex-shrink-0 flex items-center gap-3">
          <button type="button" onClick={handleSave} disabled={saving} className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
            Закрыть
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
