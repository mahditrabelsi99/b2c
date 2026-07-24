/*
 * Override: render nothing for products whose id matches a hidden prefix.
 * Applies to every place the base template uses ProductTile — PLP, search
 * results, product scrollers, wishlist, cart line items, etc.
 */

import React from 'react'
import BaseProductTile, {
    Skeleton as BaseSkeleton
} from '@salesforce/retail-react-app/app/components/product-tile/index'
import {HIDDEN_PRODUCT_ID_PREFIXES} from '@salesforce/retail-react-app/app/constants'

const isHiddenId = (id) =>
    typeof id === 'string' &&
    HIDDEN_PRODUCT_ID_PREFIXES.some((prefix) => id.startsWith(prefix))

const ProductTile = (props) => {
    const id = props?.product?.productId || props?.product?.id
    if (isHiddenId(id)) return null
    return <BaseProductTile {...props} />
}

export const Skeleton = BaseSkeleton
export default ProductTile
