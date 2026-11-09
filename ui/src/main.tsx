import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { applyStoredTheme } from './lib/theme'
import './styles/index.css'

applyStoredTheme()

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    return this.state.error ? <main className="startup-state"><h1>The workspace couldn’t open</h1><p>Your chat history is still on disk. Reload to reconnect.</p><button type="button" className="button" onClick={() => window.location.reload()}>Reload workspace</button></main> : this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
