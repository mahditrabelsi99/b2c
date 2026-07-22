/*
 * Vercel serverless function entry for the PWA Kit storefront.
 *
 * This wraps the built Express app produced by `pwa-kit-dev build`
 * (`build/ssr.js`, a Webpack CommonJS bundle) so Vercel's Node runtime
 * can invoke it as a serverless handler.
 *
 * IMPORTANT: This file is Vercel-only. The Salesforce Managed Runtime
 * (MRT) deploy path (`pwa-kit-dev push`) continues to use `build/ssr.js`
 * and its exported `get` handler directly and is unaffected by this file.
 */

'use strict'

// --- pwa-kit-runtime "remote mode" shim -------------------------------------
// pwa-kit-runtime uses process.env.AWS_LAMBDA_FUNCTION_NAME to switch between
// its RemoteServerFactory (production) and DevServerFactory (local). It also
// requires BUNDLE_ID, DEPLOY_TARGET, EXTERNAL_DOMAIN_NAME, MOBIFY_PROPERTY_ID
// in remote mode (see _validateConfiguration in build-remote-server.js).
// Providing defaults here means the app can boot on Vercel with zero dashboard
// configuration. Override any of these in the Vercel dashboard when you need
// real values (e.g. a stable EXTERNAL_DOMAIN_NAME for canonical URLs).
process.env.AWS_LAMBDA_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || 'vercel-ssr'
process.env.BUNDLE_ID = process.env.BUNDLE_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'production'
process.env.DEPLOY_TARGET = process.env.DEPLOY_TARGET || 'vercel'
process.env.EXTERNAL_DOMAIN_NAME =
    process.env.EXTERNAL_DOMAIN_NAME ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    'localhost'
process.env.MOBIFY_PROPERTY_ID = process.env.MOBIFY_PROPERTY_ID || 'demo-storefront'
// ---------------------------------------------------------------------------

const path = require('path')

// The built server bundle is CommonJS (module.exports = { app, get, handler, ... })
// and exposes the raw Express `app` we added via `export {app}` in overrides/app/ssr.js.
const built = require(path.join(process.cwd(), 'build', 'ssr.js'))

const app = built.app || (built.default && built.default.app) || built.default

if (typeof app !== 'function') {
    throw new Error(
        "api/ssr.js: could not resolve the Express `app` export from build/ssr.js. " +
            'Make sure overrides/app/ssr.js still contains `export {app}` and that ' +
            '`npm run build` has been run.'
    )
}

// Vercel's Node runtime invokes the default export as `(req, res) => void`.
// An Express app instance is itself a request listener with that signature.
module.exports = app
