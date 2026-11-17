import ArchivedComposer from '@/components/ArchivedComposer'
import ChatHeader from '@/components/ChatHeader'
import Composer from '@/components/Composer'
import MessageList from '@/components/MessageList'
import SettingsDialog from '@/components/SettingsDialog'
import Sidebar from '@/components/Sidebar'
import { useChatStorage } from '@/hooks/useChatStorage'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useSettingsSync } from '@/hooks/useSettingsSync'
import { useShortcutSync } from '@/hooks/useShortcutSync'
import { useStopSpeakingShortcut } from '@/hooks/useStopSpeakingShortcut'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useChatStore } from '@/stores/chatStore'

function ChatWorkspace() {
  const activeConversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )

  useThemeSync()
  useKeyboardShortcuts()
  useStopSpeakingShortcut()
  useChatStorage()
  useSettingsSync()
  useShortcutSync()

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader />
        <MessageList />
        {activeConversation?.archivedAt ? (
          <ArchivedComposer conversation={activeConversation} />
        ) : (
          <Composer />
        )}
      </main>
      <SettingsDialog />
    </div>
  )
}

ChatWorkspace.displayName = 'ChatWorkspace'

export default ChatWorkspace
