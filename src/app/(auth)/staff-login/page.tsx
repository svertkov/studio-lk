'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Settings2 } from 'lucide-react'

export default function StaffLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      setError('Неверный email или пароль')
      setLoading(false)
      return
    }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
    if (profile?.role === 'CLIENT') {
      await supabase.auth.signOut()
      setError('Этот вход только для сотрудников студии')
      setLoading(false)
      return
    }
    router.push('/admin/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 right-1/3 w-96 h-96 rounded-full bg-white/[0.015] blur-3xl" />
        <div className="absolute bottom-1/3 left-1/3 w-72 h-72 rounded-full bg-white/[0.01] blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl glass mb-4">
            <Settings2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">2470</h1>
          <p className="text-white/30 text-sm mt-1 tracking-wider uppercase">Панель управления</p>
        </div>

        <div className="glass-login rounded-2xl p-8">
          <h2 className="text-white font-semibold text-lg mb-1">Вход для команды</h2>
          <p className="text-white/40 text-sm mb-6">Менеджеры, сотрудники, владелец</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-white/50 text-xs uppercase tracking-wider">Email</label>
              <input
                type="email"
                placeholder="staff@2470.ru"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="glass-input w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-white/50 text-xs uppercase tracking-wider">Пароль</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="glass-input w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-white text-black font-semibold rounded-xl py-3 text-sm transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </form>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          Клиент студии? →{' '}
          <a href="/login" className="text-white/40 hover:text-white/70 underline transition-colors">
            Личный кабинет
          </a>
        </p>
      </div>
    </div>
  )
}
