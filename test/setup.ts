import { parse, stringify } from 'yaml'
import { setYamlCodec } from '@dotpm/core'
import { setPlatform } from '@dotpm/ui'
import { domPlatform } from './ui/dom-platform'
import './ui/dom-shim'

setYamlCodec({ parse, stringify })
if (typeof document !== 'undefined') setPlatform(domPlatform)
