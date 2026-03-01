import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/empty-state'
import {
  ShieldCheckIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/solid'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { updateOidcProviderFn } from '@/lib/server/functions/oidc-providers'
import { OidcProviderDialog } from './oidc-provider-dialog'
import { DeleteOidcProviderDialog } from './delete-oidc-provider-dialog'

interface OidcProvider {
  id: string
  providerId: string
  displayName: string
  discoveryUrl: string
  iconBg: string | null
  enabled: boolean
  hasCredentials: boolean
  createdAt: Date
  updatedAt: Date
}

interface OidcProvidersSettingsProps {
  providers: OidcProvider[]
}

export function OidcProvidersSettings({ providers }: OidcProvidersSettingsProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()
  const [createOpen, setCreateOpen] = useState(false)
  const [editProvider, setEditProvider] = useState<OidcProvider | null>(null)
  const [deleteProvider, setDeleteProvider] = useState<OidcProvider | null>(null)

  const invalidateAndRefresh = () => {
    startTransition(() => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'oidcProviders'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      router.invalidate()
    })
  }

  const handleToggle = async (provider: OidcProvider, enabled: boolean) => {
    try {
      await updateOidcProviderFn({ data: { id: provider.id, enabled } })
      invalidateAndRefresh()
    } catch (err) {
      console.error('Failed to toggle OIDC provider:', err)
    }
  }

  if (providers.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={ShieldCheckIcon}
            title="No OIDC providers configured"
            description="Add a custom identity provider to enable single sign-on with Keycloak, Okta, Authentik, Azure AD, or any OIDC-compliant provider."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <PlusIcon className="h-4 w-4 mr-1.5" />
                Add OIDC Provider
              </Button>
            }
          />
        </div>

        <OidcProviderDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={invalidateAndRefresh}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {providers.length} {providers.length === 1 ? 'provider' : 'providers'} configured
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="h-4 w-4 mr-1.5" />
          Add Provider
        </Button>
      </div>

      <div className="space-y-3">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${provider.iconBg ?? 'bg-blue-600'}`}
              >
                <ShieldCheckIcon className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{provider.displayName}</p>
                  {!provider.hasCredentials && (
                    <Badge
                      variant="outline"
                      className="text-amber-600 border-amber-300 text-[10px]"
                    >
                      No credentials
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{provider.providerId}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={provider.enabled}
                onCheckedChange={(checked) => handleToggle(provider, checked)}
              />

              {/* Desktop actions */}
              <div className="hidden sm:flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditProvider(provider)}>
                  <PencilIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteProvider(provider)}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>

              {/* Mobile dropdown */}
              <div className="sm:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <EllipsisVerticalIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditProvider(provider)}>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setDeleteProvider(provider)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        ))}
      </div>

      <OidcProviderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={invalidateAndRefresh}
      />

      <OidcProviderDialog
        open={!!editProvider}
        onOpenChange={(open) => !open && setEditProvider(null)}
        provider={editProvider ?? undefined}
        onSaved={invalidateAndRefresh}
      />

      <DeleteOidcProviderDialog
        open={!!deleteProvider}
        onOpenChange={(open) => !open && setDeleteProvider(null)}
        provider={deleteProvider}
        onDeleted={invalidateAndRefresh}
      />
    </div>
  )
}
