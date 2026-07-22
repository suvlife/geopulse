import React from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <pre style={{ color: '#ff6b6b', background: '#0a0e1a', padding: 20, fontSize: 13, whiteSpace: 'pre-wrap', minHeight: '100vh' }}>
          {String(this.state.error.stack || this.state.error)}
        </pre>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
)
