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

// Bounce anyone landing on a hidden category / product back to the home page.
const HiddenRedirect = () => <Redirect to="/" />

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
    // Hidden categories: electronics tree + newarrivals-electronics tree.
    // The regex uses path-to-regexp syntax supported by react-router v5.
    {
        path: '/category/:categoryId(electronics|electronics-.*|newarrivals-electronics|newarrivals-electronics-.*)',
        component: HiddenRedirect
    },
    // Hidden products (all 4 iPods live under electronics-digital-media-players).
    {
        path: '/product/:productId(apple-ipod-.*)',
        component: HiddenRedirect
    },
    ..._routes
]

export default () => {
    const config = getConfig()
    return configureRoutes(routes, config, {
        ignoredRoutes: ['/callback', '*']
    })
}
