import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Browsers change a focused number input's value when the mouse wheel moves
// over it, which silently edits prices/stock while someone is just scrolling
// the page. Blurring the input first stops the change and lets the page keep
// scrolling normally. One listener covers every number input in the app.
document.addEventListener(
  'wheel',
  (event) => {
    const input = event.target
    if (input instanceof HTMLInputElement && input.type === 'number' && input === document.activeElement) {
      input.blur()
    }
  },
  { passive: true },
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
