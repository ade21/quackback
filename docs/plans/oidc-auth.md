# Plan: Generisches OIDC Authentication + Erzwungene Anmeldung für Quackback

## Zusammenfassung

Quackback unterstützt bereits 33 fest eingebaute OAuth-Provider (GitHub, Google, etc.) über Better Auth's `socialProviders`. Dieses Feature erweitert die Plattform um:

1. **Generische OIDC-Authentifizierung** — Admins können beliebige OIDC-kompatible Identity Provider (Keycloak, Okta, Auth0, Authentik, Azure AD, etc.) ohne Code-Änderungen konfigurieren.
2. **Erzwungene Anmeldung für Portal-Besucher** — Anonymer Zugang zum Portal wird blockiert. Besucher müssen sich zuerst authentifizieren, bevor sie Inhalte sehen können. In Kombination mit OIDC ermöglicht das eine nahtlose SSO-Erfahrung: Besucher werden direkt zum IdP weitergeleitet.

## Technischer Ansatz

### Plugin-Wahl: Better Auth `genericOAuth`

Better Auth bietet drei relevante Plugins:

| Plugin | Zweck | Passt für Quackback? |
|--------|-------|---------------------|
| `genericOAuth` | Beliebige OAuth2/OIDC-Provider konsumieren | **Ja** |
| `sso` (`@better-auth/sso`) | Enterprise SSO mit Org-Scoping, SAML 2.0 | Nein (Multi-Tenant-Konzept, Quackback ist Single-Tenant) |
| `oauthProvider` | Selbst als OAuth-Server agieren | Bereits vorhanden (für MCP) |

**Entscheidung:** `genericOAuth` Plugin verwenden. Es unterstützt:
- OIDC Discovery (`/.well-known/openid-configuration`)
- PKCE (Proof Key for Code Exchange)
- Issuer-Validierung
- Dynamische User-Profile-Extraktion
- Mehrere Provider in einer Konfiguration

### Architektur-Überblick

```
Admin UI (OIDC-Provider verwalten)
       │
       ▼
┌─────────────────────────────────────────┐
│  oidc_providers Tabelle (DB)            │
│  - discoveryUrl, clientId, clientSecret │
│  - Scopes, Display-Name, Icon-Config    │
└────────────────┬────────────────────────┘
                 │
                 ▼  resetAuth() bei Änderung
┌─────────────────────────────────────────┐
│  createAuth() in auth/index.ts          │
│  - Lädt OIDC-Provider aus DB            │
│  - Konfiguriert genericOAuth Plugin     │
│  - Registriert als socialProviders      │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Login-UI (Portal + Admin)              │
│  - OAuthButtons zeigt OIDC-Provider     │
│  - Popup-Flow wie bei anderen Providern │
└─────────────────────────────────────────┘
```

---

## Implementierungsschritte

### Phase 1: Datenmodell

#### 1.1 Neue DB-Tabelle `oidc_providers`

**Datei:** `packages/db/src/schema/auth.ts`

```typescript
export const oidcProvider = pgTable('oidc_providers', {
  id: typeIdWithDefault('oidc_prov')('id').primaryKey(),

  // Identifikation
  providerId: varchar('provider_id', { length: 50 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }).notNull(),

  // OIDC-Konfiguration
  discoveryUrl: text('discovery_url').notNull(),
  issuer: text('issuer'),

  // Scopes (Standard: "openid profile email")
  scopes: text('scopes').notNull().default('openid profile email'),

  // Optionale manuelle Endpoint-Overrides
  // (falls Discovery nicht alle Endpoints liefert)
  authorizationUrl: text('authorization_url'),
  tokenUrl: text('token_url'),
  userInfoUrl: text('user_info_url'),

  // UI-Darstellung
  iconUrl: text('icon_url'),
  iconBg: varchar('icon_bg', { length: 30 }).default('bg-blue-600'),

  // Sicherheit
  pkceEnabled: boolean('pkce_enabled').notNull().default(true),
  requireIssuerValidation: boolean('require_issuer_validation').notNull().default(true),

  // User-Profile-Mapping (optional, JSON)
  // Erlaubt Custom-Mapping von OIDC-Claims zu Quackback-Feldern
  profileMapping: jsonb('profile_mapping').$type<OidcProfileMapping | null>(),

  // Status
  enabled: boolean('enabled').notNull().default(true),

  // Admin-Tracking
  configuredByPrincipalId: typeIdColumnNullable('principal')('configured_by_principal_id')
    .references(() => principal.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
```

