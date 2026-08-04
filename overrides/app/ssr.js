/*
 * Copyright (c) 2023, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

'use strict'

import crypto from 'crypto'
import express from 'express'
import helmet from 'helmet'
import {createRemoteJWKSet as joseCreateRemoteJWKSet, jwtVerify, decodeJwt} from 'jose'
import path from 'path'
import {getRuntime} from '@salesforce/pwa-kit-runtime/ssr/server/express'
import {defaultPwaKitSecurityHeaders} from '@salesforce/pwa-kit-runtime/utils/middleware'
import {getConfig} from '@salesforce/pwa-kit-runtime/utils/ssr-config'
import {getAppOrigin} from '@salesforce/pwa-kit-react-sdk/utils/url'

const config = getConfig()

const options = {
    // The build directory (an absolute path)
    buildDir: path.resolve(process.cwd(), 'build'),

    // The cache time for SSR'd pages (defaults to 600 seconds)
    defaultCacheTimeSeconds: 600,

    // The contents of the config file for the current environment
    mobify: config,

    // The port that the local dev server listens on
    port: 3000,

    // The protocol on which the development Express app listens.
    // Set DEV_SERVER_PROTOCOL to 'https' for HTTPS; defaults to 'http' when unset.
    // Note that http://localhost is treated as a secure context for development,
    // except by Safari.
    protocol: process.env.DEV_SERVER_PROTOCOL || 'http',

    // Optional. Path to SSL certificate (.pem) for HTTPS development. Typically a
    // self-signed cert for localhost; set DEV_SERVER_SSL_FILE_PATH when using https.
    sslFilePath: process.env.DEV_SERVER_SSL_FILE_PATH,

    // Option for whether to set up a special endpoint for handling
    // private SLAS clients
    // Set this to false if using a SLAS public client
    // When setting this to true, make sure to also set the PWA_KIT_SLAS_CLIENT_SECRET
    // environment variable as this endpoint will return HTTP 501 if it is not set
    useSLASPrivateClient: false,

    // To extend the SLAS private-client proxy allow-list, supply
    // `slasPrivateClientAllowList`. See the built-in list in pwa-kit-runtime
    // for the entry shape. A startup warning is logged whenever a custom list
    // is in use.

    // If this is enabled, any HTTP header that has a non ASCII value will be URI encoded
    // If there any HTTP headers that have been encoded, an additional header will be
    // passed, `x-encoded-headers`, containing a comma separated list
    // of the keys of headers that have been encoded
    // There may be a slight performance loss with requests/responses with large number
    // of headers as we loop through all the headers to verify ASCII vs non ASCII
    encodeNonAsciiHttpHeaders: true,

    // Cookie handling configuration for security and session management.
    //
    // SECURITY CONSIDERATIONS:
    // - Set to 'false' in production for enhanced security (prevents XSS attacks via client-side cookie access)
    // - Set to 'true' only in development when testing SFCC session integration or Hybrid Proxy functionality
    // - When false: cookies are stripped from requests and cannot be set in responses (server-only cookies)
    // - When true: allows client-side JavaScript access to cookies (development/testing only)
    //
    // HYBRID PROXY REQUIREMENT:
    // - Hybrid Proxy requires this to be 'true' for SFCC session management to work properly
    // - Only enable Hybrid Proxy in development environments, never in production
    localAllowCookies: false,

    // Hybrid Proxy configuration for local development and MRT to ODS connection testing.
    //
    // IMPORTANT SECURITY NOTES:
    // - This should ONLY be used for local development and testing
    // - NEVER enable in production - use eCDN rules instead for production routing
    // - When enabled, localAllowCookies must be set to 'true' for SFCC sessions to work
    // - Production deployments should use eCDN to direct requests to SFCC instances
    //
    // REFERENCE: https://developer.salesforce.com/docs/commerce/commerce-api/guide/hybrid-authentication.html
    hybridProxy: {
        // If this is enabled, the Hybrid Proxy will be enabled to proxy requests to the SFCC instance.
        // IMPORTANT: This should only be used for local development. For production, this should be disabled and use eCDN to direct requests to the SFCC instance.
        // Refer to https://developer.salesforce.com/docs/commerce/commerce-api/guide/hybrid-authentication.html for more details.
        enabled: false,

        // The origin of the SFCC instance (i.e. the instance that is being proxied to which hosts the storefront).
        sfccOrigin: 'https://production-sitegenesis-dw.demandware.net',

        // The MRT rules to apply to the hybrid proxy.
        // These rules determine which requests are handled by PWA Kit (MRT) vs proxied to SFCC. The same rules should be used in the eCDN rules for the same requests.
        // Paths excluded from the rules will be re-directed to SFCC instance. In the following example, the Cart and checkout pages are excluded from the rules.
        // Refer to the following links for more details:
        // * https://developer.salesforce.com/docs/commerce/commerce-api/references/cdn-api-process-apis?meta=MrtRules
        // * https://developer.salesforce.com/docs/commerce/commerce-api/guide/ecdn-rules-for-phased-headless-rollout.html
        routingRules: [
            // Hybrid Proxy Routing Rules
            // Purpose: Route requests between PWA Kit (React) and SFCC (traditional storefront)
            // Configuration: site: 'none', locale: 'none' → URLs like /category/womens (no prefixes)
            // Logic: URLs matching these patterns → PWA Kit handles them
            //        URLs NOT matching → proxied to SFCC (e.g., /cart, /checkout)
            'http.request.uri.path eq "/" or http.request.uri.path matches "^/callback" or http.request.uri.path matches "^/mobify" or http.request.uri.path matches "^/worker.js" or http.request.uri.path matches "^/login" or http.request.uri.path matches "^/reset-password" or http.request.uri.path matches "^/registration" or http.request.uri.path matches "^/account" or http.request.uri.path matches "^/account/orders" or http.request.uri.path matches "^/account/orders/(\\\\w+)" or http.request.uri.path matches "^/account/wishlist" or http.request.uri.path matches "^/product/(\\\\w+)" or http.request.uri.path matches "^/search" or http.request.uri.path matches "^/category/(\\\\w+)" or http.request.uri.path matches "^/store-locator" or http.request.uri.path matches "^/social-callback" or http.request.uri.path matches "^/passwordless-login-callback" or http.request.uri.path matches "^/passwordless-login-landing" or http.request.uri.path matches "^/reset-password-callback" or http.request.uri.path matches "^/reset-password-landing"'
        ]
    }
}

const runtime = getRuntime()

/**
 * Tokens are valid for 20 minutes. We store it at the top level scope to reuse
 * it during the lambda invocation. We'll refresh it after 15 minutes.
 */
