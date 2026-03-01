/**
 * Server functions for OIDC provider management.
 * Admin-only operations for configuring custom OIDC identity providers.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'

// ============================================
// Input Schemas
// ============================================

const createSchema = z.object({
  providerId: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
  displayName: z.string().min(1).max(100),
  discoveryUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  issuer: z.string().optional(),
  scopes: z.string().default('openid profile email'),
  authorizationUrl: z.string().url().optional().or(z.literal('')),
  tokenUrl: z.string().url().optional().or(z.literal('')),
  userInfoUrl: z.string().url().optional().or(z.literal('')),
  iconBg: z.string().default('bg-blue-600'),
  pkceEnabled: z.boolean().default(true),
  requireIssuerValidation: z.boolean().default(true),
})

const updateSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(100).optional(),
  discoveryUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  issuer: z.string().nullable().optional(),
  scopes: z.string().optional(),
  authorizationUrl: z.string().url().nullable().optional(),
  tokenUrl: z.string().url().nullable().optional(),
  userInfoUrl: z.string().url().nullable().optional(),
  iconBg: z.string().optional(),
  pkceEnabled: z.boolean().optional(),
  requireIssuerValidation: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

const deleteSchema = z.object({
  id: z.string().min(1),
})

const validateSchema = z.object({
  discoveryUrl: z.string().url(),
})

// ============================================
// Server Functions
// ============================================

/** List all OIDC providers (admin only) */
export const listOidcProvidersFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })

  const { listOidcProviders } =
    await import('@/lib/server/domains/oidc-providers/oidc-provider.service')
  const { getPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')

  const providers = await listOidcProviders()

  // Check which providers have credentials configured
  const result = await Promise.all(
    providers.map(async (p) => {
      const creds = await getPlatformCredentials(`auth_oidc_${p.providerId}`)
      return {
        ...p,
        hasCredentials: !!(creds?.clientId && creds?.clientSecret),
      }
    })
  )

  return result
})

/** Create a new OIDC provider (admin only) */
export const createOidcProviderFn = createServerFn({ method: 'POST' })
  .inputValidator(createSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    // Ensure scopes include 'openid'
    let scopes = data.scopes
    if (!scopes.split(' ').includes('openid')) {
      scopes = `openid ${scopes}`
    }

    const { createOidcProvider } =
      await import('@/lib/server/domains/oidc-providers/oidc-provider.service')
    const { savePlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')

    // Create provider record
    const provider = await createOidcProvider({
      providerId: data.providerId,
      displayName: data.displayName,
      discoveryUrl: data.discoveryUrl,
      issuer: data.issuer,
      scopes,
      authorizationUrl: data.authorizationUrl || undefined,
      tokenUrl: data.tokenUrl || undefined,
      userInfoUrl: data.userInfoUrl || undefined,
      iconBg: data.iconBg,
      pkceEnabled: data.pkceEnabled,
      requireIssuerValidation: data.requireIssuerValidation,
      configuredByPrincipalId: auth.principal.id,
    })

    // Save credentials encrypted
    await savePlatformCredentials({
      integrationType: `auth_oidc_${data.providerId}`,
      credentials: {
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      },
      principalId: auth.principal.id,
    })

    // Reset auth instance to pick up new provider
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()

    return provider
  })

/** Update an existing OIDC provider (admin only) */
export const updateOidcProviderFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    const { updateOidcProvider, getOidcProvider } =
      await import('@/lib/server/domains/oidc-providers/oidc-provider.service')
    const { savePlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')

    const existing = await getOidcProvider(data.id as never)
    if (!existing) {
      throw new Error(`OIDC provider not found: ${data.id}`)
    }

    // Update provider metadata
    const { id: _, clientId, clientSecret, ...providerData } = data
    const updated = await updateOidcProvider(data.id as never, providerData)

    // Update credentials if provided
    if (clientId || clientSecret) {
      const { getPlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')
      const existingCreds = await getPlatformCredentials(`auth_oidc_${existing.providerId}`)
      await savePlatformCredentials({
        integrationType: `auth_oidc_${existing.providerId}`,
        credentials: {
          clientId: clientId ?? existingCreds?.clientId ?? '',
          clientSecret: clientSecret ?? existingCreds?.clientSecret ?? '',
        },
        principalId: auth.principal.id,
      })
    }

    // Reset auth instance
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()

    return updated
  })

/** Delete an OIDC provider (admin only) */
export const deleteOidcProviderFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { deleteOidcProvider } =
      await import('@/lib/server/domains/oidc-providers/oidc-provider.service')

    await deleteOidcProvider(data.id as never)

    // Reset auth instance
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()

    return { success: true }
  })

/** Validate an OIDC Discovery URL (admin only) */
export const validateDiscoveryFn = createServerFn({ method: 'POST' })
  .inputValidator(validateSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { validateDiscoveryUrl } =
      await import('@/lib/server/domains/oidc-providers/oidc-provider.service')

    return validateDiscoveryUrl(data.discoveryUrl)
  })