**Warum eine eigene Tabelle statt `integrationPlatformCredentials`?**
- OIDC-Provider brauchen deutlich mehr Konfigurationsfelder als `clientId`/`clientSecret`
- Mehrere OIDC-Provider gleichzeitig möglich (nicht nur einer pro Typ)
- Discovery URL, Scopes, Profile-Mapping sind strukturierte Daten, kein encrypted Blob
- Eigene Tabelle erlaubt direkte Drizzle-Queries und Relations

**Credentials:** `clientId` und `clientSecret` werden weiterhin in `integrationPlatformCredentials` gespeichert (Typ: `auth_oidc_{providerId}`), da die Verschlüsselungsinfrastruktur dort bereits vorhanden ist.

#### 1.2 TypeID für OIDC-Provider

**Datei:** `packages/ids/src/index.ts`

Neuen Typ `oidc_prov` zum ID-Schema hinzufügen.

#### 1.3 Profile-Mapping-Typ

```typescript
interface OidcProfileMapping {
  // Pfade in den OIDC-Claims (Dot-Notation)
  name?: string       // Standard: "name" oder "preferred_username"
  email?: string      // Standard: "email"
  image?: string      // Standard: "picture"
  emailVerified?: string // Standard: "email_verified"
}
```

#### 1.4 Drizzle-Migration generieren

```bash
bun run db:generate
bun run db:migrate
```

---

### Phase 2: Backend-Services

#### 2.1 OIDC Provider Service

**Neue Datei:** `apps/web/src/lib/server/domains/oidc-providers/oidc-provider.service.ts`

```typescript
// CRUD-Operationen für OIDC-Provider
export async function createOidcProvider(data: CreateOidcProviderInput): Promise<OidcProvider>
export async function updateOidcProvider(id: OidcProviderId, data: UpdateOidcProviderInput): Promise<OidcProvider>
export async function deleteOidcProvider(id: OidcProviderId): Promise<void>
export async function getOidcProvider(id: OidcProviderId): Promise<OidcProvider | null>
export async function listOidcProviders(): Promise<OidcProvider[]>
export async function listEnabledOidcProviders(): Promise<OidcProvider[]>

// OIDC Discovery validieren (beim Anlegen/Bearbeiten)
export async function validateDiscoveryUrl(url: string): Promise<OidcDiscoveryResult>
```

**Validierung bei `validateDiscoveryUrl`:**
- Discovery-Dokument abrufen (`/.well-known/openid-configuration`)
- Prüfen ob `authorization_endpoint`, `token_endpoint`, `issuer` vorhanden
- Optional: `userinfo_endpoint`, `jwks_uri` prüfen
- Ergebnis mit den extrahierten Endpoints zurückgeben
- Admin kann so vor dem Speichern sehen, ob der IdP erreichbar ist

#### 2.2 Integration in `auth/index.ts`

Die `createAuth()`-Funktion erweitern:

