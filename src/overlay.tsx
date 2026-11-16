import ReactDOM from 'react-dom/client'

import { watchSystemTheme } from '@/utils/theme'

import './global.css'
import Overlay from './ui/Overlay'

// The overlay is its own window: it follows the macOS appearance, not the in-app theme setting,
// and stays transparent around the panel.
document.documentElement.dataset.window = 'overlay'
watchSystemTheme()

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(<Overlay />)
}
