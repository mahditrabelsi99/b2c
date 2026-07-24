/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import React from 'react'
import loadable from '@loadable/component'
import {Redirect} from 'react-router-dom'
import {getConfig} from '@salesforce/pwa-kit-runtime/utils/ssr-config'

// Components
import {Skeleton} from '@salesforce/retail-react-app/app/components/shared/ui'
import {configureRoutes} from '@salesforce/retail-react-app/app/utils/routes-utils'
import {routes as _routes} from '@salesforce/retail-react-app/app/routes'

const fallback = <Skeleton height="75vh" width="100%" />

// Create your pages here and add them to the routes array
// Use loadable to split code into smaller js chunks
const Home = loadable(() => import('./pages/home'), {fallback})
const MyNewRoute = loadable(() => import('./pages/my-new-route'))
// Our overridden Product List (adds hidden-product filter to search + category browse).
// The base template's routes.jsx uses a relative dynamic import for its own PLP, which
// bypasses the pwa-kit override resolver. Wiring the route to a relative import from
// THIS file (which lives inside the overrides dir) forces webpack to load our override.
const ProductList = loadable(() => import('./pages/product-list'), {fallback})

// Bounce anyone landing on a hidden category / product back to the home page.
const HiddenRedirect = () => <Redirect to="/" />

// Replace the base template's ProductList routes (/search and /category/:categoryId)
// with ones pointing at OUR overridden ProductList. Everything else is passed through.
const PRODUCT_LIST_PATHS = new Set(['/search', '/category/:categoryId'])
const patchedBaseRoutes = _routes.map((route) =>
    PRODUCT_LIST_PATHS.has(route.path) ? {...route, component: ProductList} : route
)

const routes = [
    {
        path: '/',
        component: Home,
        exact: true
    },
    {
        path: '/my-new-route',
        component: MyNewRoute
    },
    // Hidden categories: electronics tree + newarrivals-electronics tree + gift-certificates.
    // The regex uses path-to-regexp syntax supported by react-router v5.
    {
        path: '/category/:categoryId(electronics|electronics-.*|newarrivals-electronics|newarrivals-electronics-.*|gift-certificates|gift-certificates-.*)',
        component: HiddenRedirect
    },
    // Hidden products (all 4 iPods live under electronics-digital-media-players).
    {
        path: '/product/:productId(apple-ipod-.*)',
        component: HiddenRedirect
    },
    ...patchedBaseRoutes
]

export default () => {
    const config = getConfig()
    return configureRoutes(routes, config, {
        ignoredRoutes: ['/callback', '*']
    })
}