```typescript
import { genericOAuth } from 'better-auth/plugins'
import { genericOAuthClient } from 'better-auth/client/plugins'

async function createAuth() {
  // ... bestehender Code ...
  const { listEnabledOidcProviders } = await import(
    '@/lib/server/domains/oidc-providers/oidc-provider.service'
  )

  // OIDC-Provider aus DB laden
  const oidcProviders = await listEnabledOidcProviders()
  const genericOAuthConfigs = []

  for (const provider of oidcProviders) {
    const creds = await getPlatformCredentials(`auth_oidc_${provider.providerId}`)
    if (!creds?.clientId || !creds?.clientSecret) continue

    genericOAuthConfigs.push({
      providerId: `oidc-${provider.providerId}`,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      discoveryUrl: provider.discoveryUrl,
      issuer: provider.issuer ?? undefined,
      scopes: provider.scopes.split(' ').filter(Boolean),
      authorizationUrl: provider.authorizationUrl ?? undefined,
      tokenUrl: provider.tokenUrl ?? undefined,
      userInfoUrl: provider.userInfoUrl ?? undefined,
      pkce: provider.pkceEnabled,
      requireIssuerValidation: provider.requireIssuerValidation,
      // User-Profile-Mapping
      getUserInfo: provider.profileMapping
        ? createProfileMapper(provider.profileMapping)
        : undefined,
    })

    // Zu trustedProviders hinzufügen
    trustedProviders.push(`oidc-${provider.providerId}`)
  }

  return betterAuth({
    // ... bestehende Config ...
    plugins: [
      // ... bestehende Plugins ...

      // Generic OAuth Plugin für OIDC-Provider (nur wenn welche konfiguriert)
      ...(genericOAuthConfigs.length > 0
        ? [genericOAuth({ config: genericOAuthConfigs })]
        : []),
    ],
  })
}
```

**Wichtig:** `resetAuth()` wird bereits aufgerufen, wenn Credentials geändert werden. Dieses Pattern bleibt bestehen — wenn ein OIDC-Provider angelegt/geändert/gelöscht wird, wird `resetAuth()` aufgerufen, sodass die Auth-Instanz mit der neuen Konfiguration neu erstellt wird.

#### 2.3 Auth-Provider-Registry erweitern

**Datei:** `apps/web/src/lib/server/auth/auth-providers.ts`

OIDC-Provider sind **nicht** Teil des statischen `AUTH_PROVIDERS`-Arrays. Stattdessen:

```typescript
// Neue Funktion: Gibt alle Auth-Provider zurück (statische + dynamische OIDC)
export async function getAllAuthProvidersWithOidc(): Promise<AuthProviderDefinition[]> {
  const { listEnabledOidcProviders } = await import(
    '@/lib/server/domains/oidc-providers/oidc-provider.service'
  )
  const oidcProviders = await listEnabledOidcProviders()

  const oidcDefs: AuthProviderDefinition[] = oidcProviders.map((p) => ({
    id: `oidc-${p.providerId}`,
    name: p.displayName,
    credentialType: `auth_oidc_${p.providerId}`,
    iconBg: p.iconBg ?? 'bg-blue-600',
    platformCredentials: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Enter Client ID', sensitive: false },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Enter Client Secret', sensitive: true },
    ],
    isOidc: true, // Neues Flag zur Unterscheidung
  }))

  return [...AUTH_PROVIDERS, ...oidcDefs]
}
```

#### 2.4 Auth-Restrictions aktualisieren

**Datei:** `apps/web/src/lib/server/auth/auth-restrictions.ts`

`getAllowedAuthMethods()` und `isAuthMethodAllowed()` müssen OIDC-Provider berücksichtigen:

```typescript
// In getAllowedAuthMethods:
// OIDC-Provider haben den Prefix "oidc-" in der providerId
// Credentials werden unter "auth_oidc_{providerId}" gespeichert
// Bestehende Logik erkennt automatisch "auth_oidc_*" Typen
// -> Keine Änderung nötig, da der Prefix "auth_" bereits geprüft wird
```

Die bestehende Logik in `getAllowedAuthMethods()` iteriert über `configuredTypes` und prüft `type.startsWith('auth_')` — OIDC-Credentials mit Typ `auth_oidc_keycloak` werden automatisch als `oidc_keycloak` in die Auth-Methods aufgenommen. Die Client-Seite muss den `oidc-` Prefix allerdings korrekt in `signIn.oauth2()` statt `signIn.social()` aufrufen.

#### 2.5 Server Functions

**Neue Datei:** `apps/web/src/lib/server/functions/oidc-providers.ts`

```typescript
// Admin-only Server Functions für OIDC-Provider-Verwaltung
export const listOidcProvidersFn = createServerFn(...)    // GET alle Provider
export const createOidcProviderFn = createServerFn(...)   // POST neuer Provider
export const updateOidcProviderFn = createServerFn(...)   // PATCH Provider bearbeiten
export const deleteOidcProviderFn = createServerFn(...)   // DELETE Provider löschen
export const validateDiscoveryFn = createServerFn(...)     // POST Discovery testen

// Jede Funktion prüft Admin-Berechtigung via requireWorkspaceRole
```

