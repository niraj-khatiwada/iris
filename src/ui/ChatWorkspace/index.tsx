import ChatHeader from '@/components/ChatHeader'
import Composer from '@/components/Composer'
import MessageList from '@/components/MessageList'
import SettingsDialog from '@/components/SettingsDialog'
import Sidebar from '@/components/Sidebar'
import { useHistorySync } from '@/hooks/useHistorySync'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useShortcutSync } from '@/hooks/useShortcutSync'
import { useThemeSync } from '@/hooks/useThemeSync'

function ChatWorkspace() {
  useThemeSync()
  useKeyboardShortcuts()
  useHistorySync()
  useShortcutSync()

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader />
        <MessageList />
        <Composer />
      </main>
      <SettingsDialog />
    </div>
  )
}

ChatWorkspace.displayName = 'ChatWorkspace'

export default ChatWorkspace
