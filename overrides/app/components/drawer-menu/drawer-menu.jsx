/*
 * Override: strip hidden top-level categories from the mobile drawer nav.
 */

import React from 'react'
import {DrawerMenu as BaseDrawerMenu} from '@salesforce/retail-react-app/app/components/drawer-menu/drawer-menu'
// See note in list-menu.jsx — use relative path to reach our overridden constants.
import {HIDDEN_CATEGORY_IDS} from '../../constants'

const isHidden = (id) =>
    Array.isArray(HIDDEN_CATEGORY_IDS) &&
    HIDDEN_CATEGORY_IDS.some((prefix) => id === prefix || id?.startsWith(prefix + '-'))

const filterRoot = (root) => {
    if (!root?.categories) return root
    return {
        ...root,
        categories: root.categories.filter((c) => !isHidden(c.id))
    }
}

export const DrawerMenu = (props) => <BaseDrawerMenu {...props} root={filterRoot(props.root)} />
