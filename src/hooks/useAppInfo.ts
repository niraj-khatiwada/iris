import { useEffect, useState } from 'react'

import { getAppInfo } from '@/tauri/commands/app'
import type { AppInfo } from '@/types/app'
import { isTauri } from '@/utils/tauri'

const browserInfo: AppInfo = {
  name: 'Iris',
  version: __appVersion,
  identifier: 'com.iris.app',
  platform: 'browser',
  arch: '—',
}

export function useAppInfo() {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    if (!isTauri()) {
      setInfo(browserInfo)
      return
    }

    getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])

  return info
}