#### 2.6 Auth-Client erweitern

**Datei:** `apps/web/src/lib/server/auth/client.ts`

```typescript
import { genericOAuthClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    genericOAuthClient(),  // NEU: Für signIn.oauth2()
  ],
})
```

---

### Phase 3: Admin-UI

#### 3.1 Neue Admin-Route: OIDC-Provider verwalten

**Neue Datei:** `apps/web/src/routes/admin/settings.oidc-providers.tsx`

Diese Seite wird unter **Settings > OIDC Providers** erreichbar sein (neue Unterseite in den Settings).

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│  OIDC Providers                          [+ Add Provider]│
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 🔑 Keycloak (Corporate)                    [Edit] │ │
│  │    Discovery: https://keycloak.example.com/...      │ │
│  │    Status: ✓ Active                  [Toggle] [Del] │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 🔑 Auth0 (Development)                     [Edit] │ │
│  │    Discovery: https://dev-xxx.us.auth0.com/...      │ │
│  │    Status: ✓ Active                  [Toggle] [Del] │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│  │  No OIDC providers configured yet.                  │ │
│  │  Add a provider to allow login via any OIDC IdP.    │ │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
└──────────────────────────────────────────────────────────┘
```

#### 3.2 OIDC-Provider-Formular (Add/Edit Dialog)

**Neue Datei:** `apps/web/src/components/admin/settings/oidc/oidc-provider-form.tsx`

**Felder:**

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|-------------|
| Display Name | Text | Ja | Name im Login-Button (z.B. "Corporate SSO") |
| Provider ID | Slug | Ja | URL-safe Identifier (z.B. "keycloak-corp"), auto-generiert aus Name |
| Discovery URL | URL | Ja | `https://idp.example.com/.well-known/openid-configuration` |
| Client ID | Text | Ja | OAuth Client ID |
| Client Secret | Password | Ja | OAuth Client Secret |
| Scopes | Text | Nein | Standard: `openid profile email` |
| PKCE | Toggle | Nein | Standard: aktiviert |
| Issuer-Validierung | Toggle | Nein | Standard: aktiviert |
| Icon-Hintergrund | Color Picker | Nein | Tailwind-Klasse für Login-Button |

**Workflow:**
1. Admin gibt Discovery URL ein
2. "Test Connection"-Button ruft `validateDiscoveryFn` auf
3. Zeigt extrahierte Endpoints + Issuer an (Bestätigung)
4. Admin gibt Client ID/Secret ein
5. Speichern → Provider wird in DB angelegt + Credentials verschlüsselt
6. `resetAuth()` wird aufgerufen → Auth-Instanz wird mit neuem Provider neu erstellt

**Callback-URL-Anzeige:** Das Formular zeigt dem Admin die Redirect URI an, die im IdP konfiguriert werden muss:
```
Redirect URI: https://your-quackback.example.com/api/auth/callback/oidc-{providerId}
```

#### 3.3 Settings-Navigation erweitern

OIDC-Providers als neuen Menüpunkt in der Settings-Sidebar hinzufügen, unterhalb von "Portal Authentication".

#### 3.4 Portal-Auth-Settings erweitern

**Datei:** `apps/web/src/components/admin/settings/portal-auth/portal-auth-settings.tsx`

Die bestehende Portal-Auth-Settings-Seite zeigt OIDC-Provider als zusätzliche Karten im OAuth-Grid an:
- OIDC-Provider werden nach den statischen Providern angezeigt
- Badge "OIDC" zur Unterscheidung
- Link "Manage OIDC Providers" zur neuen Settings-Seite

---

### Phase 4: Login-Flow Integration

#### 4.1 OAuthButtons erweitern

**Datei:** `apps/web/src/components/auth/oauth-buttons.tsx`

```typescript
// Bestehender Flow für statische Provider:
authClient.signIn.social({ provider: 'github', ... })

// Neuer Flow für OIDC-Provider (über genericOAuthClient):
authClient.signIn.oauth2({ providerId: 'oidc-keycloak', ... })
```

