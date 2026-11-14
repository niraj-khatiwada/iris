import ReactDOM from 'react-dom/client'

import './global.css'

// The full-screen canvas is transparent and click-through. It exists for future screen
// annotations and agent output; nothing is drawn on it yet.
document.documentElement.dataset.window = 'canvas'

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(<div className="h-full w-full" />)
}
