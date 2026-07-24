// Probe which specific URIs the SLAS reference client HAS registered.
// A 303 response body says "code_challenge length must be 43 to 128" =
// redirect_uri passed validation, only the fake code_challenge got rejected.
const https = require('https')

const SLAS_HOST = 'xfdy2axw.api.commercecloud.salesforce.com'
const CLIENT_ID = '44cfcf31-d64d-4227-9cce-1d9b0716c321'
const ORG = 'f_ecom_aaia_prd'
const SITE = 'RefArch'
const CODE_CHALLENGE = 'abc123def456ghi789jkl012mno345pq'

const uris = [
    'http://localhost:3000/callback',
    'https://localhost:3000/callback',
    'http://localhost/callback',
    'https://localhost/callback',
    'http://127.0.0.1:3000/callback',
    'https://scaffold-pwa.mobify-storefront.com/callback',
    'https://storefront.mobify-storefront.com/callback',
    'https://any.mobify-storefront.com/callback',
    'https://x.mobify-storefront.com/callback',
    // wildcard hosts we should try
    'https://my-b2c-storefront.loca.lt/callback',
    // no path variants
    'http://localhost:3000',
    'http://localhost:3000/'
]

function probe(redirect_uri) {
    const path =
        `/shopper/auth/v1/organizations/${ORG}/oauth2/authorize` +
        `?redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&response_type=code&client_id=${CLIENT_ID}` +
        `&hint=guest&channel_id=${SITE}&code_challenge=${CODE_CHALLENGE}`
    return new Promise((resolve) => {
        const req = https.request(
            {host: SLAS_HOST, path, method: 'GET', headers: {Accept: 'application/json'}},
            (res) => {
                let body = ''
                res.on('data', (c) => (body += c))
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        location: res.headers.location || '',
                        body: body.slice(0, 200).replace(/\s+/g, ' ')
                    })
                )
            }
        )
        req.on('error', (e) => resolve({status: 0, body: e.message, location: ''}))
        req.end()
    })
}

;(async () => {
    for (const u of uris) {
        const r = await probe(u)
        const passed = r.status >= 300 && r.status < 400
        const tag = passed ? 'REGISTERED' : r.body.includes('redirect_uri') ? 'no        ' : '?         '
        console.log(`${tag}  ${String(r.status).padEnd(3)}  ${u.padEnd(55)}  ${r.body || r.location}`)
    }
})()