let marketingCloudToken = ''
let marketingCloudTokenExpiration = new Date()

/**
 * Generates a unique ID for the email message.
 *
 * @return {string} A unique ID for the email message.
 */
function generateUniqueId() {
    return crypto.randomBytes(16).toString('hex')
}

/**
 * Sends an email to a specified contact using the Marketing Cloud API. The template email must have a
 * `%%magic-link%%` personalization string inserted.
 * https://help.salesforce.com/s/articleView?id=mktg.mc_es_personalization_strings.htm&type=5
 *
 * @param {string} email - The email address of the contact to whom the email will be sent.
 * @param {string} templateId - The ID of the email template to be used for the email.
 * @param {string} magicLink - The magic link to be included in the email.
 *
 * @return {Promise<object>} A promise that resolves to the response object received from the Marketing Cloud API.
 */
async function sendMarketingCloudEmail(emailId, marketingCloudConfig) {
    // Refresh token if expired
    if (new Date() > marketingCloudTokenExpiration) {
        const {clientId, clientSecret, subdomain} = marketingCloudConfig
        const tokenUrl = `https://${subdomain}.auth.marketingcloudapis.com/v2/token`
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret
            })
        })

        if (!tokenResponse.ok)
            throw new Error(
                'Failed to fetch Marketing Cloud access token. Check your Marketing Cloud credentials and try again.'
            )

        const {access_token} = await tokenResponse.json()
        marketingCloudToken = access_token
        // Set expiration to 15 mins
        marketingCloudTokenExpiration = new Date(Date.now() + 15 * 60 * 1000)
    }

    // Send the email
    const emailUrl = `https://${
        marketingCloudConfig.subdomain
    }.rest.marketingcloudapis.com/messaging/v1/email/messages/${generateUniqueId()}`
    const emailResponse = await fetch(emailUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${marketingCloudToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            definitionKey: marketingCloudConfig.templateId,
            recipient: {
                contactKey: emailId,
                to: emailId,
                attributes: {'magic-link': marketingCloudConfig.magicLink}
            }
        })
    })

    if (!emailResponse.ok) throw new Error('Failed to send email to Marketing Cloud')

    return await emailResponse.json()
}

