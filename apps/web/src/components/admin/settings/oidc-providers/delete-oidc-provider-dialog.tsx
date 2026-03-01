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
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { deleteOidcProviderFn } from '@/lib/server/functions/oidc-providers'

interface DeleteOidcProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: { id: string; displayName: string; providerId: string } | null
  onDeleted: () => void
}

export function DeleteOidcProviderDialog({
  open,
  onOpenChange,
  provider,
  onDeleted,
}: DeleteOidcProviderDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!provider) return
    setDeleting(true)
    setError(null)

    try {
      await deleteOidcProviderFn({ data: { id: provider.id } })
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete provider')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete OIDC Provider</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{provider?.displayName}</strong>? This will
            remove the provider configuration and its encrypted credentials. Users who signed in via
            this provider will need to use another method.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete Provider'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
