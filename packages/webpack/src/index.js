import { makeWriteVirtualModuleFn } from './virtual.js'

/** @type {import('../index').WhyframePlugin} */
export class WhyframePlugin {
  /** @type {import('../index').Options} */
  #options
  /** @type {ReturnType<typeof import('./virtual').makeWriteVirtualModuleFn>} */
  #writeVirtualModule
  // used for final import map generation
  /** @type {Map<string, string>} */
  #hashToEntryIds = new Map()

  constructor(options = {}) {
    this.#options = options
  }

  /**
   * @param {import('webpack').Compiler} compiler
   */
  apply(compiler) {
    this.#writeVirtualModule = makeWriteVirtualModuleFn(compiler)

    compiler.hooks.compilation.tap('WhyframePlugin', () => {
      // load whyframe:app
      this.#writeVirtualModule('whyframe:app', whyframeAppCode)
      // load whyframe:build-data
      this.#writeVirtualModule('whyframe:build-data', this.#getBuildData())
    })
  }

  async #getBuildData() {
    // NOTE: I thought I need to wait here for the compilation before reading
    // `hashToEntryIds` but turns out webpack compiles multiple times?
    //  Not sure if this is an issue but I'll take it for now.
    let final = ''
    for (const [hash, id] of this.#hashToEntryIds) {
      final += `"${hash}": () => import("${id}"), `
    }
    return `export default {${final}}`
  }

  getComponent(componentName) {
    return this.#options.components?.find((c) => c.name === componentName)
  }
  moduleMayHaveIframe(id, code) {
    return (
      !id.includes('__whyframe:') &&
      !id.includes('__whyframe-') &&
      (code.includes('<iframe') ||
        !!this.#options.components?.some((n) => code.includes(`<${n}`)))
    )
  }
  getDefaultShowSource() {
    return this.#options.defaultShowSource ?? false
  }
  getMainIframeAttrs(entryId, hash, source, isComponent) {
    /** @type {import('../index').Attr[]} */
    const attrs = []
    attrs.push({
      type: 'static',
      name: isComponent ? '_why?.src' : 'src',
      value: this.#options.defaultSrc || ''
    })
    this.#hashToEntryIds.set(hash, entryId)
    attrs.push({
      type: 'static',
      name: isComponent ? '_why?.id' : 'data-why-id',
      value: hash
    })

    if (source) {
      attrs.push({
        type: 'static',
        name: isComponent ? '_why?.source' : 'data-why-source',
        value: source
      })
    }
    if (isComponent) {
      const whyProp = {}
      for (const attr of attrs) {
        whyProp[attr.name.slice('_why?.'.length)] = attr.value
      }
      return [
        {
          type: 'dynamic',
          name: '_why',
          value: whyProp
        }
      ]
    } else {
      return attrs
    }
  }
  getProxyIframeAttrs() {
    /** @type {import('../index').Attr[]} */
    return [
      {
        type: 'dynamic',
        name: 'src',
        value: `_why?.src || ${JSON.stringify(this.#options.defaultSrc || '')}`
      },
      {
        type: 'dynamic',
        name: 'data-why-id',
        value: '_why?.id'
      },
      {
        type: 'dynamic',
        name: 'data-why-source',
        value: '_why?.source'
      }
    ]
  }
  createEntry(originalId, hash, ext, code) {
    // example: whyframe:entry-123456.jsx
    const entryId = `whyframe:entry-${hash}${ext}`
    this.#writeVirtualModule(entryId, code)
    return entryId
  }
  createEntryComponent(originalId, hash, ext, code) {
    // example: /User/bjorn/foo/bar/App.svelte__whyframe-123456.svelte
    const entryComponentId = `${originalId}__whyframe-${hash}${ext}`
    this.#writeVirtualModule(entryComponentId, code)
    return entryComponentId
  }
}

const whyframeAppCode = `\
import hashToImportMap from 'whyframe:build-data'
export async function createApp(el) {
  const hash = window.frameElement.dataset.whyId
  const importApp = hashToImportMap[hash]
  if (!importApp) throw new Error('no app found')
  const data = await importApp()
  const result = await data.createApp(el)
  return result
}`