Die `OAuthButtons`-Komponente muss erkennen, ob ein Provider ein OIDC-Provider ist (Prefix `oidc-`), und entsprechend `signIn.oauth2()` statt `signIn.social()` aufrufen.

#### 4.2 Auth-Complete Callback

Die bestehende `/auth/auth-complete`-Route funktioniert generisch — sie empfängt den OAuth-Callback und sendet den Erfolg via `BroadcastChannel`. Keine Änderung nötig.

#### 4.3 Bootstrap-Data erweitern

**Datei:** `apps/web/src/lib/server/functions/bootstrap.ts`

Die `getBootstrapData()`-Funktion muss die OIDC-Provider-Liste an den Client liefern, damit die Login-UI sie anzeigen kann:

```typescript
// In getPublicPortalConfig oder eigener Query:
// OIDC-Provider mit displayName, providerId, iconBg zurückgeben
// KEINE Secrets oder Discovery-URLs an den Client senden
```

---

### Phase 5: Validierung und Sicherheit

#### 5.1 Zod-Schemas

**Neue Datei:** `apps/web/src/lib/shared/schemas/oidc-provider.ts`

```typescript
export const createOidcProviderSchema = z.object({
  displayName: z.string().min(1).max(100),
  providerId: z.string().regex(/^[a-z0-9-]+$/).min(1).max(50),
  discoveryUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.string().default('openid profile email'),
  pkceEnabled: z.boolean().default(true),
  requireIssuerValidation: z.boolean().default(true),
  iconBg: z.string().default('bg-blue-600'),
  profileMapping: oidcProfileMappingSchema.optional(),
})
```

#### 5.2 Sicherheitsmaßnahmen

- **Discovery URL Validierung:** Nur HTTPS-URLs erlauben (außer `localhost` für Entwicklung)
- **SSRF-Schutz:** Discovery-Fetch mit Timeout (5s) und Blocklist für private IP-Ranges
- **Provider-ID Kollision:** Prüfen, dass `providerId` nicht mit bestehenden statischen Providern kollidiert
- **Rate Limiting:** Discovery-Validierung auf 10 Requests/Minute pro Admin limitieren
- **Credential-Verschlüsselung:** Bestehende AES-256-GCM-Verschlüsselung nutzen

#### 5.3 OIDC-Spezifische Validierung

- **Discovery-Dokument:** Muss `authorization_endpoint`, `token_endpoint`, `issuer` enthalten
- **Issuer-Match:** Wenn `requireIssuerValidation` aktiv, muss der `iss`-Claim im ID-Token mit dem konfigurierten Issuer übereinstimmen
- **Scopes:** `openid` muss immer enthalten sein (wird automatisch hinzugefügt wenn fehlend)

---

### Phase 6: Tests

#### 6.1 Unit Tests

- OIDC Provider Service: CRUD-Operationen, Discovery-Validierung
- Auth-Provider-Registry: `getAllAuthProvidersWithOidc()` gibt OIDC-Provider zurück
- Auth-Restrictions: OIDC-Provider werden korrekt in `getAllowedAuthMethods()` berücksichtigt
- Profile-Mapping: Custom-Claims werden korrekt auf Quackback-Felder gemappt
- Zod-Schema-Validierung

#### 6.2 Integration Tests

- Full OIDC-Login-Flow mit Mock-IdP
- Provider-Konfiguration über Admin-UI → Login verfügbar
- Provider deaktivieren → Login nicht mehr möglich
- Account-Linking: OIDC-Account mit bestehendem E-Mail-Account verknüpfen
- `resetAuth()` nach Provider-Änderung → neuer Provider aktiv

---

## Feature 2: Erzwungene Anmeldung für Portal-Besucher

### Motivation

Aktuell erlaubt das Portal über `publicView: true` unauthentifizierten Besuchern, Inhalte zu sehen. In vielen Szenarien — insbesondere bei internen Feedback-Portalen mit OIDC-Anbindung — soll der gesamte Portal-Zugang erst nach Anmeldung möglich sein. Kein anonymes Browsen, kein "Vorbeischauen" ohne Account.

### Ist-Zustand

