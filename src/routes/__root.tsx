import { createRootRoute, Outlet } from '@tanstack/react-router'

import UIProvider from '@/providers/UIProvider'
import Titlebar from '@/tauri/components/Titlebar'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <UIProvider>
      <Titlebar />
      <Outlet />
    </UIProvider>
  )
}
