import { createRouter, RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'

import DynamicIsland from '@/components/dynamic-island'

import './global.css'
import { routeTree } from './routeTree.gen'
import {
  applyAccent,
  applyTheme,
  getStoredAvatarColor,
  getStoredTheme,
} from './utils/theme'

// Applied before the first render so the window never flashes the wrong theme.
applyTheme(getStoredTheme())
applyAccent(getStoredAvatarColor())

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Assigned in `vite.config.ts`.
if (typeof window !== 'undefined') {
  window.__appVersion = __appVersion
  window.__envMode = __envMode
}

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <DynamicIsland>
      <RouterProvider router={router} />
    </DynamicIsland>,
  )
}
