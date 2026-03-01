import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { OidcProvidersSettings } from '@/components/admin/settings/oidc-providers/oidc-providers-settings'
import { SettingsCard } from '@/components/admin/settings/settings-card'

export const Route = createFileRoute('/admin/settings/oidc-providers')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.oidcProviders())

    return {}
  },
  component: OidcProvidersPage,
})

function OidcProvidersPage() {
  const oidcQuery = useSuspenseQuery(adminQueries.oidcProviders())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ShieldCheckIcon}
        title="OIDC Providers"
        description="Connect custom identity providers (Keycloak, Okta, Authentik, Azure AD, etc.) for single sign-on"
      />

      <SettingsCard
        title="Identity Providers"
        description="OIDC providers are available as sign-in options on both the portal and team login pages."
      >
        <OidcProvidersSettings providers={oidcQuery.data} />
      </SettingsCard>
    </div>
  )
}