Die `publicView`-Einstellung in `PortalFeatures` steuert bereits, ob unauthentifizierte User Inhalte sehen können. **Allerdings** zeigt das Portal aktuell trotzdem die Seite mit einem Auth-Dialog an — der Besucher sieht die leere Portal-Shell und muss aktiv auf "Login" klicken.

### Zielzustand

Wenn `publicView: false`:
1. Unauthentifizierte Besucher werden **sofort** auf die Login-Seite umgeleitet
2. Es gibt keinen Portal-Content im Hintergrund (keine leere Shell)
3. Nach erfolgreicher Anmeldung: Redirect zurück zur ursprünglichen URL
4. **Besonders mit OIDC:** Wenn nur ein einziger Auth-Provider aktiv ist, wird der Besucher direkt zum IdP weitergeleitet (Skip Login Page)

### Architektur-Überblick

```
Portal-Besucher (kein Cookie)
       │
       ▼
┌─────────────────────────────────────────┐
│  Portal-Route Middleware / Loader       │
│  1. publicView: false?                  │
│  2. Keine Session? → Redirect /login    │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Login-Seite                            │
│  - Nur ein Provider aktiv?              │
│    → Auto-Redirect zum IdP             │
│  - Mehrere Provider?                    │
│    → Provider-Auswahl anzeigen          │
└────────────────┬────────────────────────┘
                 │
                 ▼  OAuth/OIDC-Flow
┌─────────────────────────────────────────┐
│  IdP (Keycloak, Okta, Auth0, ...)       │
│  - User authentifiziert sich            │
│  - Redirect zurück zum Portal           │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Portal (authentifiziert)               │
│  - Session-Cookie gesetzt               │
│  - Redirect zur ursprünglichen URL     │
│  - Voller Zugang                        │
└─────────────────────────────────────────┘
```

### Implementierungsschritte

#### B1: Portal-Loader Auth-Guard

**Datei:** `apps/web/src/routes/_portal.tsx`

Im SSR-Loader der Portal-Route wird geprüft, ob `requireAuth` aktiviert ist. Wenn ja und keine Session vorhanden: Redirect auf die Login-Seite.

```typescript
// Im SSR-Loader der Portal-Route:
async function portalLoader() {
  const portalConfig = await getPublicPortalConfig()
  const session = await getSessionFromHeaders()

  if (portalConfig.oauth.requireAuth && !session?.user) {
    // Harter Redirect statt Auth-Dialog
    throw redirect({
      to: '/portal/login',
      search: { returnTo: getCurrentPath() },
    })
  }

  // ... rest des Loaders ...
}
```

**Warum SSR-seitig?** Client-seitige Redirects zeigen kurz die ungeschützte Seite (Flash). SSR-Redirects verhindern das vollständig — der Browser bekommt direkt ein 302.

#### B2: Dedizierte Portal-Login-Route

**Neue Datei:** `apps/web/src/routes/portal.login.tsx`

Separate Login-Seite für das Portal (statt Modal/Dialog):

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│              [Logo / Workspace-Name]                     │
│                                                          │
│          Melde dich an, um fortzufahren                  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  🔑  Mit Corporate SSO anmelden                    │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  🔑  Mit GitHub anmelden                           │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  🔑  Mit Google anmelden                           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│                     ── oder ──                           │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  E-Mail: ___________________________________      │  │
│  │  Passwort: _________________________________      │  │
│  │                              [Anmelden]           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Konfiguration via `returnTo`:** Nach erfolgreicher Anmeldung wird der User zur ursprünglichen URL weitergeleitet.

#### B3: Konfigurierbarer Auto-Redirect bei Single-Provider

Wenn nur ein einziger Auth-Provider aktiv ist (z.B. nur OIDC-Keycloak) **und** der Admin Auto-Redirect aktiviert hat, wird die Login-Seite übersprungen:

**Neue Einstellung in `PortalAuthMethods`:**
```typescript
export interface PortalAuthMethods {
  // ... bestehende Felder ...
  requireAuth?: boolean
  /** Skip login page and redirect directly to the IdP when only one provider is active */
  autoRedirect?: boolean
}
```

