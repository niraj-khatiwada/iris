import ReactDOM from 'react-dom/client'

import { applyTheme } from '@/utils/theme'

import './global.css'
import Overlay from './ui/Overlay'

// The overlay is its own window: always dark, always transparent around the panel.
document.documentElement.dataset.window = 'overlay'
applyTheme('dark')

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(<Overlay />)
}
