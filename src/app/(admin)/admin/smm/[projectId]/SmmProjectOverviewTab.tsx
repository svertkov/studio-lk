'use client'

import { useState } from 'react'
import type {
  SmmProjectDTO, SmmPackageItemDTO, SmmContentItemDTO, SmmClientPaymentDTO, SmmProjectMemberDTO,
} from '@/lib/actions/smm'
import { updateSmmProject } from '@/lib/actions/smm'
import {
  SMM_PROJECT_STATUS_LABELS, SMM_SERVICE_TYPE_LABELS, SMM_PACKAGE_UNIT_LABELS, SMM_PACKAGE_PERIOD_LABELS,
  formatSmmMoney, computeSmmBillingPeriod, computePackageProgress, getPrimaryResponsibleMember,
} from '@/lib/smm-model'
import type { SmmProjectStatus } from '@prisma/client'

const SELECT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const INPUT = 'h-9 bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors'

function formatDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

interface Props {
  project: SmmProjectDTO
  setProject: (updater: (prev: SmmProjectDTO) => SmmProjectDTO) => void
  packageItems: SmmPackageItemDTO[]
  contentItems: SmmContentItemDTO[]
  clientPayments: SmmClientPaymentDTO[]
  members: SmmProjectMemberDTO[]
}

export default function SmmProjectOverviewTab({ project, setProject, packageItems, contentItems, clientPayments, members }: Props) {
  const [savingFee, setSavingFee] = useState(false)
  const [feeInput, setFeeInput] = useState(project.monthlyFee != null ? String(project.monthlyFee) : '')

  const period = computeSmmBillingPeriod(project.startDate, project.billingPeriodType)
  const progress = computePackageProgress(packageItems, contentItems, period)
  const primary = getPrimaryResponsibleMember(members)
  const nextPayment = clientPayments.filter(p => p.status === 'PLANNED' || p.status === 'DUE').sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0]

  const periodContent = contentItems.filter(c => {
    const d = c.plannedPublishDate ?? c.createdAt
    return d >= period.start.toISOString() && d <= period.end.toISOString()
  })
  const kpi = {
    planned: periodContent.filter(c => c.status === 'PLANNED').length,
    ready: periodContent.filter(c => c.status === 'APPROVED' || c.status === 'SCHEDULED').length,
    published: periodContent.filter(c => c.status === 'PUBLISHED').length,
    inEdit: periodContent.filter(c => c.status === 'IN_EDIT').length,
    overdue: periodContent.filter(c => c.deadline && new Date(c.deadline) < new Date() && c.status !== 'PUBLISHED' && c.status !== 'CANCELLED').length,
  }

  async function handleStatusChange(status: SmmProjectStatus) {
    setProject(prev => ({ ...prev, status }))
    await updateSmmProject(project.id, { status })
  }

  async function handleFeeBlur() {
    const next = feeInput ? parseFloat(feeInput) : null
    if (next === project.monthlyFee) return
    setSavingFee(true)
    const result = await updateSmmProject(project.id, { monthlyFee: next })
    setSavingFee(false)
    if (result.ok) setProject(() => result.data)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3 lg:col-span-2">
          <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Условия сотрудничества</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-500 text-xs mb-1">Статус</label>
              <select className={SELECT} value={project.status} onChange={e => handleStatusChange(e.target.value as SmmProjectStatus)}>
                {(Object.keys(SMM_PROJECT_STATUS_LABELS) as SmmProjectStatus[]).map(s => (
                  <option key={s} value={s}>{SMM_PROJECT_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-zinc-500 text-xs mb-1">Стоимость ведения, ₽/мес</label>
              <input className={INPUT} type="number" value={feeInput} onChange={e => setFeeInput(e.target.value)} onBlur={handleFeeBlur} disabled={savingFee} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-zinc-500 text-xs">Начало сотрудничества</p>
              <p className="text-zinc-200 mt-0.5">{formatDate(project.startDate)}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Основной ответственный</p>
              <p className="text-zinc-200 mt-0.5">{primary?.userName ?? '—'}</p>
            </div>
          </div>
          {project.paymentTerms && (
            <div>
              <p className="text-zinc-500 text-xs">Условия оплаты</p>
              <p className="text-zinc-300 text-sm mt-0.5">{project.paymentTerms}</p>
            </div>
          )}
          {project.notes && (
            <div>
              <p className="text-zinc-500 text-xs">Комментарий</p>
              <p className="text-zinc-300 text-sm mt-0.5">{project.notes}</p>
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Ближайший платёж</p>
          {nextPayment ? (
            <>
              <p className="text-white text-xl font-semibold">{formatSmmMoney(nextPayment.plannedAmount)}</p>
              <p className="text-zinc-400 text-sm mt-1">{formatDate(nextPayment.plannedDate)}</p>
            </>
          ) : (
            <p className="text-zinc-500 text-sm">Платежи не запланированы</p>
          )}
        </div>
      </div>

      <div>
        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">
          Текущий расчётный период: {formatDate(period.start.toISOString())} – {formatDate(period.end.toISOString())}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Запланировано', value: kpi.planned },
            { label: 'Готово', value: kpi.ready },
            { label: 'В монтаже', value: kpi.inEdit },
            { label: 'Опубликовано', value: kpi.published },
            { label: 'Просрочено', value: kpi.overdue },
          ].map(k => (
            <div key={k.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 text-center">
              <p className="text-white text-xl font-semibold">{k.value}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-2">Выполнение пакета</p>
        {progress.length === 0 ? (
          <p className="text-zinc-500 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6">Пакет ещё не настроен — заполните вкладку «Пакет»</p>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
            {progress.map(({ packageItem, done, target }) => (
              <div key={packageItem.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-zinc-200 text-sm">
                    {packageItem.serviceType === 'OTHER' ? (packageItem.customName || 'Другое') : SMM_SERVICE_TYPE_LABELS[packageItem.serviceType]}
                  </p>
                  {packageItem.description && <p className="text-zinc-500 text-xs mt-0.5">{packageItem.description}</p>}
                </div>
                <p className="text-zinc-100 text-sm font-medium flex-shrink-0">
                  {target != null ? `${done} / ${target} ${SMM_PACKAGE_UNIT_LABELS[packageItem.unit]}` : `${SMM_PACKAGE_PERIOD_LABELS[packageItem.period]}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