/**
 * Generates a unique ID, constructs an email message URL, and sends the email to the specified contact
 * using the Marketing Cloud API.
 *
 * @param {string} email - The email address of the contact to whom the email will be sent.
 * @param {string} templateId - The ID of the email template to be used for the email.
 * @param {string} magicLink - The magic link to be included in the email.
 *
 * @return {Promise<object>} A promise that resolves to the response object received from the Marketing Cloud API.
 */
export async function emailLink(emailId, templateId, magicLink) {
    if (!process.env.MARKETING_CLOUD_CLIENT_ID) {
        console.warn('MARKETING_CLOUD_CLIENT_ID is not set in the environment variables.')
    }

    if (!process.env.MARKETING_CLOUD_CLIENT_SECRET) {
        console.warn(' MARKETING_CLOUD_CLIENT_SECRET is not set in the environment variables.')
    }

    if (!process.env.MARKETING_CLOUD_SUBDOMAIN) {
        console.warn('MARKETING_CLOUD_SUBDOMAIN is not set in the environment variables.')
    }

    const marketingCloudConfig = {
        clientId: process.env.MARKETING_CLOUD_CLIENT_ID,
        clientSecret: process.env.MARKETING_CLOUD_CLIENT_SECRET,
        magicLink: magicLink,
        subdomain: process.env.MARKETING_CLOUD_SUBDOMAIN,
        templateId: templateId
    }
    return await sendMarketingCloudEmail(emailId, marketingCloudConfig)
}

const resetPasswordCallback =
    config.app.login?.resetPassword?.callbackURI || '/reset-password-callback'
const passwordlessLoginCallback =
    config.app.login?.passwordless?.callbackURI || '/passwordless-login-callback'

// Reusable function to handle sending a magic link email.
// By default, this implementation uses Marketing Cloud.
async function sendMagicLinkEmail(req, res, landingPath, emailTemplate, redirectUrl) {
    // Extract the base URL from the request
    const base = req.protocol + '://' + req.get('host')

    // Extract the email_id and token from the request body
    const {email_id, token} = req.body

    // Construct the magic link URL
    let magicLink = `${base}${landingPath}?token=${encodeURIComponent(token)}`
    if (landingPath === config.app.login?.resetPassword?.landingPath) {
        // Add email query parameter for reset password flow
        magicLink += `&email=${encodeURIComponent(email_id)}`
    }
    if (landingPath === config.app.login?.passwordless?.landingPath && redirectUrl) {
        magicLink += `&redirect_url=${encodeURIComponent(redirectUrl)}`
    }

    // Call the emailLink function to send an email with the magic link using Marketing Cloud
    const emailLinkResponse = await emailLink(email_id, emailTemplate, magicLink)

    // Send the response
    res.send(emailLinkResponse)
}

const CLAIM = {
    ISSUER: 'iss'
}

const DELIMITER = {
    ISSUER: '/'
}

const throwSlasTokenValidationError = (message, code) => {
    throw new Error(`SLAS Token Validation Error: ${message}`, code)
}

