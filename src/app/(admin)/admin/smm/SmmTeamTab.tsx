'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import type { SmmProjectSummaryDTO, SmmProjectMembershipDTO } from '@/lib/actions/smm'
import { createStaffUser, type StaffUserDTO } from '@/lib/actions/users'
import { SMM_PROJECT_ROLE_LABELS } from '@/lib/smm-model'
import type { Role } from '@prisma/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'

interface Props {
  projects: SmmProjectSummaryDTO[]
  staff: StaffUserDTO[]
  initialMembers: SmmProjectMembershipDTO[]
}

export default function SmmTeamTab({ staff, initialMembers }: Props) {
  const [members] = useState(initialMembers)
  const [staffList, setStaffList] = useState(staff)
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byUser = new Map<string, { name: string; entries: SmmProjectMembershipDTO[] }>()
  for (const m of members) {
    const entry = byUser.get(m.userId) ?? { name: m.userName, entries: [] }
    entry.entries.push(m)
    byUser.set(m.userId, entry)
  }
  // Сотрудники платформы, у которых пока нет ни одной активной привязки к
  // SMM-проекту — видны в списке заранее, чтобы их можно было назначить.
  const staffWithoutProjects = staffList.filter(s => !byUser.has(s.id))

  async function handleAddStaff() {
    if (!name.trim() || !email.trim()) { setError('Укажите имя и email'); return }
    setSaving(true)
    setError(null)
    const result = await createStaffUser({ name, email, role: 'OPERATOR' as Role })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setStaffList(prev => [...prev, result.data])
    setName(''); setEmail(''); setAddOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Команда SMM</h3>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Добавить сотрудника
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/60">
        {[...byUser.entries()].map(([userId, { name: userName, entries }]) => (
          <div key={userId} className="px-5 py-3">
            <p className="text-zinc-100 text-sm font-medium">{userName}</p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {entries.map(e => (
                <span key={e.id} className="text-[11px] text-zinc-400 bg-zinc-800 rounded-full px-2 py-0.5">
                  {e.clientName ?? '—'} · {SMM_PROJECT_ROLE_LABELS[e.role]}
                </span>
              ))}
            </div>
          </div>
        ))}
        {byUser.size === 0 && <p className="text-zinc-500 text-sm px-5 py-6">Пока никто не назначен ни на один SMM-проект</p>}
      </div>

      {staffWithoutProjects.length > 0 && (
        <div>
          <h4 className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">Сотрудники без назначения на проект</h4>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/60">
            {staffWithoutProjects.map(s => (
              <div key={s.id} className="px-5 py-2.5 text-sm text-zinc-300">{s.name ?? s.email}</div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-lg font-semibold">Добавить сотрудника</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <input className={INPUT} placeholder="Имя (напр. Лиза Ванесова)" value={name} onChange={e => setName(e.target.value)} />
            <input className={INPUT} placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
          </div>
          <DialogFooter className="bg-zinc-900 border-zinc-800">
            <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Отмена</button>
            <button type="button" onClick={handleAddStaff} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
