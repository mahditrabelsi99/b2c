/* eslint-disable no-console */
/**
 * Dumps the full public catalog from Salesforce SCAPI into
 *   exports/catalog.csv   (flat table, one row per master product)
 *   exports/catalog.json  (same rows as JSON)
 *   exports/variants.csv  (one row per variant SKU)
 *   exports/categories.csv (category tree, one row per node)
 *
 * Uses a SLAS public-client PKCE guest login. No credentials required.
 * Config is read from config/default.js (organizationId, shortCode, siteId, clientId).
 *
 * Usage:  node scripts/dump-catalog.js
 */
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const cfg = require('../config/default.js').app.commerceAPI.parameters
const ORG = cfg.organizationId
const SHORT = cfg.shortCode
const SITE = cfg.siteId
const CLIENT_ID = cfg.clientId
const LOCALE = process.env.LOCALE || 'en-US'
const CURRENCY = process.env.CURRENCY || 'USD'
// One of the URIs registered on the public SLAS client
const REDIRECT_URI = 'http://localhost:3000/callback'

const SLAS_HOST = `${SHORT}.api.commercecloud.salesforce.com`
const SCAPI_HOST = SLAS_HOST // same host for both

function req(host, method, pathAndQuery, headers = {}, body) {
    return new Promise((resolve, reject) => {
        const r = https.request(
            {host, method, path: pathAndQuery, headers},
            (res) => {
                const chunks = []
                res.on('data', (c) => chunks.push(c))
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8')
                    })
                })
            }
        )
        r.on('error', reject)
        if (body) r.write(body)
        r.end()
    })
}

