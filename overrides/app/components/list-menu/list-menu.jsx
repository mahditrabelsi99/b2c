/*
 * Override: strip hidden top-level categories from the desktop nav.
 */

import React from 'react'
import {ListMenu as BaseListMenu} from '@salesforce/retail-react-app/app/components/list-menu/list-menu'
// Use relative path: importing via '@salesforce/retail-react-app/app/constants' from
// inside an override resolves to the ORIGINAL template constants (self-loop guard),
// so HIDDEN_CATEGORY_IDS would be undefined. Relative path hits our override file.
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

export const ListMenu = (props) => <BaseListMenu {...props} root={filterRoot(props.root)} />
