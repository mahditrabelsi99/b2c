/*
 * Copyright (c) 2024, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import React from 'react'
import PropTypes from 'prop-types'

/**
 * Overrides the default `_document` component from `@salesforce/pwa-kit-react-sdk`
 * to inject the Google Tag Manager `<noscript>` iframe immediately after the
 * opening `<body>` tag, as required by GTM installation guidelines.
 *
 * All other behavior mirrors the SDK's default document.
 */
const GTM_ID = 'GTM-WWGS83Z9'

const Document = ({
    head,
    html,
    afterBodyStart,
    beforeBodyEnd,
    htmlAttributes,
    bodyAttributes
}) => {
    return (
        <html lang="en-US" {...htmlAttributes}>
            <head>
                <meta name="charset" content="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=5.0"
                />
                <meta name="format-detection" content="telephone=no" />
                {head.map((child) => child)}
            </head>
            <body {...bodyAttributes}>
                {/* Google Tag Manager (noscript) */}
                <noscript
                    dangerouslySetInnerHTML={{
                        __html: `<iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`
                    }}
                />
                {/* End Google Tag Manager (noscript) */}
                {afterBodyStart.map((child, i) => (
                    <React.Fragment key={i}>{child}</React.Fragment>
                ))}
                <div
                    className="react-target"
                    dangerouslySetInnerHTML={{__html: html}}
                />
                {beforeBodyEnd.map((child, i) => (
                    <React.Fragment key={i}>{child}</React.Fragment>
                ))}
            </body>
        </html>
    )
}

Document.propTypes = {
    afterBodyStart: PropTypes.arrayOf(PropTypes.node).isRequired,
    beforeBodyEnd: PropTypes.arrayOf(PropTypes.node).isRequired,
    head: PropTypes.arrayOf(PropTypes.node).isRequired,
    html: PropTypes.string.isRequired,
    htmlAttributes: PropTypes.object,
    bodyAttributes: PropTypes.object
}

Document.defaultProps = {
    afterBodyStart: [],
    beforeBodyEnd: [],
    head: [],
    html: '',
    htmlAttributes: {},
    bodyAttributes: {}
}

export default Document