const b64url = (buf) =>
    buf
        .toString('base64')
        .replace(/=+$/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')

async function slasGuestLogin() {
    const codeVerifier = b64url(crypto.randomBytes(32))
    const codeChallenge = b64url(
        crypto.createHash('sha256').update(codeVerifier).digest()
    )
    const usid = crypto.randomUUID()

    // 1) authorize (guest hint) — expect 303 with Location
    const q = new URLSearchParams({
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_challenge: codeChallenge,
        hint: 'guest',
        response_type: 'code',
        channel_id: SITE,
        usid
    }).toString()
    const authz = await req(
        SLAS_HOST,
        'GET',
        `/shopper/auth/v1/organizations/${ORG}/oauth2/authorize?${q}`
    )
    if (authz.status !== 303 && authz.status !== 302) {
        throw new Error(
            `SLAS authorize failed: ${authz.status}\n${authz.body.slice(0, 400)}`
        )
    }
    const loc = authz.headers.location || ''
    const params = new URL(loc, 'http://x').searchParams
    const code = params.get('code')
    const returnedUsid = params.get('usid') || usid
    if (!code) throw new Error(`No code in Location: ${loc}`)

    // 2) exchange code for token — public client PKCE flow
    const form = new URLSearchParams({
        grant_type: 'authorization_code_pkce',
        code,
        code_verifier: codeVerifier,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        channel_id: SITE,
        usid: returnedUsid
    }).toString()
    const tok = await req(
        SLAS_HOST,
        'POST',
        `/shopper/auth/v1/organizations/${ORG}/oauth2/token`,
        {
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': Buffer.byteLength(form)
        },
        form
    )
    if (tok.status !== 200) {
        throw new Error(
            `SLAS token failed: ${tok.status}\n${tok.body.slice(0, 400)}`
        )
    }
    return JSON.parse(tok.body).access_token
}

async function scapi(pathAndQuery, token) {
    const r = await req(SCAPI_HOST, 'GET', pathAndQuery, {
        authorization: 'Bearer ' + token,
        accept: 'application/json'
    })
    if (r.status !== 200) {
        return {err: r.status, body: r.body}
    }
    try {
        return {data: JSON.parse(r.body)}
    } catch (e) {
        return {err: 'parse', body: r.body}
    }
}

function csvEscape(v) {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function toCsv(rows) {
    if (rows.length === 0) return ''
    const cols = Object.keys(rows[0])
    return [cols.join(',')]
        .concat(rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')))
        .join('\n')
}
function flattenCategoriesForCsv(node, parentPath = '', acc = []) {
    if (node.id) {
        const full = parentPath ? parentPath + ' > ' + node.name : node.name || node.id
        acc.push({
            id: node.id,
            name: node.name || '',
            path: full,
            parentId: node.parentCategoryId || '',
            level: parentPath ? parentPath.split(' > ').length : 0,
            hasOnlineChildren: node.onlineSubCategoriesCount || 0,
            pageTitle: node.pageTitle || '',
            pageDescription: (node.pageDescription || '').slice(0, 500)
        })
    }
    ;(node.categories || []).forEach((c) =>
        flattenCategoriesForCsv(c, node.id && node.id !== 'root' ? (parentPath ? parentPath + ' > ' + node.name : node.name) : parentPath, acc)
    )
    return acc
}
function flattenProduct(p) {
    const img =
        (p.imageGroups || []).find((g) => g.viewType === 'large') ||
        (p.imageGroups || [])[0]
    const primaryImg =
        img && img.images && img.images[0]
            ? img.images[0].disBaseLink || img.images[0].link
            : ''
    const va = (p.variationAttributes || [])
        .map(
            (a) =>
                `${a.id}=${(a.values || [])
                    .map((v) => v.name || v.value)
                    .join('|')}`
        )
        .join('; ')
    const typeStr = p.type
        ? Object.keys(p.type)
              .filter((k) => p.type[k])
              .join(',')
        : ''
    return {
        id: p.id,
        name: p.name || '',
        brand: p.brand || '',
        manufacturer: p.manufacturerName || '',
        upc: p.upc || '',
        ean: p.ean || '',
        type: typeStr,
        currency: p.currency || '',
        price: p.price != null ? p.price : '',
        priceMin: p.priceRanges && p.priceRanges[0] ? p.priceRanges[0].minPrice : '',
        priceMax: p.priceRanges && p.priceRanges[0] ? p.priceRanges[0].maxPrice : '',
        orderable: p.inventory ? p.inventory.orderable : '',
        ats: p.inventory ? p.inventory.ats : '',
        stockLevel: p.inventory ? p.inventory.stockLevel : '',
        primaryCategoryId: p.primaryCategoryId || '',
        shortDescription: (p.shortDescription || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500),
        longDescription: (p.longDescription || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 2000),
        pageTitle: p.pageTitle || '',
        pageDescription: (p.pageDescription || '').slice(0, 500),
        pageKeywords: p.pageKeywords || '',
        variationAttributes: va,
        variantCount: (p.variants || []).length,
        imageCount: (p.imageGroups || []).reduce(
            (s, g) => s + (g.images || []).length,
            0
        ),
        primaryImage: primaryImg || '',
        slug: p.c_slug || ''
    }
}
function flattenVariants(p) {
    return (p.variants || []).map((v) => ({
        masterId: p.id,
        masterName: p.name || '',
        variantId: v.productId,
        orderable: v.orderable,
        price: v.price,
        currency: v.currency || p.currency || '',
        ...Object.fromEntries(
            Object.entries(v.variationValues || {}).map(([k, val]) => [
                'attr_' + k,
                val
            ])
        )
    }))
}

async function main() {
    console.log(`Auth: SLAS guest login on ${SLAS_HOST} for site ${SITE}...`)
    const token = await slasGuestLogin()
    console.log('Got token (first 20 chars):', token.slice(0, 20) + '...')

    console.log('Fetching category tree (levels=4)...')
    const catQ = new URLSearchParams({
        levels: '4',
        locale: LOCALE,
        siteId: SITE
    }).toString()
    const cats = await scapi(
        `/product/shopper-products/v1/organizations/${ORG}/categories/root?${catQ}`,
        token
    )
    if (cats.err) throw new Error(`Categories failed: ${cats.err} ${cats.body}`)
    const catRows = flattenCategoriesForCsv(cats.data)
    console.log(`Categories: ${catRows.length}`)

    const catIds = catRows.map((r) => r.id).filter((x) => x && x !== 'root')

    console.log('Enumerating master products across all categories...')
    const seen = new Set()
    for (const cid of catIds) {
        for (let offset = 0, i = 0; i < 20; i++) {
            const q = new URLSearchParams({
                siteId: SITE,
                locale: LOCALE,
                currency: CURRENCY,
                limit: '200',
                offset: String(offset)
            })
            q.append('refine', 'cgid=' + cid)
            q.append('refine', 'htype=master')
            const r = await scapi(
                `/search/shopper-search/v1/organizations/${ORG}/product-search?${q.toString()}`,
                token
            )
            if (r.err) break
            const {hits, total} = r.data
            ;(hits || []).forEach((h) => seen.add(h.productId))
            offset += 200
            if (offset >= (total || 0)) break
        }
    }
    const ids = [...seen]
    console.log(`Unique master products: ${ids.length}`)

    console.log('Fetching full product details in batches of 24...')
    const products = []
    async function fetchOne(id) {
        const q = new URLSearchParams({
            locale: LOCALE,
            siteId: SITE,
            expand:
                'availability,promotions,options,images,prices,variations,bundled_products'
        }).toString()
        const r = await scapi(
            `/product/shopper-products/v1/organizations/${ORG}/products/${encodeURIComponent(id)}?${q}`,
            token
        )
        return r.err ? null : r.data
    }
    async function fetchBatch(batch) {
        const q = new URLSearchParams({
            ids: batch.join(','),
            locale: LOCALE,
            siteId: SITE,
            expand:
                'availability,promotions,options,images,prices,variations,bundled_products'
        }).toString()
        const r = await scapi(
            `/product/shopper-products/v1/organizations/${ORG}/products?${q}`,
            token
        )
        if (r.err) {
            // Fall back to single-product fetches so one bad ID can't kill the batch
            const out = []
            for (const id of batch) {
                const p = await fetchOne(id)
                if (p) out.push(p)
            }
            return out
        }
        return r.data.data || []
    }
    for (let i = 0; i < ids.length; i += 24) {
        const batch = ids.slice(i, i + 24)
        const got = await fetchBatch(batch)
        products.push(...got)
        process.stdout.write(
            `\r  ${Math.min(i + 24, ids.length)}/${ids.length}  (kept ${products.length})`
        )
    }
    console.log(`\nFetched ${products.length} products`)

    const productRows = products.map(flattenProduct)
    const variantRows = products.flatMap(flattenVariants)

    const outDir = path.join(__dirname, '..', 'exports')
    fs.mkdirSync(outDir, {recursive: true})
    const write = (name, data) => {
        const p = path.join(outDir, name)
        fs.writeFileSync(p, data, 'utf8')
        console.log(`  wrote ${p}  (${data.length.toLocaleString()} bytes)`)
    }
    write('catalog.csv', toCsv(productRows))
    write('catalog.json', JSON.stringify(productRows, null, 2))
    write('variants.csv', toCsv(variantRows))
    write('categories.csv', toCsv(catRows))

    // Raw SCAPI payloads, one product per line (JSON Lines) — no flattening, no truncation
    const jsonl = products.map((p) => JSON.stringify(p)).join('\n') + '\n'
    write('catalog.raw.jsonl', jsonl)

    // Raw category tree (full nested structure as returned by SCAPI)
    write('categories.raw.json', JSON.stringify(cats.data, null, 2))

    console.log('Done.')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
