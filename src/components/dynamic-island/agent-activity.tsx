import { useCallback, useEffect, useRef } from 'react'

import { Glyph } from '@/components/islandcn/glyph'
import { SparkleGlyph, WarningGlyph } from '@/components/islandcn/glyphs'
import { IslandButton } from '@/components/islandcn/island-button'
import {
  BottomBar,
  ExpandedBottom,
  SensorRow,
} from '@/components/islandcn/island-layout'
import {
  CompactText,
  ContextLabel,
  ExpandedSubtitle,
  ExpandedTitle,
  MinimalPair,
} from '@/components/islandcn/island-text'
import { ShimmerText } from '@/components/islandcn/shimmer-text'
import { Spinner } from '@/components/islandcn/spinner'
import { islandAccent } from '@/components/islandcn/theme'
import { TickingTime } from '@/components/islandcn/ticking-time'
import type { ActivityHandle } from '@/lib/island'
import { useIslandActions } from '@/lib/island'
import { useChatStore } from '@/stores/chatStore'

const RUN_ACTIVITY_ID = 'iris:response'
const ERROR_ACTIVITY_ID = 'iris:response-error'
const ACCENT = islandAccent.sky
const ERROR_ACCENT = islandAccent.red

/** Shows the in-flight agent response on the dynamic island. */
function AgentActivity() {
  const island = useIslandActions()
  const handle = useRef<ActivityHandle | null>(null)
  const errorHandle = useRef<ActivityHandle | null>(null)
  const errorTimer = useRef<number | null>(null)
  const alertedErrorId = useRef('')

  const requestId = useChatStore((state) => state.streamingRequestId)
  const hasContent = useChatStore((state) => {
    if (!state.streamingMessageId) {
      return false
    }

    for (const conversation of state.conversations) {
      const message = conversation.messages.find(
        (item) => item.id === state.streamingMessageId,
      )
      if (message) {
        return message.content.length > 0
      }
    }

    return false
  })
  const title = useChatStore((state) => {
    const conversation = state.conversations.find(
      (item) => item.id === state.streamingConversationId,
    )
    return conversation?.title ?? 'New conversation'
  })
  const prompt = useChatStore((state) => {
    const messages =
      state.conversations.find(
        (item) => item.id === state.streamingConversationId,
      )?.messages ?? []

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        return messages[index].content
      }
    }

    return ''
  })
  const startedAt = useChatStore((state) => {
    if (!state.streamingMessageId) {
      return 0
    }

    for (const conversation of state.conversations) {
      const message = conversation.messages.find(
        (item) => item.id === state.streamingMessageId,
      )
      if (message) {
        return message.createdAt
      }
    }

    return 0
  })
  const errorId = useChatStore((state) => {
    const conversation = state.conversations.find(
      (item) => item.id === state.activeConversationId,
    )
    const messages = conversation?.messages ?? []
    const message = messages[messages.length - 1]
    return message?.status === 'error' ? message.id : ''
  })
  const errorCreatedAt = useChatStore((state) => {
    const conversation = state.conversations.find(
      (item) => item.id === state.activeConversationId,
    )
    const messages = conversation?.messages ?? []
    const message = messages[messages.length - 1]
    return message?.status === 'error' ? message.createdAt : 0
  })
  const errorText = useChatStore((state) => {
    const conversation = state.conversations.find(
      (item) => item.id === state.activeConversationId,
    )
    const messages = conversation?.messages ?? []
    const message = messages[messages.length - 1]
    return message?.status === 'error'
      ? (message.error ?? 'Something went wrong.')
      : ''
  })
  const mountedAt = useRef(Date.now())

  const stop = useCallback(() => {
    void useChatStore.getState().stopStreaming()
    island.collapse()
  }, [island])

  // Start, update and end the response activity with the run's lifecycle.
  useEffect(() => {
    if (!requestId) {
      handle.current?.end()
      handle.current = null
      return
    }

    const content = buildResponseContent({
      hasContent,
      title,
      prompt,
      startedAt: startedAt || Date.now(),
      onStop: stop,
    })
    const label = `Iris ${hasContent ? 'replying' : 'thinking'} in ${title}`

    if (handle.current) {
      handle.current.update({ ...content, label, transition: 'crossfade' })
      return
    }

    handle.current = island.start({
      id: RUN_ACTIVITY_ID,
      group: 'iris',
      priority: 1,
      label,
      ...content,
    })
  }, [hasContent, island, prompt, requestId, startedAt, stop, title])

  // A failed response is the one thing worth interrupting the user for. Errors restored from a
  // previous session stay in the transcript without alerting on launch.
  useEffect(() => {
    if (
      !errorId ||
      alertedErrorId.current === errorId ||
      errorCreatedAt < mountedAt.current
    ) {
      return
    }

    alertedErrorId.current = errorId
    errorHandle.current = island.start({
      id: ERROR_ACTIVITY_ID,
      group: 'iris',
      priority: 2,
      alert: true,
      label: `Iris error. ${errorText}`,
      compact: {
        leading: <Glyph color={ERROR_ACCENT} icon={WarningGlyph} />,
        trailing: <CompactText>!</CompactText>,
      },
      minimal: (
        <MinimalPair
          leading={<Glyph color={ERROR_ACCENT} icon={WarningGlyph} size={20} />}
          trailing={<CompactText>!</CompactText>}
        />
      ),
      expanded: {
        leading: (
          <SensorRow
            glyph={<Glyph color={ERROR_ACCENT} icon={WarningGlyph} size={18} />}
          >
            <ContextLabel>Iris</ContextLabel>
          </SensorRow>
        ),
        bottom: (
          <ExpandedBottom gap={6}>
            <ExpandedTitle>Couldn&apos;t respond</ExpandedTitle>
            <ExpandedSubtitle>{errorText}</ExpandedSubtitle>
          </ExpandedBottom>
        ),
      },
    })

    if (errorTimer.current) {
      window.clearTimeout(errorTimer.current)
    }
    errorTimer.current = window.setTimeout(() => {
      errorHandle.current?.end()
      errorHandle.current = null
      errorTimer.current = null
    }, 6200)
  }, [errorCreatedAt, errorId, errorText, island])

  // A new run supersedes a notice that is still on screen.
  useEffect(() => {
    if (!requestId) {
      return
    }

    island.end(ERROR_ACTIVITY_ID)
    alertedErrorId.current = ''
    if (errorTimer.current) {
      window.clearTimeout(errorTimer.current)
      errorTimer.current = null
    }
  }, [island, requestId])

  // Removing the component (or the window) dismisses its activities.
  useEffect(
    () => () => {
      handle.current?.end()
      errorHandle.current?.end()
      if (errorTimer.current) {
        window.clearTimeout(errorTimer.current)
      }
    },
    [],
  )

  return null
}

