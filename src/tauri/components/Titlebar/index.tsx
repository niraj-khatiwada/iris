/**
 * The drag strip under the macOS traffic lights. It sits below the island, which is the only
 * thing the app draws at the top centre of the window.
 */
function Titlebar() {
  return (
    <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-40 h-10" />
  )
}

Titlebar.displayName = 'Titlebar'

export default Titlebar
