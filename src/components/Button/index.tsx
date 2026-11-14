import { Button as HeroButton } from '@heroui/react'
import type { ComponentProps } from 'react'

import { cn } from '@/utils/tailwind'

type ButtonProps = ComponentProps<typeof HeroButton>

function Button({ className, ...props }: ButtonProps) {
  return <HeroButton className={cn('font-medium', className)} {...props} />
}

Button.displayName = 'Button'

export type { ButtonProps }
export default Button
