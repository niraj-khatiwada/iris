import { Tooltip } from '@heroui/react'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import Button from '@/components/Button'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <Tooltip delay={400}>
      <Button
        isIconOnly
        aria-label={copied ? 'Copied' : 'Copy message'}
        className="size-6 min-w-6 text-muted"
        size="sm"
        variant="ghost"
        onPress={copy}
      >
        {copied ? (
          <Check className="size-3.5 text-primary" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
      <Tooltip.Content>{copied ? 'Copied' : 'Copy'}</Tooltip.Content>
    </Tooltip>
  )
}

CopyButton.displayName = 'CopyButton'

export default CopyButton
