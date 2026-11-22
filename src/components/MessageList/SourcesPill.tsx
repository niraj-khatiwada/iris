import { Button, Popover } from '@heroui/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Globe } from 'lucide-react'

import type { ChatSource } from '@/types/chat'
import { isTauri } from '@/utils/tauri'

function siteLabel(source: ChatSource) {
  if (source.siteName?.trim()) {
    return source.siteName.trim()
  }
  try {
    return new URL(source.url).hostname.replace(/^www\./, '')
  } catch {
    return source.url
  }
}

function openSource(url: string) {
  if (isTauri()) {
    void openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** The compact source list shown below a reply that used DeepSeek's web tools. */
function SourcesPill({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) {
    return null
  }

  return (
    <Popover>
      <Button
        aria-label={`Sources (${sources.length})`}
        className="mt-2 h-6 min-w-0 gap-1.5 rounded-full border border-border/40 bg-background/20 px-2 text-[10px] text-muted"
        size="sm"
        variant="ghost"
      >
        <Globe className="size-3 shrink-0" />
        <span className="font-medium">Sources</span>
        <span className="text-muted/60">{sources.length}</span>
      </Button>
      <Popover.Content
        className="w-80 max-w-[min(90vw,20rem)] rounded-xl p-0"
        offset={8}
        placement="top"
      >
        <Popover.Dialog className="p-1">
          <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
            <span className="text-[10px] font-medium tracking-[0.12em] text-muted uppercase">
              Sources
            </span>
            <span className="text-[10px] text-muted/60">{sources.length}</span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {sources.map((source, index) => (
              <button
                key={`${source.url}-${index}`}
                type="button"
                className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
                onClick={() => openSource(source.url)}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted">
                  <Globe className="size-3 shrink-0" />
                  <span className="truncate">{siteLabel(source)}</span>
                </span>
                <span className="line-clamp-2 text-[12px] leading-4 text-foreground/85">
                  {source.title}
                </span>
                {source.snippet ? (
                  <span className="line-clamp-2 text-[10px] leading-4 text-muted/80">
                    {source.snippet}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

SourcesPill.displayName = 'SourcesPill'

export default SourcesPill
