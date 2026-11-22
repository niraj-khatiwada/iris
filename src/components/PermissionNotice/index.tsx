import { Button } from '@heroui/react'
import { Info, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/utils/tailwind'

type PermissionNoticeProps = {
  message: ReactNode
  onOpenSettings: () => void
  onDismiss: () => void
  className?: string
}

/** One neutral permission banner for Screen Recording, Accessibility, and future prompts. */
function PermissionNotice({
  message,
  onOpenSettings,
  onDismiss,
  className,
}: PermissionNoticeProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border/50 bg-surface/45 px-3 py-2 text-[11px] leading-4 text-foreground/70 backdrop-blur-xl',
        className,
      )}
    >
      <Info className="size-3.5 shrink-0 text-foreground/55" />
      <p className="min-w-0 flex-1">{message}</p>
      <Button
        className="h-7 min-w-0 shrink-0 px-2 text-[11px]"
        size="sm"
        variant="secondary"
        onPress={onOpenSettings}
      >
        Open Settings
      </Button>
      <Button
        isIconOnly
        aria-label="Dismiss permission notice"
        className="size-7 min-w-7 shrink-0 text-foreground/45"
        size="sm"
        variant="ghost"
        onPress={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

PermissionNotice.displayName = 'PermissionNotice'

export default PermissionNotice
