import { createFileRoute } from '@tanstack/react-router'

import ChatWorkspace from '@/ui/ChatWorkspace'

export const Route = createFileRoute('/(root)/')({
  component: ChatWorkspace,
})
