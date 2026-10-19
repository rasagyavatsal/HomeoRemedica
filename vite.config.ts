import { getRequestListener } from '@hono/node-server'
import react from '@vitejs/plugin-react'
import { type Plugin, isRunnableDevEnvironment } from 'vite'
import { defineConfig } from 'vitest/config'

type AppModule = typeof import('./src/server/app.ts')

/** Serve /api from the Vite dev server, loading the API through Vite so server edits reload. */
function api(): Plugin {
  return {
    name: 'homeoremedica-api',
    apply: 'serve',
    configureServer(server) {
      const environment = server.environments.ssr
      if (!environment || !isRunnableDevEnvironment(environment)) {
        throw new Error('the Vite SSR environment cannot run the API')
      }
      // Keep one app per module version: an edit yields a new module and a fresh app.
      const listeners = new WeakMap<AppModule, ReturnType<typeof getRequestListener>>()
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api' && !req.url?.startsWith('/api/')) return next()
        try {
          const module = await environment.runner.import<AppModule>('/src/server/app.ts')
          let listener = listeners.get(module)
          if (!listener) {
            listener = getRequestListener(module.createApp(module.productionDependencies(), { webDist: null }).fetch)
            listeners.set(module, listener)
          }
          await listener(req, res)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), api()],
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: { name: 'server', include: ['tests/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'web',
          include: ['src/web/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/web/test/setup.ts'],
        },
      },
    ],
  },
})
