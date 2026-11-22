import type { ReactNode } from 'react'

import { cn } from '@/utils/tailwind'

type ShimmerTextProps = {
  children: ReactNode
  className?: string
}

/**
 * A subtle light sweep for open-ended activity labels such as "Thinking". The stylesheet
 * falls back to plain text when the system prefers reduced motion.
 */
function ShimmerText({ children, className }: ShimmerTextProps) {
  return <span className={cn('shimmer-text', className)}>{children}</span>
}

ShimmerText.displayName = 'ShimmerText'

export default ShimmerText
