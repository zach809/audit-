import { redirect } from 'next/navigation'

export default function DashboardPage() {
  // Redirect to Clio audit page - this is now the main dashboard
  redirect('/dashboard/clio-audit')
}
