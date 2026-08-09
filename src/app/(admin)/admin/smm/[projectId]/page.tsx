import { notFound } from 'next/navigation'
import {
  getSmmProjectById, getSmmPackageItems, getSmmContentItems, getSmmProjectContentRows, getSmmMaterialLinks,
  getSmmProjectMembers, getSmmScheduleLinks, getSmmClientPayments, getUnlinkedScheduleEventsForClient,
  getSmmWorkItems,
} from '@/lib/actions/smm'
import { getAllEditorProfiles } from '@/lib/actions/editors'
import { getStaffUsers } from '@/lib/actions/users'
import SmmProjectView from './SmmProjectView'

export default async function SmmProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const projectResult = await getSmmProjectById(projectId)
  if (!projectResult.ok) notFound()
  const project = projectResult.data

  const [
    packageResult, contentResult, contentRowsResult, materialsResult, membersResult, scheduleLinksResult,
    paymentsResult, unlinkedEventsResult, editorsResult, staffResult, workItemsResult,
  ] = await Promise.all([
    getSmmPackageItems(projectId),
    getSmmContentItems(projectId),
    getSmmProjectContentRows(projectId),
    getSmmMaterialLinks(projectId),
    getSmmProjectMembers(projectId),
    getSmmScheduleLinks(projectId),
    getSmmClientPayments(projectId),
    getUnlinkedScheduleEventsForClient(project.clientId),
    getAllEditorProfiles(),
    getStaffUsers(),
    getSmmWorkItems(projectId),
  ])

  return (
    <div className="p-8 space-y-6">
      <SmmProjectView
        initialProject={project}
        initialPackageItems={packageResult.data}
        initialContentItems={contentResult.data}
        initialContentRows={contentRowsResult.data}
        initialMaterialLinks={materialsResult.data}
        initialMembers={membersResult.data}
        initialScheduleLinks={scheduleLinksResult.data}
        initialClientPayments={paymentsResult.data}
        unlinkedScheduleEvents={unlinkedEventsResult.data}
        editors={editorsResult.data}
        staff={staffResult.data}
        initialWorkItems={workItemsResult.data}
      />
    </div>
  )
}
