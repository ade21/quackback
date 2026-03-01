import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AUTH_PROVIDER_ICON_MAP } from '@/components/icons/social-provider-icons'
import { AUTH_PROVIDERS } from '@/lib/server/auth/auth-providers'
import {
  openAuthPopup,
  useAuthBroadcast,
  usePopupTracker,
} from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/server/auth/client'
import type { PublicOidcProvider } from '@/lib/server/domains/settings/settings.types'

interface OAuthProvider {
  id: string
  name: string
  /** Tailwind bg class for OIDC providers without a built-in icon */
  iconBg?: string
}

interface OAuthButtonsProps {
  callbackUrl?: string
  /** Dynamic list of enabled providers keyed by provider ID */
  providers: OAuthProvider[]
  /** Callback when auth succeeds (for popup flow) */
  onSuccess?: () => void
}

/**
 * OAuth Buttons Component
 *
 * Renders sign-in buttons for any configured OAuth provider.
 * All providers use popup windows for authentication.
 */
export function OAuthButtons({ callbackUrl = '/', providers, onSuccess }: OAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const { trackPopup, hasPopup, focusPopup, clearPopup } = usePopupTracker({
    onPopupClosed: () => {
      setLoadingProvider(null)
    },
  })

  useAuthBroadcast({
    onSuccess: () => {
      clearPopup()
      setLoadingProvider(null)
      if (onSuccess) {
        onSuccess()
      } else {
        window.location.href = callbackUrl
      }
    },
  })

  async function handleOAuthLogin(providerId: string): Promise<void> {
    if (hasPopup()) {
      focusPopup()
      return
    }

    setLoadingProvider(providerId)
    setPopupBlocked(false)

    // Open popup synchronously (must be in direct response to user click)
    const popup = openAuthPopup('about:blank')
    if (!popup) {
      setPopupBlocked(true)
      setLoadingProvider(null)
      return
    }
    trackPopup(popup)

    try {
      // OIDC providers (oidc-*) use genericOAuth signIn; built-in providers use social signIn
      const isOidc = providerId.startsWith('oidc-')
      const result = isOidc
        ? await authClient.signIn.oauth2({
            providerId,
            callbackURL: callbackUrl,
            disableRedirect: true,
          })
        : await authClient.signIn.social({
            provider: providerId,
            callbackURL: callbackUrl,
            disableRedirect: true,
          })

      if (result.data?.url) {
        popup.location.href = result.data.url
      } else {
        popup.close()
        setLoadingProvider(null)
      }
    } catch {
      popup.close()
      setLoadingProvider(null)
    }
  }

  // Don't render anything if no providers
  if (providers.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {popupBlocked && (
        <p className="text-sm text-destructive text-center">
          Popup blocked. Please allow popups for this site.
        </p>
      )}
      {providers.map((provider) => {
        const IconComponent = AUTH_PROVIDER_ICON_MAP[provider.id]
        return (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => handleOAuthLogin(provider.id)}
            disabled={loadingProvider !== null}
          >
            {IconComponent ? (
              <IconComponent className="mr-2 h-4 w-4" />
            ) : provider.iconBg ? (
              <span className={`mr-2 h-4 w-4 rounded-sm ${provider.iconBg}`} />
            ) : null}
            {loadingProvider === provider.id ? 'Signing in...' : `Continue with ${provider.name}`}
          </Button>
        )
      })}
    </div>
  )
}

/**
 * Build provider list from PortalAuthMethods config + OIDC providers.
 * Filters to only enabled OAuth providers (excludes 'email' and 'password').
 * OIDC providers are appended after built-in social providers.
 */
export function getEnabledOAuthProviders(
  authConfig: Record<string, boolean | undefined>,
  oidcProviders?: PublicOidcProvider[]
): OAuthProvider[] {
  const providerMap = new Map(AUTH_PROVIDERS.map((p) => [p.id, p]))
  const result: OAuthProvider[] = []

  for (const [key, enabled] of Object.entries(authConfig)) {
    if (key === 'email' || key === 'password' || !enabled) continue
    const provider = providerMap.get(key)
    if (provider) {
      result.push({ id: provider.id, name: provider.name })
    }
  }

  if (oidcProviders) {
    for (const p of oidcProviders) {
      result.push({ id: p.id, name: p.name, iconBg: p.iconBg })
    }
  }

  return result
}
