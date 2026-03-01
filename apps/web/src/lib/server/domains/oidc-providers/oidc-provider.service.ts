/**
 * OIDC Provider Service
 *
 * CRUD operations and discovery validation for custom OIDC providers.
 * Provider metadata is stored in the oidc_providers table; credentials
 * (clientId/clientSecret) are stored encrypted in integrationPlatformCredentials.
 */

import type { OidcProvId, PrincipalId } from '@quackback/ids'
import type { OidcProfileMapping } from '@/lib/server/db'

// ============================================
// Types
// ============================================

export interface OidcProviderRecord {
  id: OidcProvId
  providerId: string
  displayName: string
  discoveryUrl: string
  issuer: string | null
  scopes: string
  authorizationUrl: string | null
  tokenUrl: string | null
  userInfoUrl: string | null
  iconBg: string | null
  pkceEnabled: boolean
  requireIssuerValidation: boolean
  profileMapping: OidcProfileMapping | null
  enabled: boolean
  configuredByPrincipalId: PrincipalId | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateOidcProviderInput {
  providerId: string
  displayName: string
  discoveryUrl: string
  issuer?: string
  scopes?: string
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  iconBg?: string
  pkceEnabled?: boolean
  requireIssuerValidation?: boolean
  profileMapping?: OidcProfileMapping | null
  configuredByPrincipalId?: PrincipalId
}

export interface UpdateOidcProviderInput {
  displayName?: string
  discoveryUrl?: string
  issuer?: string | null
  scopes?: string
  authorizationUrl?: string | null
  tokenUrl?: string | null
  userInfoUrl?: string | null
  iconBg?: string
  pkceEnabled?: boolean
  requireIssuerValidation?: boolean
  profileMapping?: OidcProfileMapping | null
  enabled?: boolean
}

export interface OidcDiscoveryResult {
  valid: boolean
  issuer?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userinfoEndpoint?: string
  jwksUri?: string
  error?: string
}

// ============================================
// CRUD Operations
// ============================================

export async function createOidcProvider(
  data: CreateOidcProviderInput
): Promise<OidcProviderRecord> {
  const { db, oidcProvider, eq } = await import('@/lib/server/db')
  const { generateId } = await import('@quackback/ids')
  const { getAllAuthProviders } = await import('@/lib/server/auth/auth-providers')

  // Check for collision with static providers
  const staticProviders = getAllAuthProviders()
  if (staticProviders.some((p) => p.id === data.providerId)) {
    throw new Error(`Provider ID "${data.providerId}" conflicts with a built-in provider`)
  }

  // Check for duplicate providerId
  const existing = await db.query.oidcProvider.findFirst({
    where: eq(oidcProvider.providerId, data.providerId),
  })
  if (existing) {
    throw new Error(`OIDC provider with ID "${data.providerId}" already exists`)
  }

  const [created] = await db
    .insert(oidcProvider)
    .values({
      id: generateId('oidc_prov'),
      providerId: data.providerId,
      displayName: data.displayName,
      discoveryUrl: data.discoveryUrl,
      issuer: data.issuer ?? null,
      scopes: data.scopes ?? 'openid profile email',
      authorizationUrl: data.authorizationUrl ?? null,
      tokenUrl: data.tokenUrl ?? null,
      userInfoUrl: data.userInfoUrl ?? null,
      iconBg: data.iconBg ?? 'bg-blue-600',
      pkceEnabled: data.pkceEnabled ?? true,
      requireIssuerValidation: data.requireIssuerValidation ?? true,
      profileMapping: data.profileMapping ?? null,
      configuredByPrincipalId: data.configuredByPrincipalId ?? null,
    })
    .returning()

  return created as OidcProviderRecord
}

export async function updateOidcProvider(
  id: OidcProvId,
  data: UpdateOidcProviderInput
): Promise<OidcProviderRecord> {
  const { db, oidcProvider, eq } = await import('@/lib/server/db')

  const [updated] = await db
    .update(oidcProvider)
    .set(data)
    .where(eq(oidcProvider.id, id))
    .returning()

  if (!updated) {
    throw new Error(`OIDC provider not found: ${id}`)
  }

  return updated as OidcProviderRecord
}

export async function deleteOidcProvider(id: OidcProvId): Promise<void> {
  const { db, oidcProvider, eq } = await import('@/lib/server/db')

  // Get the providerId before deleting so we can clean up credentials
  const provider = await db.query.oidcProvider.findFirst({
    where: eq(oidcProvider.id, id),
  })
  if (!provider) {
    throw new Error(`OIDC provider not found: ${id}`)
  }

  // Delete credentials
  const { deletePlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  await deletePlatformCredentials(`auth_oidc_${provider.providerId}`)

  // Delete provider record
  await db.delete(oidcProvider).where(eq(oidcProvider.id, id))
}

export async function getOidcProvider(id: OidcProvId): Promise<OidcProviderRecord | null> {
  const { db, oidcProvider, eq } = await import('@/lib/server/db')
  const result = await db.query.oidcProvider.findFirst({
    where: eq(oidcProvider.id, id),
  })
  return (result as OidcProviderRecord) ?? null
}

export async function listOidcProviders(): Promise<OidcProviderRecord[]> {
  const { db, oidcProvider } = await import('@/lib/server/db')
  const { asc } = await import('drizzle-orm')
  const results = await db.select().from(oidcProvider).orderBy(asc(oidcProvider.displayName))
  return results as OidcProviderRecord[]
}

export async function listEnabledOidcProviders(): Promise<OidcProviderRecord[]> {
  const { db, oidcProvider, eq } = await import('@/lib/server/db')
  const { asc } = await import('drizzle-orm')
  const results = await db
    .select()
    .from(oidcProvider)
    .where(eq(oidcProvider.enabled, true))
    .orderBy(asc(oidcProvider.displayName))
  return results as OidcProviderRecord[]
}

// ============================================
// Discovery Validation
// ============================================

/**
 * Fetch and validate an OIDC Discovery document.
 * Returns extracted endpoints for admin preview.
 */
export async function validateDiscoveryUrl(url: string): Promise<OidcDiscoveryResult> {
  // Enforce HTTPS (except localhost for dev)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    return { valid: false, error: 'Discovery URL must use HTTPS' }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }

    const doc = (await response.json()) as Record<string, unknown>

    // Validate required fields
    if (!doc.issuer || typeof doc.issuer !== 'string') {
      return { valid: false, error: 'Discovery document missing "issuer" field' }
    }
    if (!doc.authorization_endpoint || typeof doc.authorization_endpoint !== 'string') {
      return { valid: false, error: 'Discovery document missing "authorization_endpoint"' }
    }
    if (!doc.token_endpoint || typeof doc.token_endpoint !== 'string') {
      return { valid: false, error: 'Discovery document missing "token_endpoint"' }
    }

    return {
      valid: true,
      issuer: doc.issuer as string,
      authorizationEndpoint: doc.authorization_endpoint as string,
      tokenEndpoint: doc.token_endpoint as string,
      userinfoEndpoint: (doc.userinfo_endpoint as string) ?? undefined,
      jwksUri: (doc.jwks_uri as string) ?? undefined,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { valid: false, error: 'Connection timed out (5s)' }
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to fetch discovery document',
    }
  }
}
