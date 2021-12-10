const os = require("os")
const jsdom = require("jsdom")
const LibraryTemplatePlugin = require("webpack/lib/LibraryTemplatePlugin")
const NodeTemplatePlugin = require("webpack/lib/node/NodeTemplatePlugin")
const NodeTargetPlugin = require("webpack/lib/node/NodeTargetPlugin")
const DefinePlugin = require("webpack/lib/DefinePlugin")
const MemoryFs = require("memory-fs")
const {
  runChildCompiler,
  getRootCompiler,
  getBestModuleExport,
  stringToModule,
  normalizeEntry,
  applyEntry,
} = require("./util")

const PLUGIN_NAME = "prerender-loader"

const FILENAME = "ssr-bundle.js"

const PRERENDER_REG = /\{\{prerender(?::\s*([^}]+?)\s*)?\}\}/

function PrerenderLoader(content) {
  const options = this.getOptions() || {}
  const outputFilter =
    options.as === "string" || options.string ? stringToModule : String

  if (options.disabled === true) {
    return outputFilter(content)
  }

  let inject = false
  if (!this.request.match(/\.(js|ts)x?$/i)) {
    const matches = content.match(PRERENDER_REG)
    if (matches) {
      inject = true
      options.entry = matches[1] || options.entry
    }
    options.templateContent = content
  }

  const callback = this.async()

  prerender(this._compilation, this.request, options, inject, this)
    .then((output) => {
      callback(null, outputFilter(output))
    })
    .catch((err) => {
      callback(err)
    })
}

async function prerender(parentCompilation, request, options, inject, loader) {
  const parentCompiler = getRootCompiler(parentCompilation.compiler)
  const context = parentCompiler.options.context || process.cwd()
  const customEntry =
    options.entry && ([].concat(options.entry).pop() || "").trim()
  const entry = customEntry
    ? "./" + customEntry
    : normalizeEntry(context, parentCompiler.options.entry, "./")

  const outputOptions = {
    path: os.tmpdir(),
    filename: FILENAME,
  }

  const allowedPlugins = /(MiniCssExtractPlugin|ExtractTextPlugin)/i
  const plugins = (parentCompiler.options.plugins || []).filter((c) =>
    allowedPlugins.test(c.constructor.name)
  )

  const compiler = parentCompilation.createChildCompiler(
    "prerender",
    outputOptions,
    plugins
  )
  compiler.context = parentCompiler.context
  compiler.outputFileSystem = new MemoryFs()

  new DefinePlugin({
    PRERENDER: "true",
  }).apply(compiler)

  new DefinePlugin({
    PRERENDER: "false",
  }).apply(parentCompiler)

  new NodeTemplatePlugin(outputOptions).apply(compiler)
  new NodeTargetPlugin().apply(compiler)

  new LibraryTemplatePlugin("PRERENDER_RESULT", "var").apply(compiler)

  applyEntry(context, entry, compiler)

  const compilation = await runChildCompiler(compiler)
  let result
  let dom, window, injectParent, injectNextSibling

  function BrokenPromise() {}
  BrokenPromise.prototype.then =
    BrokenPromise.prototype.catch =
    BrokenPromise.prototype.finally =
      () => new BrokenPromise()

  if (compilation.assets[compilation.options.output.filename]) {
    const output =
      compilation.assets[compilation.options.output.filename].source()

    const tpl =
      options.templateContent ||
      "<!DOCTYPE html><html><head></head><body></body></html>"
    dom = new jsdom.JSDOM(
      tpl.replace(PRERENDER_REG, '<div id="PRERENDER_INJECT"></div>'),
      {
        virtualConsole: new jsdom.VirtualConsole({
          omitJSDOMErrors: false,
        }).sendTo(console),

        url: options.documentUrl || "http://localhost",

        includeNodeLocations: false,

        runScripts: "outside-only",
      }
    )
    window = dom.window

    const injectPlaceholder = window.document.getElementById("PRERENDER_INJECT")
    if (injectPlaceholder) {
      injectParent = injectPlaceholder.parentNode
      injectNextSibling = injectPlaceholder.nextSibling
      injectPlaceholder.remove()
    }

    let counter = 0
    window.requestAnimationFrame = () => ++counter
    window.cancelAnimationFrame = () => {}

    window.customElements = {
      define() {},
      get() {},
      upgrade() {},
      whenDefined: () => new BrokenPromise(),
    }

    window.MessagePort = function () {
      ;(this.port1 = new window.EventTarget()).postMessage = () => {}
      ;(this.port2 = new window.EventTarget()).postMessage = () => {}
    }

    window.matchMedia = () => ({ addListener() {} })

    if (!window.navigator) window.navigator = {}
    window.navigator.serviceWorker = {
      register: () => new BrokenPromise(),
    }

    window.PRERENDER = true

    window.require = (moduleId) => {
      const asset = compilation.assets[moduleId.replace(/^\.?\//g, "")]
      if (!asset) {
        try {
          return require(moduleId)
        } catch (e) {
          throw Error(
            `Error:  Module not found. attempted require("${moduleId}")`
          )
        }
      }
      const mod = { exports: {} }
      window.eval(
        `(function(exports, module, require){\n${asset.source()}\n})`
      )(mod.exports, mod, window.require)
      return mod.exports
    }

    result = window.eval(output + "\nPRERENDER_RESULT")
  }

  if (result && typeof result === "object") {
    result = getBestModuleExport(result)
  }

  if (typeof result === "function") {
    result = result(options.params || null)
  }

  if (result && result.then) {
    result = await result
  }

  if (result !== undefined && options.templateContent) {
    const template = window.document.createElement("template")
    template.innerHTML = result || ""
    const content = template.content || template
    const parent = injectParent || window.document.body
    let child
    while ((child = content.firstChild)) {
      parent.insertBefore(child, injectNextSibling || null)
    }
  } else if (inject) {
    return options.templateContent.replace(PRERENDER_REG, result || "")
  }

  let serialized = dom.serialize()
  if (!/^<!DOCTYPE /im.test(serialized)) {
    serialized = `<!DOCTYPE html>${serialized}`
  }
  return serialized
}

module.exports = PrerenderLoader
