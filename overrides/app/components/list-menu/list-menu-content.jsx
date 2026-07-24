/*
 * Override: strip hidden sub-categories from the desktop nav popover
 * (e.g. "New Arrivals > Electronics").
 */

import React from 'react'
import {ListMenuContent as BaseListMenuContent} from '@salesforce/retail-react-app/app/components/list-menu/list-menu-content'
// Relative path to bypass the pwa-kit override self-loop guard (which
// otherwise resolves to the base template's constants and returns undefined).
import {HIDDEN_CATEGORY_IDS} from '../../constants'

const isHidden = (id) =>
    Array.isArray(HIDDEN_CATEGORY_IDS) &&
    HIDDEN_CATEGORY_IDS.some((prefix) => id === prefix || id?.startsWith(prefix + '-'))

const filterItem = (item, itemsKey) => {
    if (!item?.[itemsKey]) return item
    return {
        ...item,
        [itemsKey]: item[itemsKey].filter((c) => !isHidden(c.id))
    }
}

export const ListMenuContent = (props) => (
    <BaseListMenuContent {...props} item={filterItem(props.item, props.itemsKey)} />
)
