import { openUrl } from '@tauri-apps/plugin-opener'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { isTauri } from '@/utils/tauri'

function Markdown({ children }: { children: string }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault()
                if (!href) {
                  return
                }

                if (isTauri()) {
                  void openUrl(href)
                } else {
                  window.open(href, '_blank', 'noopener,noreferrer')
                }
              }}
            >
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

Markdown.displayName = 'Markdown'

export default Markdown
