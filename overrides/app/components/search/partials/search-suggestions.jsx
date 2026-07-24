/*
 * Override: strip hidden categories/products from the search-as-you-type
 * suggestions dropdown (e.g. typing "electronics" or "ipod" in the search box).
 * Without this, the redirects in routes.jsx stop someone from LANDING on the
 * hidden category/product page, but the suggestion would still flash in the
 * dropdown as they type, which leaks the "hidden" catalog.
 */

import React from 'react'
import BaseSearchSuggestions from '@salesforce/retail-react-app/app/components/search/partials/search-suggestions'
// Relative path to bypass the pwa-kit override self-loop guard (which
// otherwise resolves to the base template's constants and returns undefined).
import {HIDDEN_CATEGORY_IDS, HIDDEN_PRODUCT_ID_PREFIXES} from '../../../constants'
const isHiddenCategoryId = (id) =>
    Array.isArray(HIDDEN_CATEGORY_IDS) &&
    HIDDEN_CATEGORY_IDS.some((prefix) => id === prefix || id?.startsWith(prefix + '-'))

const isHiddenProductId = (id) =>
    typeof id === 'string' &&
    Array.isArray(HIDDEN_PRODUCT_ID_PREFIXES) &&
    HIDDEN_PRODUCT_ID_PREFIXES.some((prefix) => id.startsWith(prefix))

const filterSuggestions = (searchSuggestions) => {
    if (!searchSuggestions) return searchSuggestions
    return {
        ...searchSuggestions,
        categorySuggestions: searchSuggestions.categorySuggestions?.filter(
            (c) => !isHiddenCategoryId(c.id)
        ),
        productSuggestions: searchSuggestions.productSuggestions?.filter(
            (p) => !isHiddenProductId(p.productId)
        )
    }
}

const SearchSuggestions = (props) => (
    <BaseSearchSuggestions
        {...props}
        searchSuggestions={filterSuggestions(props.searchSuggestions)}
    />
)

export default SearchSuggestions