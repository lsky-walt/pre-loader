const os = require("os")
const LibraryTemplatePlugin = require("webpack/lib/LibraryTemplatePlugin")
const NodeTemplatePlugin = require("webpack/lib/node/NodeTemplatePlugin")
const NodeTargetPlugin = require("webpack/lib/node/NodeTargetPlugin")
const MemoryFs = require("memory-fs")
const {
  runChildCompiler,
  getRootCompiler,
  normalizeEntry,
  applyEntry,
} = require("./util")
const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")

const PLUGIN_NAME = "magic-loader"

const FILENAME = "ssg-bundle.js"

const HTML_TAG = /\{\{HTML(?::\s*([^}]+?)\s*)?\}\}/

const promiseSpawnWithReturnData = ({ command = "", args = [], option = {} }) =>
  new Promise((resolve, reject) => {
    if (!command || args.length <= 0) {
      console.log("Error: Incomplete parameters")
      console.log()
      reject(new Error("Error: Incomplete parameters"))
      process.exit(1)
    }
    console.log(`exec command: ${command} ${args.join(" ")}`)
    const child = spawn(command, args, { ...option })
    let data = ""
    child.stdout &&
      child.stdout.on("data", (msg) => {
        data += msg
      })
    child.on("error", (err) => {
      console.error(err)
      reject(err)
    })
    child.on("close", (code) => {
      if (code !== 0) {
        reject({
          command: `${command} ${args.join(" ")}`,
        })
        return
      }
      resolve(data)
    })
  })

function PrerenderLoader(content) {
  const options = this.getOptions() || {}
  const outputFilter = (str) => "export default " + JSON.stringify(str)

  const matches = content.match(HTML_TAG)
  if (matches) {
    options.entry = matches[1] || options.entry
  }
  options.templateContent = content

  const callback = this.async()

  prerender(this._compilation, this.request, options)
    .then((output) => {
      callback(null, outputFilter(output))
    })
    .catch((err) => {
      callback(err)
    })
}

async function prerender(parentCompilation, request, options) {
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

  new NodeTemplatePlugin(outputOptions).apply(compiler)
  new NodeTargetPlugin().apply(compiler)

  new LibraryTemplatePlugin(undefined, "umd").apply(compiler)

  applyEntry(context, entry, compiler)

  // change some options
  compiler.options.externalsPresets = {
    ...compiler.options.externalsPresets,
    web: false,
    node: true,
  }
  compiler.options.externalsType = "umd"
  compiler.options.loader.target = "node"
  compiler.options.node = {
    global: false,
    __filename: "eval-only",
    __dirname: "eval-only",
  }

  compiler.options.output = {
    ...compiler.options.output,
    chunkFormat: "commonjs",
    enabledChunkLoadingTypes: ["require"],
    enabledLibraryTypes: ["umd"],
    enabledWasmLoadingTypes: ["async-node"],
    globalObject: "global",
    scriptType: false,
    library: {
      type: "umd",
    },
    wasmLoading: "async-node",
    workerChunkLoading: "require",
    workerWasmLoading: "async-node",
  }

  compiler.options.performance = false
  compiler.options.resolve = {
    ...compiler.options.resolve,
    byDependency: {
      wasm: {
        conditionNames: ["import", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      esm: {
        conditionNames: ["import", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      loaderImport: {
        conditionNames: ["import", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      worker: {
        conditionNames: ["import", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
        preferRelative: true,
      },
      commonjs: {
        conditionNames: ["require", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      amd: {
        conditionNames: ["require", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      loader: {
        conditionNames: ["require", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      unknown: {
        conditionNames: ["require", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      undefined: {
        conditionNames: ["require", "module", "..."],
        aliasFields: [],
        mainFields: ["module", "..."],
      },
      url: {
        preferRelative: true,
      },
    },
    cache: false,
    modules: ["node_modules"],
    conditionNames: ["webpack", "production", "node"],
    mainFiles: ["index"],
    extensions: [".", ".ts", ".tsx", ".js", ".jsx", ".json"],
    aliasFields: [],
    exportsFields: ["exports"],
    mainFields: ["main"],
  }

  compiler.options.target = "node"

  const compilation = await runChildCompiler(compiler)

  let result = ""

  // out put write to tmp folder
  let tmpdir = path.join(outputOptions.path, `ssg-${+new Date()}`)
  fs.mkdirSync(tmpdir)

  if (compilation.assets[compilation.options.output.filename]) {
    const output =
      compilation.assets[compilation.options.output.filename].source()

    fs.writeFileSync(path.join(tmpdir, "ssg-source.js"), output, "utf8")
    fs.writeFileSync(
      path.join(tmpdir, "index.js"),
      `
    const ssg = require("./ssg-source.js")
    console.log(ssg.app())
    `,
      "utf8"
    )
    // 执行 index.js
    const msg = await promiseSpawnWithReturnData({
      command: "node",
      args: ["index.js"],
      option: {
        cwd: tmpdir,
      },
    })

    const tpl =
      options.templateContent ||
      "<!DOCTYPE html><html><head></head><body></body></html>"
    result = tpl.replace(HTML_TAG, msg)
  }

  // exec clear
  await promiseSpawnWithReturnData({
    command: "rm",
    args: ["-rf", tmpdir],
  })

  return result
}

module.exports = PrerenderLoader
