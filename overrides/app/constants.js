/*
 * Copyright (c) 2023, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

/*
    Hello there! This is a demonstration of how to override a file from the base template.

    It's necessary that the module export interface remain consistent,
    as other files in the base template rely on constants.js, thus we
    import the underlying constants.js, modifies it and re-export it.
*/

export const CUSTOM_HOME_TITLE = 'HELLO TALAN'

// Category IDs that must be removed from the header nav / drawer nav / PLP.
// Anything whose id starts with one of these is treated as hidden.
export const HIDDEN_CATEGORY_IDS = ['electronics', 'newarrivals-electronics']

// Product IDs (or id prefixes) that must never render in tiles / scrollers / carousels.
// Currently: the 4 iPods, which live under the electronics category tree.
export const HIDDEN_PRODUCT_ID_PREFIXES = ['apple-ipod-']

export * from '@salesforce/retail-react-app/app/constants'
