import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { LegalPage, legalPage } from './Legal.tsx'
import './tokens.css'
import './styles.css'

const legal = legalPage(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{legal ? <LegalPage page={legal} /> : <App />}</StrictMode>,
)