export const createRemoteJWKSet = (tenantId) => {
    const appOrigin = getAppOrigin()
    const {app: appConfig} = getConfig()
    const shortCode = appConfig.commerceAPI.parameters.shortCode
    const configTenantId = appConfig.commerceAPI.parameters.organizationId.replace(/^f_ecom_/, '')
    if (tenantId !== configTenantId) {
        throw new Error(
            `The tenant ID in your PWA Kit configuration ("${configTenantId}") does not match the tenant ID in the SLAS callback token ("${tenantId}").`
        )
    }
    const JWKS_URI = `${appOrigin}/${shortCode}/${tenantId}/oauth2/jwks`
    return joseCreateRemoteJWKSet(new URL(JWKS_URI))
}

export const validateSlasCallbackToken = async (token) => {
    const payload = decodeJwt(token)
    const subClaim = payload[CLAIM.ISSUER]
    const tokens = subClaim.split(DELIMITER.ISSUER)
    const tenantId = tokens[2]
    try {
        const jwks = createRemoteJWKSet(tenantId)
        const {payload} = await jwtVerify(token, jwks, {})
        return payload
    } catch (error) {
        throwSlasTokenValidationError(error.message, 401)
    }
}

const tenantIdRegExp = /^[a-zA-Z]{4}_([0-9]{3}|s[0-9]{2}|stg|dev|prd)$/
const shortCodeRegExp = /^[a-zA-Z0-9-]+$/

/**
 *  Handles JWKS (JSON Web Key Set) caching the JWKS response for 2 weeks.
 *
 * @param {object} req Express request object.
 * @param {object} res Express response object.
 * @param {object} options Options for fetching B2C Commerce API JWKS.
 * @param {string} options.shortCode - The Short Code assigned to the realm.
 * @param {string} options.tenantId - The Tenant ID for the ECOM instance.
 * @returns {Promise<*>} Promise with the JWKS data.
 */
export async function jwksCaching(req, res, options) {
    const {shortCode, tenantId} = options

    const isValidRequest = tenantIdRegExp.test(tenantId) && shortCodeRegExp.test(shortCode)
    if (!isValidRequest)
        return res
            .status(400)
            .json({error: 'Bad request parameters: Tenant ID or short code is invalid.'})
    try {
        const JWKS_URI = `https://${shortCode}.api.commercecloud.salesforce.com/shopper/auth/v1/organizations/f_ecom_${tenantId}/oauth2/jwks`
        const response = await fetch(JWKS_URI)

        if (!response.ok) {
            throw new Error('Request failed with status: ' + response.status)
        }

        // JWKS rotate every 30 days. For now, cache response for 14 days so that
        // fetches only need to happen twice a month
        res.set('Cache-Control', 'public, max-age=1209600, stale-while-revalidate=86400')

        return res.json(await response.json())
    } catch (error) {
        res.status(400).json({error: `Error while fetching data: ${error.message}`})
    }
}

