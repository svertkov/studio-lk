import { AlertTriangle, Link2, Archive, Clock, CheckCircle2 } from 'lucide-react'
import type { MaterialsStatus, MaterialsSeverity } from '@/lib/schedule-model'
import { getMaterialsDisplay, MATERIALS_SEVERITY_TEXT_COLOR } from '@/lib/schedule-model'

const ICONS: Record<MaterialsSeverity, typeof AlertTriangle> = {
  danger:  AlertTriangle,
  warning: Clock,
  info:    Link2,
  success: CheckCircle2,
  neutral: Archive,
}

interface Props {
  status: MaterialsStatus
  nasBackupUrl?: string | null
  size?: 'sm' | 'md'
  showLabel?: boolean
}

export default function MaterialsStatusBadge({ status, nasBackupUrl, size = 'sm', showLabel = false }: Props) {
  const { label, severity } = getMaterialsDisplay({ materialsStatus: status, nasBackupUrl })
  const Icon = ICONS[severity]
  const color = MATERIALS_SEVERITY_TEXT_COLOR[severity]
  const px = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'

  if (!showLabel) {
    return (
      <span title={label} className="inline-flex">
        <Icon className={`${px} ${color} flex-shrink-0`} />
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <Icon className={px} />
      {label}
    </span>
  )
}
