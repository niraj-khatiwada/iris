import type { ReactNode } from 'react'

import { cn } from '@/utils/tailwind'

function UIProvider({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'app-atmosphere h-full w-full overflow-hidden text-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

UIProvider.displayName = 'UIProvider'

export default UIProvider
