import Logo from '@/components/Logo'

/** The voice-first working state: a living orb, expanding rings, and a small waveform. */
function IrisEffect() {
  return (
    <div aria-hidden="true" className="iris-effect">
      <div className="iris-effect-core">
        <span className="iris-effect-ring" />
        <span className="iris-effect-ring" />
        <span className="iris-effect-ring" />
        <Logo animated size={58} />
      </div>
      <div className="iris-effect-wave">
        {Array.from({ length: 21 }, (_, index) => (
          <span key={index} style={{ animationDelay: `${index * 0.06}s` }} />
        ))}
      </div>
    </div>
  )
}

IrisEffect.displayName = 'IrisEffect'

export default IrisEffect
