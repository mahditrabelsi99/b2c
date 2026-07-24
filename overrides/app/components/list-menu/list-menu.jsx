/*
 * Override: strip hidden top-level categories from the desktop nav.
 */

import React from 'react'
import {ListMenu as BaseListMenu} from '@salesforce/retail-react-app/app/components/list-menu/list-menu'
import {HIDDEN_CATEGORY_IDS} from '@salesforce/retail-react-app/app/constants'

const isHidden = (id) =>
    HIDDEN_CATEGORY_IDS.some((prefix) => id === prefix || id?.startsWith(prefix + '-'))

const filterRoot = (root) => {
    if (!root?.categories) return root
    return {
        ...root,
        categories: root.categories.filter((c) => !isHidden(c.id))
    }
}

export const ListMenu = (props) => <BaseListMenu {...props} root={filterRoot(props.root)} />
