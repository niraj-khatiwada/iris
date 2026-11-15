import { createRootRoute, Outlet } from '@tanstack/react-router'

import UIProvider from '@/providers/UIProvider'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <UIProvider>
      <Outlet />
    </UIProvider>
  )
}
