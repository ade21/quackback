import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid'
import {
  createOidcProviderFn,
  updateOidcProviderFn,
  validateDiscoveryFn,
} from '@/lib/server/functions/oidc-providers'

interface OidcProviderData {
  id: string
  providerId: string
  displayName: string
  discoveryUrl: string
  iconBg: string | null
  enabled: boolean
}

interface OidcProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider?: OidcProviderData
  onSaved: () => void
}

const COLOR_OPTIONS = [
  { label: 'Blue', value: 'bg-blue-600' },
  { label: 'Green', value: 'bg-green-600' },
  { label: 'Purple', value: 'bg-purple-600' },
  { label: 'Red', value: 'bg-red-600' },
  { label: 'Orange', value: 'bg-orange-600' },
  { label: 'Gray', value: 'bg-gray-900' },
  { label: 'Indigo', value: 'bg-indigo-600' },
  { label: 'Sky', value: 'bg-sky-600' },
]

export function OidcProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: OidcProviderDialogProps) {
  const isEdit = !!provider

  const [providerId, setProviderId] = useState(provider?.providerId ?? '')
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '')
  const [discoveryUrl, setDiscoveryUrl] = useState(provider?.discoveryUrl ?? '')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [iconBg, setIconBg] = useState(provider?.iconBg ?? 'bg-blue-600')
  const [pkceEnabled, setPkceEnabled] = useState(true)
  const [requireIssuerValidation, setRequireIssuerValidation] = useState(true)
  const [scopes, setScopes] = useState('openid profile email')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [discoveryResult, setDiscoveryResult] = useState<{
    valid: boolean
    issuer?: string
    error?: string
  } | null>(null)

  const resetForm = () => {
    setProviderId(provider?.providerId ?? '')
    setDisplayName(provider?.displayName ?? '')
    setDiscoveryUrl(provider?.discoveryUrl ?? '')
    setClientId('')
    setClientSecret('')
    setIconBg(provider?.iconBg ?? 'bg-blue-600')
    setPkceEnabled(true)
    setRequireIssuerValidation(true)
    setScopes('openid profile email')
    setError(null)
    setDiscoveryResult(null)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) resetForm()
    onOpenChange(newOpen)
  }

  const handleValidateDiscovery = async () => {
    if (!discoveryUrl.trim()) return
    setValidating(true)
    setDiscoveryResult(null)

    try {
      const result = await validateDiscoveryFn({ data: { discoveryUrl } })
      setDiscoveryResult(result)
    } catch (err) {
      setDiscoveryResult({
        valid: false,
        error: err instanceof Error ? err.message : 'Validation failed',
      })
    } finally {
      setValidating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      if (isEdit) {
        await updateOidcProviderFn({
          data: {
            id: provider.id,
            displayName: displayName.trim(),
            discoveryUrl: discoveryUrl.trim(),
            iconBg,
            pkceEnabled,
            requireIssuerValidation,
            scopes,
            ...(clientId.trim() && { clientId: clientId.trim() }),
            ...(clientSecret.trim() && { clientSecret: clientSecret.trim() }),
          },
        })
      } else {
        if (!clientId.trim() || !clientSecret.trim()) {
          setError('Client ID and Client Secret are required')
          setSaving(false)
          return
        }
        await createOidcProviderFn({
          data: {
            providerId: providerId.trim(),
            displayName: displayName.trim(),
            discoveryUrl: discoveryUrl.trim(),
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
            iconBg,
            pkceEnabled,
            requireIssuerValidation,
            scopes,
          },
        })
      }
      handleOpenChange(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = isEdit
    ? displayName.trim() && discoveryUrl.trim()
    : providerId.trim() &&
      displayName.trim() &&
      discoveryUrl.trim() &&
      clientId.trim() &&
      clientSecret.trim()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit OIDC Provider' : 'Add OIDC Provider'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the provider configuration. Leave credentials blank to keep the existing values.'
              : 'Connect a custom OIDC identity provider for single sign-on.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Provider ID (create only) */}
          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="providerId">Provider ID</Label>
              <Input
                id="providerId"
                placeholder="e.g. keycloak, okta, authentik"
                value={providerId}
                onChange={(e) =>
                  setProviderId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }
                disabled={saving}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only. Cannot be changed after creation.
              </p>
            </div>
          )}

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              placeholder="e.g. Company SSO, Keycloak"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Discovery URL */}
          <div className="space-y-2">
            <Label htmlFor="discoveryUrl">Discovery URL</Label>
            <div className="flex gap-2">
              <Input
                id="discoveryUrl"
                placeholder="https://idp.example.com/.well-known/openid-configuration"
                value={discoveryUrl}
                onChange={(e) => {
                  setDiscoveryUrl(e.target.value)
                  setDiscoveryResult(null)
                }}
                disabled={saving}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleValidateDiscovery}
                disabled={saving || validating || !discoveryUrl.trim()}
              >
                {validating ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Validate'}
              </Button>
            </div>
            {discoveryResult && (
              <div className="flex items-center gap-1.5 text-xs">
                {discoveryResult.valid ? (
                  <>
                    <CheckCircleIcon className="h-4 w-4 text-green-600" />
                    <span className="text-green-600">Valid</span>
                    {discoveryResult.issuer && (
                      <span className="text-muted-foreground">
                        — Issuer: {discoveryResult.issuer}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <XCircleIcon className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">{discoveryResult.error}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Credentials */}
          <div className="space-y-2">
            <Label htmlFor="clientId">
              Client ID{' '}
              {isEdit && (
                <span className="text-muted-foreground font-normal">(leave blank to keep)</span>
              )}
            </Label>
            <Input
              id="clientId"
              placeholder="Enter OAuth Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">
              Client Secret{' '}
              {isEdit && (
                <span className="text-muted-foreground font-normal">(leave blank to keep)</span>
              )}
            </Label>
            <Input
              id="clientSecret"
              type="password"
              placeholder="Enter OAuth Client Secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Scopes */}
          <div className="space-y-2">
            <Label htmlFor="scopes">Scopes</Label>
            <Input
              id="scopes"
              placeholder="openid profile email"
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Space-separated list. &quot;openid&quot; is always included.
            </p>
          </div>

          {/* Icon Color */}
          <div className="space-y-2">
            <Label>Button Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setIconBg(color.value)}
                  className={`h-8 w-8 rounded-md ${color.value} transition-all ${
                    iconBg === color.value
                      ? 'ring-2 ring-primary ring-offset-2'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          {/* Advanced Options */}
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Advanced
            </p>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">PKCE</Label>
                <p className="text-xs text-muted-foreground">
                  Proof Key for Code Exchange (recommended)
                </p>
              </div>
              <Switch checked={pkceEnabled} onCheckedChange={setPkceEnabled} disabled={saving} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Issuer Validation</Label>
                <p className="text-xs text-muted-foreground">
                  Verify token issuer matches discovery
                </p>
              </div>
              <Switch
                checked={requireIssuerValidation}
                onCheckedChange={setRequireIssuerValidation}
                disabled={saving}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !canSubmit}>
              {saving ? (
                <>
                  <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Add Provider'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
