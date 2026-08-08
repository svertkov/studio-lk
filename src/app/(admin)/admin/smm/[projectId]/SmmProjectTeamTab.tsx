'use client'

import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { addSmmProjectMember, removeSmmProjectMember, type SmmProjectMemberDTO } from '@/lib/actions/smm'
import type { StaffUserDTO } from '@/lib/actions/users'
import { SMM_PROJECT_ROLE_LABELS } from '@/lib/smm-model'
import type { SmmProjectRole } from '@prisma/client'

const SELECT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

interface Props {
  smmProjectId: string
  members: SmmProjectMemberDTO[]
  setMembers: (updater: (prev: SmmProjectMemberDTO[]) => SmmProjectMemberDTO[]) => void
  staff: StaffUserDTO[]
}

export default function SmmProjectTeamTab({ smmProjectId, members, setMembers, staff }: Props) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<SmmProjectRole>('SMM_MANAGER')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = members.filter(m => !m.activeTo)

  async function handleAdd() {
    if (!userId) return
    setSaving(true)
    setError(null)
    const result = await addSmmProjectMember(smmProjectId, userId, role)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setMembers(prev => [...prev, result.data])
    setUserId('')
  }

  async function handleRemove(id: string) {
    const result = await removeSmmProjectMember(id)
    if (result.ok) setMembers(prev => prev.map(m => m.id === id ? { ...m, activeTo: new Date().toISOString() } : m))
  }

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-zinc-400 text-xs mb-1.5">Сотрудник</label>
          <select className={`${SELECT} w-full`} value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">Выберите сотрудника...</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-zinc-400 text-xs mb-1.5">Роль в проекте</label>
          <select className={SELECT} value={role} onChange={e => setRole(e.target.value as SmmProjectRole)}>
            {(Object.keys(SMM_PROJECT_ROLE_LABELS) as SmmProjectRole[]).map(r => <option key={r} value={r}>{SMM_PROJECT_ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <button type="button" onClick={handleAdd} disabled={saving || !userId} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <UserPlus className="w-4 h-4" />
          Добавить
        </button>
      </div>
      {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
        {active.map(m => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="text-zinc-100 text-sm">{m.userName}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{SMM_PROJECT_ROLE_LABELS[m.role]}</p>
            </div>
            <button type="button" onClick={() => handleRemove(m.id)} className="text-zinc-500 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        ))}
        {active.length === 0 && <p className="text-zinc-500 text-sm px-5 py-6">Команда ещё не назначена</p>}
      </div>
    </div>
  )
}
