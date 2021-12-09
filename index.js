const path = require("path")
const Prerenderer = require("@prerenderer/prerenderer")
const PuppeteerRenderer = require("@prerenderer/renderer-puppeteer")
const { minify } = require("html-minifier")
const fs = require("fs")

function PrePlugin(...args) {
  const rendererOptions = {}

  this._options = {}

  // Normal args object.
  if (args.length === 1) {
    this._options = args[0] || {}
  } else {
    console.warn(
      "[pre-plugin] You appear to be using the v2 argument-based configuration options. It's recommended that you migrate to the clearer object-based configuration system.\nCheck the documentation for more information."
    )
    let staticDir, routes

    args.forEach((arg) => {
      if (typeof arg === "string") staticDir = arg
      else if (Array.isArray(arg)) routes = arg
      else if (typeof arg === "object") this._options = arg
    })

    staticDir ? (this._options.staticDir = staticDir) : null
    routes ? (this._options.routes = routes) : null
  }

  if (this._options.captureAfterDocumentEvent) {
    console.warn(
      "[pre-plugin] captureAfterDocumentEvent has been renamed to renderAfterDocumentEvent and should be moved to the renderer options."
    )
    rendererOptions.renderAfterDocumentEvent =
      this._options.captureAfterDocumentEvent
  }

  if (this._options.captureAfterElementExists) {
    console.warn(
      "[pre-plugin] captureAfterElementExists has been renamed to renderAfterElementExists and should be moved to the renderer options."
    )
    rendererOptions.renderAfterElementExists =
      this._options.captureAfterElementExists
  }

  if (this._options.captureAfterTime) {
    console.warn(
      "[pre-plugin] captureAfterTime has been renamed to renderAfterTime and should be moved to the renderer options."
    )
    rendererOptions.renderAfterTime = this._options.captureAfterTime
  }

  this._options.server = this._options.server || {}
  this._options.renderer =
    this._options.renderer ||
    new PuppeteerRenderer(
      Object.assign({}, { headless: true }, rendererOptions)
    )

  if (this._options.postProcessHtml) {
    console.warn(
      "[pre-plugin] postProcessHtml should be migrated to postProcess! Consult the documentation for more information."
    )
  }
}

PrePlugin.prototype.apply = function (compiler) {
  const compilerFS = compiler.outputFileSystem

  const mkdirp = function (dir, opts = {}) {
    return new Promise((resolve, reject) => {
      opts.recursive = true
      fs.mkdir(dir, opts, (err, made) =>
        err === null ? resolve(made) : reject(err)
      )
    })
  }

  const afterEmit = (compilation, done) => {
    const PrerendererInstance = new Prerenderer(this._options)

    PrerendererInstance.initialize()
      .then(() => {
        return PrerendererInstance.renderRoutes(this._options.routes || [])
      })
      .then((renderedRoutes) =>
        this._options.postProcessHtml
          ? renderedRoutes.map((renderedRoute) => {
              const processed = this._options.postProcessHtml(renderedRoute)
              if (typeof processed === "string") renderedRoute.html = processed
              else renderedRoute = processed

              return renderedRoute
            })
          : renderedRoutes
      )
      .then((renderedRoutes) =>
        this._options.postProcess
          ? Promise.all(
              renderedRoutes.map((renderedRoute) =>
                this._options.postProcess(renderedRoute)
              )
            )
          : renderedRoutes
      )
      .then((renderedRoutes) => {
        const isValid = renderedRoutes.every((r) => typeof r === "object")
        if (!isValid) {
          throw new Error(
            "[pre-plugin] Rendered routes are empty, did you forget to return the `context` object in postProcess?"
          )
        }

        return renderedRoutes
      })
      .then((renderedRoutes) => {
        if (!this._options.minify) return renderedRoutes

        renderedRoutes.forEach((route) => {
          route.html = minify(route.html, this._options.minify)
        })

        return renderedRoutes
      })
      .then((renderedRoutes) => {
        renderedRoutes.forEach((rendered) => {
          if (!rendered.outputPath) {
            rendered.outputPath = path.join(
              this._options.outputDir || this._options.staticDir,
              rendered.route,
              "index.html"
            )
          }
        })

        return renderedRoutes
      })
      .then((processedRoutes) => {
        const promises = Promise.all(
          processedRoutes.map((processedRoute) => {
            return mkdirp(path.dirname(processedRoute.outputPath))
              .then(() => {
                return new Promise((resolve, reject) => {
                  compilerFS.writeFile(
                    processedRoute.outputPath,
                    processedRoute.html.trim(),
                    (err) => {
                      if (err)
                        reject(
                          `[pre-plugin] Unable to write rendered route to file "${processedRoute.outputPath}" \n ${err}.`
                        )
                      else resolve()
                    }
                  )
                })
              })
              .catch((err) => {
                if (typeof err === "string") {
                  err = `[pre-plugin] Unable to create directory ${path.dirname(
                    processedRoute.outputPath
                  )} for route ${processedRoute.route}. \n ${err}`
                }

                throw err
              })
          })
        )

        return promises
      })
      .then((r) => {
        PrerendererInstance.destroy()
        done()
      })
      .catch((err) => {
        PrerendererInstance.destroy()
        const msg = "[pre-plugin] Unable to prerender all routes!"
        console.error(msg)
        compilation.errors.push(new Error(msg))
        done()
      })
  }

  if (compiler.hooks) {
    const plugin = { name: "PrePlugin" }
    compiler.hooks.afterEmit.tapAsync(plugin, afterEmit)
  } else {
    compiler.plugin("after-emit", afterEmit)
  }
}

PrePlugin.PuppeteerRenderer = PuppeteerRenderer

module.exports = PrePlugin