const {app, handler} = runtime.createHandler(options, (app) => {
    app.use(express.json()) // To parse JSON payloads
    app.use(express.urlencoded({extended: true}))
    // Set default HTTP security headers required by PWA Kit
    app.use(defaultPwaKitSecurityHeaders)
    // Set custom HTTP security headers
    // ------------------------------------------------------------------
    // Google Signals country-TLD hosts used by GA4 for /ads/ga-audiences
    // and /g/collect. CSP has no wildcard for TLDs, so each country must be
    // listed explicitly. The list below covers every google.<TLD> Google has
    // operated for a country/territory (some are legacy/redirect to
    // google.com and are harmless to keep). The cleaner alternative is to
    // disable Google Signals in GA4 Admin > Data collection & modification.
    // ------------------------------------------------------------------
    const googleCountryHosts = [
        // Global
        'www.google.com',
        // Africa
        'www.google.dz', // Algeria
        'www.google.co.ao', // Angola
        'www.google.bf', // Burkina Faso
        'www.google.bi', // Burundi
        'www.google.bj', // Benin
        'www.google.co.bw', // Botswana
        'www.google.cd', // DR Congo
        'www.google.cf', // Central African Republic
        'www.google.cg', // Republic of the Congo
        'www.google.ci', // Ivory Coast
        'www.google.cm', // Cameroon
        'www.google.cv', // Cape Verde
        'www.google.dj', // Djibouti
        'www.google.com.eg', // Egypt
        'www.google.com.et', // Ethiopia
        'www.google.ga', // Gabon
        'www.google.gm', // Gambia
        'www.google.com.gh', // Ghana
        'www.google.gp', // Guadeloupe
        'www.google.co.ke', // Kenya
        'www.google.co.ls', // Lesotho
        'www.google.com.ly', // Libya
        'www.google.co.ma', // Morocco
        'www.google.mg', // Madagascar
        'www.google.ml', // Mali
        'www.google.mu', // Mauritius
        'www.google.mw', // Malawi
        'www.google.co.mz', // Mozambique
        'www.google.com.na', // Namibia
        'www.google.ne', // Niger
        'www.google.com.ng', // Nigeria
        'www.google.rw', // Rwanda
        'www.google.sc', // Seychelles
        'www.google.sn', // Senegal
        'www.google.so', // Somalia
        'www.google.sh', // Saint Helena
        'www.google.com.sl', // Sierra Leone
        'www.google.st', // São Tomé and Príncipe
        'www.google.td', // Chad
        'www.google.tg', // Togo
        'www.google.tn', // Tunisia
        'www.google.co.tz', // Tanzania
        'www.google.co.ug', // Uganda
        'www.google.co.za', // South Africa
        'www.google.co.zm', // Zambia
        'www.google.co.zw', // Zimbabwe
        // Americas
        'www.google.com.ag', // Antigua and Barbuda
        'www.google.com.ai', // Anguilla
        'www.google.com.ar', // Argentina
        'www.google.as', // American Samoa
        'www.google.com.bo', // Bolivia
        'www.google.com.br', // Brazil
        'www.google.bs', // Bahamas
        'www.google.com.bz', // Belize
        'www.google.ca', // Canada
        'www.google.cl', // Chile
        'www.google.com.co', // Colombia
        'www.google.co.cr', // Costa Rica
        'www.google.com.cu', // Cuba
        'www.google.dm', // Dominica
        'www.google.com.do', // Dominican Republic
        'www.google.com.ec', // Ecuador
        'www.google.com.gt', // Guatemala
        'www.google.gy', // Guyana
        'www.google.hn', // Honduras
        'www.google.ht', // Haiti
        'www.google.com.jm', // Jamaica
        'www.google.com.mx', // Mexico
        'www.google.ms', // Montserrat
        'www.google.com.ni', // Nicaragua
        'www.google.com.pa', // Panama
        'www.google.com.pe', // Peru
        'www.google.com.pr', // Puerto Rico
        'www.google.com.py', // Paraguay
        'www.google.sr', // Suriname
        'www.google.com.sv', // El Salvador
        'www.google.tt', // Trinidad and Tobago
        'www.google.com.uy', // Uruguay
        'www.google.com.vc', // Saint Vincent
        'www.google.co.ve', // Venezuela
        'www.google.vg', // British Virgin Islands
        'www.google.co.vi', // US Virgin Islands
        // Asia
        'www.google.com.af', // Afghanistan
        'www.google.am', // Armenia
        'www.google.az', // Azerbaijan
        'www.google.com.bd', // Bangladesh
        'www.google.com.bh', // Bahrain
        'www.google.bt', // Bhutan
        'www.google.com.bn', // Brunei
        'www.google.cn', // China
        'www.google.com.hk', // Hong Kong
        'www.google.co.id', // Indonesia
        'www.google.co.il', // Israel
        'www.google.co.in', // India
        'www.google.iq', // Iraq
        'www.google.jo', // Jordan
        'www.google.co.jp', // Japan
        'www.google.kg', // Kyrgyzstan
        'www.google.com.kh', // Cambodia
        'www.google.co.kr', // South Korea
        'www.google.com.kw', // Kuwait
        'www.google.kz', // Kazakhstan
        'www.google.la', // Laos
        'www.google.com.lb', // Lebanon
        'www.google.lk', // Sri Lanka
        'www.google.com.mm', // Myanmar
        'www.google.mn', // Mongolia
        'www.google.com.my', // Malaysia
        'www.google.mv', // Maldives
        'www.google.com.np', // Nepal
        'www.google.com.om', // Oman
        'www.google.com.pk', // Pakistan
        'www.google.com.ph', // Philippines
        'www.google.ps', // Palestine
        'www.google.com.qa', // Qatar
        'www.google.com.sa', // Saudi Arabia
        'www.google.com.sg', // Singapore
        'www.google.co.th', // Thailand
        'www.google.com.tj', // Tajikistan
        'www.google.tl', // East Timor
        'www.google.tm', // Turkmenistan
        'www.google.com.tr', // Turkey
        'www.google.com.tw', // Taiwan
        'www.google.ae', // United Arab Emirates
        'www.google.co.uz', // Uzbekistan
        'www.google.com.vn', // Vietnam
        'www.google.com.ye', // Yemen
        // Europe
        'www.google.ad', // Andorra
        'www.google.al', // Albania
        'www.google.at', // Austria
        'www.google.ba', // Bosnia and Herzegovina
        'www.google.be', // Belgium
        'www.google.bg', // Bulgaria
        'www.google.by', // Belarus
        'www.google.ch', // Switzerland
        'www.google.com.cy', // Cyprus
        'www.google.cz', // Czech Republic
        'www.google.de', // Germany
        'www.google.dk', // Denmark
        'www.google.ee', // Estonia
        'www.google.es', // Spain
        'www.google.fi', // Finland
        'www.google.fr', // France
        'www.google.gg', // Guernsey
        'www.google.gr', // Greece
        'www.google.hr', // Croatia
        'www.google.hu', // Hungary
        'www.google.ie', // Ireland
        'www.google.im', // Isle of Man
        'www.google.is', // Iceland
        'www.google.it', // Italy
        'www.google.je', // Jersey
        'www.google.li', // Liechtenstein
        'www.google.lt', // Lithuania
        'www.google.lu', // Luxembourg
        'www.google.lv', // Latvia
        'www.google.md', // Moldova
        'www.google.me', // Montenegro
        'www.google.mk', // North Macedonia
        'www.google.com.mt', // Malta
        'www.google.nl', // Netherlands
        'www.google.no', // Norway
        'www.google.pl', // Poland
        'www.google.pt', // Portugal
        'www.google.ro', // Romania
        'www.google.rs', // Serbia
        'www.google.ru', // Russia
        'www.google.se', // Sweden
        'www.google.si', // Slovenia
        'www.google.sk', // Slovakia
        'www.google.sm', // San Marino
        'www.google.com.ua', // Ukraine
        'www.google.co.uk', // United Kingdom
        // Oceania
        'www.google.com.au', // Australia
        'www.google.co.ck', // Cook Islands
        'www.google.com.fj', // Fiji
        'www.google.fm', // Micronesia
        'www.google.ki', // Kiribati
        'www.google.com.nf', // Norfolk Island
        'www.google.co.nz', // New Zealand
        'www.google.pn', // Pitcairn Islands
        'www.google.com.pg', // Papua New Guinea
        'www.google.com.sb', // Solomon Islands
        'www.google.to', // Tonga
        'www.google.tk', // Tokelau (legacy)
        'www.google.nr', // Nauru
        'www.google.nu', // Niue
        'www.google.vu', // Vanuatu
        'www.google.ws' // Samoa
    ]

    const contentSecurityPolicy = {
        useDefaults: true,
        directives: {
            'img-src': [
                // Default source for product images - replace with your CDN
                '*.commercecloud.salesforce.com',
                '*.demandware.net',
                '*.adyen.com', // Payment gateways
                'pay.google.com', // Google Pay payment handler icon
                'www.gstatic.com', // optional, if icon is on gstatic
                // Commerce Client messaging widget images
                'cimulate.ai',
                '*.cimulate.ai',
                // Google Tag Manager / Google Analytics tracking pixels
                'www.googletagmanager.com',
                // NOTE: CSP wildcards (*.host) do NOT match the apex host,
                // so both apex and *.subdomain forms must be listed.
                'google-analytics.com',
                '*.google-analytics.com',
                'analytics.google.com',
                '*.analytics.google.com',
                '*.g.doubleclick.net',
                // Google Signals "ads audience" pixels are sent to
                // google.<TLD>/ads/ga-audiences (TLD = user country).
                // CSP has no wildcard for TLDs, so each country must be listed.
                // If you'd rather not maintain this list, disable Google Signals
                // in GA4 Admin > Data collection > Google signals data collection.
                ...googleCountryHosts
            ],
            'script-src': [
                // C360A analytics script
                'https://cdn.c360a.salesforce.com',
                // Commerce Client messaging widget bundle (messaging.umd.js)
                '*.cimulate.ai',
                // Commerce Client bundle served from the SFCC static CDN
                '*.sfcc-store-internal.net',
                // Used by the service worker in /worker/main.js
                'storage.googleapis.com',
                // Connect to Google Cloud APIs
                'maps.googleapis.com',
                'places.googleapis.com',
                // Payment gateways
                '*.stripe.com',
                '*.paypal.com',
                '*.adyen.com',
                'pay.google.com',
                'www.gstatic.com',
                '*.demandware.net', // Used to load a valid payment scripts in test environment
                // Google Tag Manager loader + tags (GA4, etc.)
                'www.googletagmanager.com',
                '*.google-analytics.com',
                // GTM's inline bootstrap snippet requires an inline script allowance.
                // Prefer a nonce/hash in production if your infra supports it.
                "'unsafe-inline'"
            ],
            'connect-src': [
                // Connect to Einstein APIs
                'api.cquotient.com',
                // Connect to Commerce Client widget APIs
                '*.cimulate.ai',
                // Connect to DataCloud APIs
                '*.c360a.salesforce.com',
                // Connect to Google Cloud APIs
                'maps.googleapis.com',
                'places.googleapis.com',
                // Google Tag Manager / Google Analytics beacons
                'www.googletagmanager.com',
                // NOTE: CSP wildcards (*.host) do NOT match the apex host,
                // so both apex and *.subdomain forms must be listed.
                'google-analytics.com',
                '*.google-analytics.com',
                'analytics.google.com',
                '*.analytics.google.com',
                '*.g.doubleclick.net',
                // GA4 also POSTs events to www.google.com/g/collect (Fetch API).
                // Google Signals beacons go to google.<TLD>/ads/ga-audiences;
                // list each country TLD you need, or disable Google Signals.
                ...googleCountryHosts,
                // Connect to SCRT2 URLs
                '*.salesforce-scrt.com',
                // Payment gateways
                // Note: Google Pay requires different CSP entries depending on the integration and environment.
                // - 'pay.google.com' and 'payments.google.com' are generally needed for the SDK to load and create payment tokens.
                // - 'google.com/pay/' and 'www.google.com/pay/' may be required for certain flows (especially with Adyen) or in some browsers
                //   where the interactive payment sheet makes server calls directly to google.com/pay.
                // - You may need to adjust these URLs based on your environments.
                '*.demandware.net', // Used to load a valid payment scripts in test environment
                '*.adyen.com',
                '*.paypal.com',
                'pay.google.com',
                'payments.google.com',
                'google.com/pay',
                'google.com/pay/',
                'www.google.com/pay',
                'www.google.com/pay/'
            ],
            'frame-src': [
                // Allow frames from Salesforce site.com (Needed for MIAW)
                '*.site.com',
                // Payment gateways
                '*.stripe.com',
                '*.paypal.com',
                '*.adyen.com',
                'payments.google.com',
                'pay.google.com',
                // Google Tag Manager <noscript> iframe fallback
                'www.googletagmanager.com'
            ]
        }
    }

    app.use(
        helmet({
            contentSecurityPolicy
        })
    )

    // Handle the redirect from SLAS as to avoid error
    app.get('/callback', (req, res) => {
        // This endpoint does nothing and is not expected to change
        // Thus we cache it for a year to maximize performance
        res.set('Cache-Control', `max-age=31536000`)
        res.send()
    })

    app.get('/:shortCode/:tenantId/oauth2/jwks', (req, res) => {
        jwksCaching(req, res, {shortCode: req.params.shortCode, tenantId: req.params.tenantId})
    })

    // Handles the passwordless login callback route. SLAS makes a POST request to this
    // endpoint sending the email address and passwordless token. Then this endpoint calls
    // the sendMagicLinkEmail function to send an email with the passwordless login magic link.
    // https://developer.salesforce.com/docs/commerce/commerce-api/guide/slas-passwordless-login.html#receive-the-callback
    app.post(passwordlessLoginCallback, (req, res) => {
        const slasCallbackToken = req.headers['x-slas-callback-token']
        const redirectUrl = req.query.redirectUrl
        validateSlasCallbackToken(slasCallbackToken).then(() => {
            sendMagicLinkEmail(
                req,
                res,
                config.app.login?.passwordless?.landingPath,
                process.env.MARKETING_CLOUD_PASSWORDLESS_LOGIN_TEMPLATE,
                redirectUrl
            )
        })
    })

    // Handles the reset password callback route. SLAS makes a POST request to this
    // endpoint sending the email address and reset password token. Then this endpoint calls
    // the sendMagicLinkEmail function to send an email with the reset password magic link.
    // https://developer.salesforce.com/docs/commerce/commerce-api/guide/slas-password-reset.html#slas-password-reset-flow
    app.post(resetPasswordCallback, (req, res) => {
        const slasCallbackToken = req.headers['x-slas-callback-token']
        validateSlasCallbackToken(slasCallbackToken).then(() => {
            sendMagicLinkEmail(
                req,
                res,
                config.app.login?.resetPassword?.landingPath,
                process.env.MARKETING_CLOUD_RESET_PASSWORD_TEMPLATE
            )
        })
    })

    app.get('/robots.txt', runtime.serveStaticFile('static/robots.txt'))
    app.get('/favicon.ico', runtime.serveStaticFile('static/ico/favicon.ico'))

    app.get('/worker.js(.map)?', runtime.serveServiceWorker)

    // Helper function to transform relative icon paths to absolute URLs
    function transformIconPaths(data, ecomServerHost) {
        const baseUrl = `https://${ecomServerHost}/on/demandware.static/Sites-Site/-/-/internal`
        const methodTypes = data?.paymentMethodTypes
        if (methodTypes) {
            for (const method of Object.values(methodTypes)) {
                for (const image of method.images ?? []) {
                    if (image.src?.startsWith('/icons/')) {
                        image.src = `${baseUrl}${image.src}`
                    }
                }
            }
        }
        return data
    }

    // Helper function to fetch payment metadata from the Commerce Cloud instance
    app.get('/api/payment-metadata', async (req, res) => {
        try {
            const response = await fetch(config.app.sfPayments.metadataUrl, {
                headers: {Accept: 'application/json'}
            })
            if (!response.ok) {
                throw new Error(`Metadata request failed with status: ${response.status}`)
            }
            const data = await response.json()
            const transformedData = transformIconPaths(
                data,
                new URL(config.app.sfPayments.metadataUrl).hostname
            )
            res.setHeader('Content-Type', 'application/json')
            res.json(transformedData)
        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch metadata',
                details: error.message
            })
        }
    })

    app.get('*', runtime.render)
})
// SSR requires that we export a single handler function called 'get', that
// supports AWS use of the server that we created above.
export const get = handler

// Add this — the portable Express app for other platforms
export {app}
export default app