```typescript
// In portal.login.tsx Loader:
async function loginLoader({ search }) {
  const portalConfig = await getPublicPortalConfig()
  const allowedMethods = await getAllowedAuthMethods('user')
  const activeProviders = Object.entries(allowedMethods)
    .filter(([_, enabled]) => enabled)

  // Auto-Redirect: nur ein OAuth-Provider aktiv + Admin hat es aktiviert
  if (
    portalConfig.oauth.autoRedirect &&
    activeProviders.length === 1 &&
    activeProviders[0][0] !== 'password' &&
    activeProviders[0][0] !== 'email'
  ) {
    const providerId = activeProviders[0][0]
    throw redirect({
      to: `/api/auth/signin/${providerId}`,
      search: { callbackURL: search.returnTo ?? '/portal' },
    })
  }

  return { allowedMethods, returnTo: search.returnTo }
}
```

**Admin-UI:** Neuer Toggle in den Portal-Auth-Settings:

```
[Toggle] Auto-Redirect to Provider
When enabled and only one authentication provider is
active, visitors are sent directly to that provider's
login page without seeing the Quackback login screen.
```

**Use Case:** Unternehmen mit Keycloak als einzigem Login → Besucher landet direkt auf der Keycloak-Login-Seite, ohne Quackback-Zwischenseite.

#### B4: Neue Einstellung `requireAuth` in den Portal-Auth-Settings

Das Feature wird über eine **eigene, unabhängige Einstellung** in den Portal-Auth-Settings aktivierbar — getrennt von `publicView`.

**Datei:** `apps/web/src/lib/server/domains/settings/settings.types.ts`

```typescript
export interface PortalAuthMethods {
  // ... bestehende Felder ...

  /** Require authentication before accessing any portal content */
  requireAuth?: boolean
}
```

**Warum eine eigene Einstellung statt `publicView` zu nutzen?**
- `publicView` steuert, ob Inhalte sichtbar sind (read-only Zugang)
- `requireAuth` erzwingt eine Anmeldung vor jedem Zugriff (auch Lesen)
- Beide Einstellungen sind unabhängig konfigurierbar:

| `publicView` | `requireAuth` | Verhalten |
|:---:|:---:|---|
| `true` | `false` | Anonym browsen, Auth-Dialog bei Aktionen **(Standard)** |
| `true` | `true` | Redirect zur Login-Seite, nach Anmeldung volles Portal |
| `false` | `false` | Portal verborgen, Auth-Dialog bei Aktionen |
| `false` | `true` | Redirect zur Login-Seite, nach Anmeldung verborgen — sinnlos, UI warnt |

**Standard:** `requireAuth: false` (opt-in, um Rückwärtskompatibilität zu gewährleisten).

**Admin-UI:** Neuer Toggle in den Portal-Auth-Settings:

```
[Toggle] Require Authentication
When enabled, visitors must sign in before they can
access the portal. They will be redirected to the login
page automatically.

If only one authentication provider is active (e.g. a
single OIDC provider), visitors are sent directly to
that provider's login page.
```

#### B5: UI-Anpassungen für erzwungene Anmeldung

##### a) Portal-Navigation

Wenn `publicView: false` und User ist eingeloggt, wird kein "Login"-Button gebraucht — stattdessen User-Avatar und Logout.

##### b) Admin-Settings

Der neue `requireAuth`-Toggle wird in den Portal-Auth-Settings angezeigt (siehe B4). Er ist unabhängig von `publicView` und hat eine eigene Beschreibung.

#### B6: Tests

**Unit Tests:**
- `requireAuth: true` + keine Session → Redirect auf `/portal/login`
- `requireAuth: true` + gültige Session → Portal-Inhalte laden
- `requireAuth: false` + keine Session → Portal wie bisher (bestehend)

**Integration Tests:**
- Besucher → Portal → Redirect → OIDC-Login → Redirect zurück → Portal geladen
- `autoRedirect: true` + nur Keycloak aktiv → kein Zwischenschritt
- `autoRedirect: false` + nur Keycloak → Login-Seite wird angezeigt
- Multiple Provider: Keycloak + GitHub → Login-Seite mit Auswahl (unabhängig von `autoRedirect`)
- `returnTo` wird nach Login korrekt aufgelöst

