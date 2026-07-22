/*
 * Local reproduction of the Vercel serverless invocation path.
 *
 * Vercel runs `api/ssr.js` under its Node runtime. This script does the same
 * thing locally: it forces pwa-kit-runtime into remote mode via env-var shims
 * (identical to what api/ssr.js sets), then boots the built Express app on
 * port 3000. Use it to reproduce Vercel-only crashes with a readable stack
 * trace, since local logs are unminified and node prints full traces.
 *
 * Usage:
 *   npm run build           # once, to produce build/ssr.js
 *   node scripts/vercel-local.js
 *   open http://localhost:3000/
 */

'use strict'

// Match the shim in api/ssr.js exactly.
process.env.AWS_LAMBDA_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || 'vercel-ssr'
process.env.BUNDLE_ID = process.env.BUNDLE_ID || 'production'
process.env.DEPLOY_TARGET = process.env.DEPLOY_TARGET || 'vercel'
process.env.EXTERNAL_DOMAIN_NAME = process.env.EXTERNAL_DOMAIN_NAME || 'localhost:3000'
process.env.MOBIFY_PROPERTY_ID = process.env.MOBIFY_PROPERTY_ID || 'demo-storefront'

const http = require('http')
const path = require('path')

// Load the SAME handler Vercel loads — including the x-correlation-id header
// injection wrapper. Do not require build/ssr.js directly here; that would
// bypass the wrapper and hide bugs that only manifest without it.
const handler = require(path.join(__dirname, '..', 'api', 'ssr.js'))

if (typeof handler !== 'function') {
    console.error('api/ssr.js did not export a function. Got:', typeof handler)
    process.exit(1)
}

const port = Number(process.env.PORT) || 3000
http.createServer(handler).listen(port, () => {
    console.log(`[vercel-local] Listening on http://localhost:${port}`)
    console.log(`[vercel-local] AWS_LAMBDA_FUNCTION_NAME = ${process.env.AWS_LAMBDA_FUNCTION_NAME}`)
    console.log(`[vercel-local] Try: curl -sSf http://localhost:${port}/ | head -50`)
})

process.on('unhandledRejection', (err) => {
    console.error('[vercel-local] unhandledRejection:', err)
})
process.on('uncaughtException', (err) => {
    console.error('[vercel-local] uncaughtException:', err)
})
