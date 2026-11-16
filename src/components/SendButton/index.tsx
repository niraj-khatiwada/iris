import { Button } from '@heroui/react'
import { ArrowUp } from 'lucide-react'

/** The shared send control: neutral glass in both the quick overlay and the history composer. */
function SendButton({
  isDisabled,
  onPress,
}: {
  isDisabled?: boolean
  onPress: () => void
}) {
  return (
    <Button
      isIconOnly
      aria-label="Send message"
      className="size-8 min-w-8 rounded-full border border-border/60 bg-surface/60 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md transition-colors hover:bg-surface/80 disabled:opacity-40"
      isDisabled={isDisabled}
      size="sm"
      variant="ghost"
      onPress={onPress}
    >
      <ArrowUp className="size-4" />
    </Button>
  )
}

SendButton.displayName = 'SendButton'

export default SendButton
