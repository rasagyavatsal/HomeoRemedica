/** Run from the repository root with `npm start`. */

import { serve } from '@hono/node-server'

import { createApp } from './app.ts'

const hostname = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 8000)

const server = serve({ fetch: createApp().fetch, hostname, port }, (info) => {
  console.log(`HomeoRemedica API: http://${hostname}:${info.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)))
}
