'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-3xl tracking-tight text-gray-900" style={{ fontWeight: 800 }}>2470</p>
          <p className="text-sm text-gray-400 mt-1">Панель управления студией</p>
        </div>

        <div className="card-base p-7">
          <h2 className="text-lg font-bold text-gray-900 mb-5">Вход для команды</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Email</label>
              <input
                type="email"
                placeholder="staff@2470.ru"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="input-base"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Пароль</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="input-base"
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-400 text-xs mt-5">
          Клиент студии? →{' '}
          <a href="/login" className="text-gray-600 font-semibold hover:underline">
            Личный кабинет
          </a>
        </p>
      </div>
    </div>
  )
}