function buildResponseContent({
  hasContent,
  title,
  prompt,
  startedAt,
  onStop,
}: {
  hasContent: boolean
  title: string
  prompt: string
  startedAt: number
  onStop: () => void
}) {
  return {
    compact: {
      leading: <Glyph color={ACCENT} icon={SparkleGlyph} />,
      trailing: (
        <CompactText>
          <TickingTime source={{ kind: 'elapsed', since: startedAt }} />
        </CompactText>
      ),
    },
    minimal: (
      <MinimalPair
        leading={<Glyph color={ACCENT} icon={SparkleGlyph} size={20} />}
        trailing={<Spinner color={ACCENT} size={20} />}
      />
    ),
    expanded: {
      leading: (
        <SensorRow
          glyph={<Glyph color={ACCENT} icon={SparkleGlyph} size={18} />}
        >
          <ContextLabel>{hasContent ? 'Replying' : 'Thinking'}</ContextLabel>
        </SensorRow>
      ),
      trailing: (
        <CompactText>
          <TickingTime source={{ kind: 'elapsed', since: startedAt }} />
        </CompactText>
      ),
      bottom: (
        <ExpandedBottom gap={8}>
          <ExpandedTitle>{title}</ExpandedTitle>
          <ExpandedSubtitle>
            {hasContent ? prompt : <ShimmerText>Thinking…</ShimmerText>}
          </ExpandedSubtitle>
          <BottomBar>
            <IslandButton onPress={onStop}>Stop</IslandButton>
          </BottomBar>
        </ExpandedBottom>
      ),
    },
  }
}

AgentActivity.displayName = 'AgentActivity'

export default AgentActivity
