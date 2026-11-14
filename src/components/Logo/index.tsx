import { cn } from '@/utils/tailwind'

type LogoProps = {
  size?: number
  className?: string
  animated?: boolean
}

/** The assistant's presence: a small, quietly alive core. */
function Logo({ size = 32, className, animated = true }: LogoProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('agent-orb', animated && 'agent-orb--animated', className)}
      style={{ width: size, height: size }}
    >
      <span className="agent-orb-halo" />
      <span className="agent-orb-core" />
      <span className="agent-orb-glint" />
    </div>
  )
}

Logo.displayName = 'Logo'

export default Logo
