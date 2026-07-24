/*
 * Override: render nothing for products whose id matches a hidden prefix.
 * Applies to every place the base template uses ProductTile — PLP, search
 * results, product scrollers, wishlist, cart line items, etc.
 */

import React from 'react'
import BaseProductTile, {
    Skeleton as BaseSkeleton
} from '@salesforce/retail-react-app/app/components/product-tile/index'
// See note in list-menu.jsx — use relative path to reach our overridden constants.
import {HIDDEN_PRODUCT_ID_PREFIXES} from '../../constants'

const isHiddenId = (id) =>
    typeof id === 'string' &&
    Array.isArray(HIDDEN_PRODUCT_ID_PREFIXES) &&
    HIDDEN_PRODUCT_ID_PREFIXES.some((prefix) => id.startsWith(prefix))

const ProductTile = (props) => {
    const id = props?.product?.productId || props?.product?.id
    if (isHiddenId(id)) return null
    return <BaseProductTile {...props} />
}

export const Skeleton = BaseSkeleton
export default ProductTile
