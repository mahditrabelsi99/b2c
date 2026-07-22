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
const https = require('https')

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

// --- Transparent SLAS redirect_uri rewriter ---------------------------------
// The reference SLAS API client (44cfcf31-…) only allow-lists a fixed set of
// redirect URIs: http://localhost:3000/callback, http://localhost/callback,
// http://127.0.0.1:3000/callback, and https://*.mobify-storefront.com/callback.
// The Vercel domain (e.g. https://b2c-beta.vercel.app/callback) is not among
// them and the client has no admin access to add it. Rather than block the
// demo entirely, we intercept /mobify/proxy/api/shopper/auth/* calls, swap
// the caller's real redirect_uri for a registered one on the way to SLAS,
// then swap it back on the response so the browser/SDK sees its own URL.
// This is a demo-only pattern; a proper deployment should register the real
// redirect URI with the SLAS client.
const SLAS_HOST = 'xfdy2axw.api.commercecloud.salesforce.com'
const REGISTERED_REDIRECT_ORIGIN = 'http://localhost:3000'
const SHOPPER_AUTH_PATH_RE = /^\/mobify\/proxy\/api\/(shopper\/auth\/.+?)(\?.*)?$/

function publicOrigin(req) {
    // Prefer the incoming request's own host (works for preview and prod aliases).
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host
    const forwardedProto = req.headers['x-forwarded-proto'] || 'https'
    return `${forwardedProto}://${forwardedHost}`
}

function swapRedirectUri(value, from, to) {
    if (!value || !value.startsWith(from)) return value
    return to + value.slice(from.length)
}

function proxyShopperAuth(req, res, match) {
    const origin = publicOrigin(req)
    // Rewrite the URL's query string (used by GET /authorize).
    const parsed = new URL(req.url, 'http://placeholder')
    const originalRedirect = parsed.searchParams.get('redirect_uri')
    if (originalRedirect) {
        const rewritten = swapRedirectUri(
            originalRedirect,
            origin,
            REGISTERED_REDIRECT_ORIGIN
        )
        if (rewritten !== originalRedirect) {
            parsed.searchParams.set('redirect_uri', rewritten)
        }
    }
    const outgoingPath = `/${match[1]}${parsed.search || ''}`

    // Buffer the incoming body (used by POST /token, form-urlencoded with
    // redirect_uri as one of the fields).
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
        let body = Buffer.concat(chunks)
        const ct = (req.headers['content-type'] || '').toLowerCase()
        if (body.length > 0 && ct.startsWith('application/x-www-form-urlencoded')) {
            const form = new URLSearchParams(body.toString('utf8'))
            const bodyRedirect = form.get('redirect_uri')
            if (bodyRedirect) {
                const rewritten = swapRedirectUri(
                    bodyRedirect,
                    origin,
                    REGISTERED_REDIRECT_ORIGIN
                )
                if (rewritten !== bodyRedirect) {
                    form.set('redirect_uri', rewritten)
                    body = Buffer.from(form.toString(), 'utf8')
                }
            }
        }

        const upstreamHeaders = {}
        for (const [k, v] of Object.entries(req.headers)) {
            // Hop-by-hop and identity headers must not be forwarded verbatim.
            if (
                k === 'host' ||
                k === 'connection' ||
                k === 'content-length' ||
                k === 'x-forwarded-for' ||
                k === 'x-forwarded-host' ||
                k === 'x-forwarded-proto' ||
                k === 'x-vercel-id' ||
                k === 'x-vercel-deployment-url' ||
                k === 'x-vercel-forwarded-for'
            ) {
                continue
            }
            upstreamHeaders[k] = v
        }
        upstreamHeaders['host'] = SLAS_HOST
        if (body.length > 0) upstreamHeaders['content-length'] = String(body.length)

        const upstream = https.request(
            {host: SLAS_HOST, method: req.method, path: outgoingPath, headers: upstreamHeaders},
            (upstreamRes) => {
                const responseHeaders = {...upstreamRes.headers}
                // Swap the Location header back so the browser/SDK sees its own domain.
                if (responseHeaders.location) {
                    responseHeaders.location = swapRedirectUri(
                        responseHeaders.location,
                        REGISTERED_REDIRECT_ORIGIN,
                        origin
                    )
                }
                // Do not forward the upstream Set-Cookie Domain attribute; leave the
                // cookie host-only so it binds to the caller's own domain.
                if (responseHeaders['set-cookie']) {
                    responseHeaders['set-cookie'] = []
                        .concat(responseHeaders['set-cookie'])
                        .map((c) => c.replace(/;\s*Domain=[^;]+/i, ''))
                }
                res.writeHead(upstreamRes.statusCode || 502, responseHeaders)
                upstreamRes.pipe(res)
            }
        )
        upstream.on('error', (err) => {
            if (!res.headersSent) {
                res.statusCode = 502
                res.setHeader('Content-Type', 'text/plain')
            }
            res.end(`Bad gateway to SLAS: ${err.message}`)
        })
        if (body.length > 0) upstream.write(body)
        upstream.end()
    })
    req.on('error', (err) => {
        if (!res.headersSent) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'text/plain')
        }
        res.end(`Bad request: ${err.message}`)
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

    // Transparently rewrite redirect_uri on SLAS auth calls; see block above.
    const authMatch = req.url && req.url.match(SHOPPER_AUTH_PATH_RE)
    if (authMatch) {
        return proxyShopperAuth(req, res, authMatch)
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
