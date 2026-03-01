import { createFileRoute, redirect, Link, useSearch } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PortalAuthForm } from '@/components/auth/portal-auth-form'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings'
import { getEnabledOAuthProviders } from '@/components/auth/oauth-buttons'
import { useEffect, useRef } from 'react'
import { authClient } from '@/lib/server/auth/client'

const searchSchema = z.object({
  returnTo: z.string().optional(),
})

/**
 * Portal Login Page
 *
 * For portal users (visitors) to sign in using email OTP or OAuth.
 * Supports returnTo for redirect after authentication (used by requireAuth).
 */
export const Route = createFileRoute('/auth/login')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    // Settings already available from root context
    const { settings, queryClient } = context
    if (!settings) {
      throw redirect({ to: '/onboarding' })
    }

    // Pre-fetch portal config using React Query
    await queryClient.ensureQueryData(settingsQueries.publicPortalConfig())

    return {}
  },
  component: LoginPage,
})

function LoginPage() {
  Route.useLoaderData()
  const { returnTo } = useSearch({ from: '/auth/login' })
  const autoRedirectAttempted = useRef(false)

  // Validate returnTo is a safe relative path
  const safeReturnTo =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'

  // Read pre-fetched data from React Query cache
  const portalConfigQuery = useSuspenseQuery(settingsQueries.publicPortalConfig())
  const authConfig = portalConfigQuery.data.oauth ?? DEFAULT_PORTAL_CONFIG.oauth
  const oidcProviders = portalConfigQuery.data.oidcProviders
  const features = portalConfigQuery.data.features

  // Auto-redirect when enabled and only one OAuth/OIDC provider is active
  const enabledProviders = getEnabledOAuthProviders(authConfig, oidcProviders)
  const passwordEnabled = authConfig.password ?? true
  const emailEnabled = authConfig.email ?? false

  // Count non-password, non-email methods
  const oauthOnlyProviders = enabledProviders.filter((p) => p.id !== 'password' && p.id !== 'email')
  const hasOtherMethods = passwordEnabled || emailEnabled
  const singleOAuthProvider = oauthOnlyProviders.length === 1 && !hasOtherMethods

  useEffect(() => {
    if (features?.autoRedirect && singleOAuthProvider && !autoRedirectAttempted.current) {
      autoRedirectAttempted.current = true
      const provider = oauthOnlyProviders[0]
      const isOidc = provider.id.startsWith('oidc-')

      if (isOidc) {
        authClient.signIn.oauth2({
          providerId: provider.id,
          callbackURL: safeReturnTo,
        })
      } else {
        authClient.signIn.social({
          provider: provider.id,
          callbackURL: safeReturnTo,
        })
      }
    }
  }, [features?.autoRedirect, singleOAuthProvider, oauthOnlyProviders, safeReturnTo])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to your account</p>
        </div>
        <PortalAuthForm
          mode="login"
          callbackUrl={safeReturnTo}
          authConfig={authConfig}
          oidcProviders={oidcProviders}
        />
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link to="/auth/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
