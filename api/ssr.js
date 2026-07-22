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
const crypto = require('crypto')
const fs = require('fs')

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

// --- Static asset serving for /mobify/bundle/<BUNDLE_ID>/* ------------------
// pwa-kit-runtime's RemoteServerFactory._addStaticAssetServing is a no-op
// (comment: "Handled by the CDN on remote") because MRT has an eCDN in front.
// On Vercel there is no such CDN, so client bundles, images, and the loadable
// stats file all 404 unless we serve them ourselves. This handler strips the
// /mobify/bundle/<bundleId>/ prefix and streams the file from build/.
const BUILD_DIR = path.resolve(process.cwd(), 'build')
const BUNDLE_URL_RE = /^\/mobify\/bundle\/[^/]+\/(.+?)(\?.*)?$/
const MIME_TYPES = {
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf'
}

function serveBundleAsset(req, res, relativePath) {
    const filePath = path.join(BUILD_DIR, relativePath)
    // Reject any resolved path that escapes BUILD_DIR (path-traversal guard).
    if (!filePath.startsWith(BUILD_DIR + path.sep) && filePath !== BUILD_DIR) {
        res.statusCode = 403
        return res.end('Forbidden')
    }
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.statusCode = 404
            return res.end('Not Found')
        }
        const mime = MIME_TYPES[path.extname(filePath).toLowerCase()]
        if (mime) res.setHeader('Content-Type', mime)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.setHeader('Content-Length', String(stats.size))
        fs.createReadStream(filePath).pipe(res)
    })
}
// ---------------------------------------------------------------------------

// pwa-kit-runtime's _setRequestId middleware (build-remote-server.js:507) expects
// an `x-correlation-id` or `x-apigateway-event` request header — provided by AWS
// API Gateway in an MRT deployment. Vercel (and any other host) sends neither, so
// res.locals.requestId stays undefined and CorrelationIdProvider crashes with
// "TypeError: correlationId is not a function". We must inject the header BEFORE
// the Express app processes the request, because _setRequestId is mounted by
// pwa-kit-runtime before our `customizeApp` callback runs.
function handler(req, res) {
    // Serve /mobify/bundle/<id>/* directly from build/ before Express sees it,
    // otherwise the SSR catch-all in overrides/app/ssr.js returns HTML for JS/img.
    const bundleMatch = req.url && req.url.match(BUNDLE_URL_RE)
    if (bundleMatch) {
        return serveBundleAsset(req, res, bundleMatch[1])
    }

    if (!req.headers['x-correlation-id']) {
        req.headers['x-correlation-id'] = crypto.randomUUID()
    }
    return app(req, res)
}

// Expose the raw Express app too, so local dev harnesses (scripts/vercel-local.js)
// can wrap it in http.createServer for a faithful reproduction of the Vercel path.
handler.app = app

// Vercel's Node runtime invokes the default export as `(req, res) => void`.
module.exports = handler
