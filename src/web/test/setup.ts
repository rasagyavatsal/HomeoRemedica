import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

// jsdom has no modal rendering; keep the native open state and its focus on the first control.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true
  this.querySelector<HTMLElement>('button, input, select, textarea, a[href]')?.focus()
}
HTMLDialogElement.prototype.close = function () { this.open = false }
window.scrollTo = () => {}

// jsdom lays nothing out, so there are no sizes to observe.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
