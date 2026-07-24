// Probe which redirect_uri hostnames the SLAS reference client accepts.
// Runs entirely outside the workspace app; no dependency on the built server.

const https = require('https')

const SLAS_HOST = 'xfdy2axw.api.commercecloud.salesforce.com'
const CLIENT_ID = '44cfcf31-d64d-4227-9cce-1d9b0716c321'
const ORG = 'f_ecom_aaia_prd'
const SITE = 'RefArch'
const CODE_CHALLENGE = 'abc123def456ghi789jkl012mno345pq' // long enough to pass length check

const domains = [
    'b2c-beta.vercel.app',
    'my-b2c-storefront.loca.lt',
    'random-abcxyz.loca.lt',
    'test.ngrok.app',
    'test.ngrok-free.app',
    'test.ngrok.io',
    'test.trycloudflare.com',
    'test.pages.dev',
    'test.netlify.app',
    'test.fly.dev',
    'test.mobify-storefront.com',
    'scaffold-pwa.mobify-storefront.com',
    'localhost:3000',
    '127.0.0.1:3000',
    'test.up.railway.app',
    'test.onrender.com',
    'test.deno.dev',
    'test.workers.dev'
]

function probe(domain, extraHeaders = {}) {
    const redirect = encodeURIComponent(`https://${domain}/callback`)
    const path =
        `/shopper/auth/v1/organizations/${ORG}/oauth2/authorize` +
        `?redirect_uri=${redirect}` +
        `&response_type=code&client_id=${CLIENT_ID}` +
        `&hint=guest&channel_id=${SITE}&code_challenge=${CODE_CHALLENGE}`
    return new Promise((resolve) => {
        const req = https.request(
            {
                host: SLAS_HOST,
                path,
                method: 'GET',
                headers: {Accept: 'application/json', ...extraHeaders}
            },
            (res) => {
                let body = ''
                res.on('data', (c) => (body += c))
                res.on('end', () =>
                    resolve({
                        domain,
                        status: res.statusCode,
                        location: res.headers.location || '',
                        body: body.slice(0, 240).replace(/\s+/g, ' ')
                    })
                )
            }
        )
        req.on('error', (e) => resolve({domain, status: 0, body: e.message, location: ''}))
        req.end()
    })
}

;(async () => {
    const headerVariants = [
        {label: 'no-origin', headers: {}},
        {label: 'origin=self', headers: {Origin: `https://${SLAS_HOST}`}},
        {label: 'origin=vercel', headers: {Origin: 'https://b2c-beta.vercel.app'}},
        {label: 'referer=self', headers: {Referer: `https://${SLAS_HOST}/`}},
        {
            label: 'origin+referer=self',
            headers: {Origin: `https://${SLAS_HOST}`, Referer: `https://${SLAS_HOST}/`}
        }
    ]
    const targets = ['b2c-beta.vercel.app', 'my-b2c-storefront.loca.lt']
    for (const t of targets) {
        console.log(`\n--- redirect_uri host: ${t} ---`)
        for (const v of headerVariants) {
            const r = await probe(t, v.headers)
            const accepted = r.status >= 300 && r.status < 400
            const tag = accepted ? 'ALLOW' : r.body.includes('redirect_uri') ? 'DENY ' : '?    '
            console.log(`${tag}  ${String(r.status).padEnd(3)}  ${v.label.padEnd(22)}  ${r.body.slice(0, 140) || r.location}`)
        }
    }
})()
