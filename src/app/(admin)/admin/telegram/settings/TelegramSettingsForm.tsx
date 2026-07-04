'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { updateTelegramSettings, type TelegramSettingsDTO, type TelegramWebhookStatusDTO } from '@/lib/actions/telegram'

interface Props {
  initialSettings: TelegramSettingsDTO
  webhookStatus: TelegramWebhookStatusDTO
  archiveWarning: string | null
  isOwner: boolean
}

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors disabled:opacity-60'
const TEXTAREA = `${INPUT} resize-none`
const LABEL = 'block text-zinc-400 text-xs mb-1.5'

export default function TelegramSettingsForm({ initialSettings, webhookStatus, archiveWarning, isOwner }: Props) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    const result = await updateTelegramSettings(settings)
    setSaving(false)
    if (result.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000) }
    else setError(result.error)
  }

  return (
    <div className="space-y-6">
      {archiveWarning && (
        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3.5 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-300 text-sm">{archiveWarning}</p>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Статус бота и вебхука</p>
        <StatusRow ok={webhookStatus.botTokenConfigured} label="Токен бота" value={webhookStatus.botTokenConfigured ? 'Настроен' : 'Не настроен'} />
        {webhookStatus.botUsername && <StatusRow ok label="Бот" value={`@${webhookStatus.botUsername}`} />}
        {webhookStatus.webhookUrl && <StatusRow ok label="Вебхук" value={webhookStatus.webhookUrl} />}
        {webhookStatus.pendingUpdateCount !== null && (
          <StatusRow ok={webhookStatus.pendingUpdateCount === 0} label="Необработанные обновления" value={String(webhookStatus.pendingUpdateCount)} />
        )}
        {webhookStatus.lastErrorMessage && <StatusRow ok={false} label="Последняя ошибка" value={webhookStatus.lastErrorMessage} />}
        <p className="text-zinc-600 text-[11px] pt-1">Сам токен нигде не отображается — только в переменных окружения сервера.</p>
      </div>

      <fieldset disabled={!isOwner} className="space-y-5">
        <div>
          <label className={LABEL}>Ссылка на политику обработки персональных данных</label>
          <input className={INPUT} value={settings.privacyPolicyUrl ?? ''} placeholder="https://2470.ru/privacy"
            onChange={e => setSettings(s => ({ ...s, privacyPolicyUrl: e.target.value }))} />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="consentRequired" checked={settings.consentRequired}
            onChange={e => setSettings(s => ({ ...s, consentRequired: e.target.checked }))}
            className="w-4 h-4 accent-[#00c26b]" />
          <label htmlFor="consentRequired" className="text-zinc-300 text-sm">Требовать согласие перед подключением менеджера</label>
        </div>

        <div>
          <label className={LABEL}>Текст запроса согласия (версия: {settings.consentVersion})</label>
          <textarea className={TEXTAREA} rows={6} value={settings.consentText}
            onChange={e => setSettings(s => ({ ...s, consentText: e.target.value }))} />
          <p className="text-zinc-600 text-[11px] mt-1">Плейсхолдер {'{{privacy_policy_url}}'} подставляется автоматически.</p>
        </div>

        <div>
          <label className={LABEL}>Версия текста согласия</label>
          <input className={INPUT} value={settings.consentVersion}
            onChange={e => setSettings(s => ({ ...s, consentVersion: e.target.value }))} />
          <p className="text-zinc-600 text-[11px] mt-1">Смена версии заставит бота один раз заново запросить согласие у клиентов, писавших ранее.</p>
        </div>

        <div>
          <label className={LABEL}>Сообщение после согласия (передача менеджеру)</label>
          <textarea className={TEXTAREA} rows={2} value={settings.managerHandoffMessage}
            onChange={e => setSettings(s => ({ ...s, managerHandoffMessage: e.target.value }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Порог предупреждения (кол-во сообщений)</label>
            <input type="number" min="0" className={INPUT} value={settings.archiveWarningThresholdMessages}
              onChange={e => setSettings(s => ({ ...s, archiveWarningThresholdMessages: Number(e.target.value) }))} />
          </div>
          <div>
            <label className={LABEL}>Порог предупреждения (МБ)</label>
            <input type="number" min="0" className={INPUT} value={settings.archiveWarningThresholdStorageMb}
              onChange={e => setSettings(s => ({ ...s, archiveWarningThresholdStorageMb: Number(e.target.value) }))} />
          </div>
        </div>

        {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

        <button type="button" onClick={handleSave} disabled={saving}
          className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors">
          {saving ? 'Сохранение...' : saved ? 'Сохранено ✓' : 'Сохранить'}
        </button>
      </fieldset>
      {!isOwner && <p className="text-zinc-500 text-xs">Изменять настройки может только владелец.</p>}
    </div>
  )
}

function StatusRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-[#00c26b] flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
      <span className="text-zinc-500">{label}:</span>
      <span className="text-zinc-300 truncate">{value}</span>
    </div>
  )
}