---

## Betroffene Dateien

### Neue Dateien (OIDC)
| Datei | Beschreibung |
|-------|-------------|
| `packages/db/src/schema/oidc-providers.ts` | Drizzle-Schema für `oidc_providers` Tabelle |
| `apps/web/src/lib/server/domains/oidc-providers/oidc-provider.service.ts` | CRUD + Validierung |
| `apps/web/src/lib/server/functions/oidc-providers.ts` | Server Functions (Admin API) |
| `apps/web/src/lib/shared/schemas/oidc-provider.ts` | Zod-Validierungsschemas |
| `apps/web/src/routes/admin/settings.oidc-providers.tsx` | Admin-Seite |
| `apps/web/src/components/admin/settings/oidc/oidc-provider-form.tsx` | Formular-Komponente |
| `apps/web/src/components/admin/settings/oidc/oidc-provider-card.tsx` | Karten-Komponente |

### Neue Dateien (Erzwungene Anmeldung)
| Datei | Beschreibung |
|-------|-------------|
| `apps/web/src/routes/portal.login.tsx` | Dedizierte Portal-Login-Seite mit Auto-Redirect-Logik |

### Geänderte Dateien
| Datei | Änderung |
|-------|---------|
| `packages/ids/src/index.ts` | TypeID `oidc_prov` hinzufügen |
| `packages/db/src/schema/index.ts` | Export der neuen Tabelle |
| `apps/web/src/lib/server/auth/index.ts` | `genericOAuth` Plugin integrieren |
| `apps/web/src/lib/server/auth/client.ts` | `genericOAuthClient` Plugin hinzufügen |
| `apps/web/src/lib/server/auth/auth-providers.ts` | `getAllAuthProvidersWithOidc()` Funktion |
| `apps/web/src/lib/server/auth/auth-restrictions.ts` | OIDC-Provider in Auth-Methods |
| `apps/web/src/components/auth/oauth-buttons.tsx` | `signIn.oauth2()` für OIDC-Provider |
| `apps/web/src/components/admin/settings/portal-auth/portal-auth-settings.tsx` | OIDC-Provider im Grid, `requireAuth`-Toggle |
| `apps/web/src/routes/_portal.tsx` | SSR-Auth-Guard mit Redirect auf `/portal/login` |
| Settings-Navigation | Neuer Menüpunkt "OIDC Providers" |

---

## Entscheidungen (geklärt)

| # | Frage | Entscheidung |
|---|-------|-------------|
| 1 | Token-Refresh für OIDC | **Nicht relevant.** Session-basierte Auth reicht. |
| 2 | SAML-Support | **Kein SAML.** Nur OIDC via `genericOAuth`. |
| 3 | Portal + Team | **Beide.** OIDC-Provider für Portal-User und Team-Member. |
| 4 | Provider-Icons | **Nur Farbauswahl.** Kein Icon-Upload. Tailwind-Klasse für Button-BG. |
| 5 | Provider-Limit | **Kein Limit.** Beliebig viele OIDC-Provider gleichzeitig. |
| 6 | `requireAuth` Einstellung | **Eigene Einstellung** in `PortalAuthMethods`, unabhängig von `publicView`. |
| 7 | Single-Provider-Auto-Redirect | **Konfigurierbar.** Admin-Setting `autoRedirect` in den Portal-Auth-Settings. |

---

## Abhängigkeiten

- **Better Auth ≥ 1.4.x** (bereits vorhanden) — `genericOAuth` Plugin ist in `better-auth/plugins` enthalten
- **Keine neuen npm-Pakete nötig** — alles ist Teil des Better Auth Core-Pakets

## Referenzen

- [Better Auth: Generic OAuth Plugin](https://www.better-auth.com/docs/plugins/generic-oauth)
- [Better Auth: SSO Plugin](https://www.better-auth.com/docs/plugins/sso)
- [Better Auth: OAuth Provider Plugin](https://www.better-auth.com/docs/plugins/oauth-provider)
- [OpenID Connect Discovery Spec](https://openid.net/specs/openid-connect-discovery-1_0.html)
