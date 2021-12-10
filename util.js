const path = require("path")
const EntryPlugin = require("webpack/lib/EntryPlugin")

function runChildCompiler(compiler) {
  return new Promise((resolve, reject) => {
    compiler.compile((err, compilation) => {
      compiler.parentCompilation.children.push(compilation)
      if (err) return reject(err)

      if (compilation.errors && compilation.errors.length) {
        const errorDetails = compilation.errors
          .map((error) => {
            if (error instanceof Error) {
              return error.stack
            } else if (error.details) {
              return error.details
            }
            return error
          })
          .join("\n")
        return reject(Error("Child compilation failed:\n" + errorDetails))
      }

      resolve(compilation)
    })
  })
}

function getRootCompiler(compiler) {
  while (compiler.parentCompilation && compiler.parentCompilation.compiler) {
    compiler = compiler.parentCompilation.compiler
  }
  return compiler
}

function getBestModuleExport(exports) {
  if (exports.default) {
    return exports.default
  }
  for (const prop in exports) {
    if (prop !== "__esModule") {
      return exports[prop]
    }
  }
}

function normalizeEntry(context, entry, prefix = "") {
  if (entry && typeof entry === "object") {
    return Object.keys(entry).reduce((acc, key) => {
      const entryItem = entry[key]
      if (typeof entryItem === "object" && entryItem.import) {
        acc[key] = convertPathToRelative(context, entryItem.import, prefix)
      } else {
        acc[key] = convertPathToRelative(context, entryItem, prefix)
      }
      return acc
    }, {})
  }
  return convertPathToRelative(context, entry, prefix)
}

function convertPathToRelative(context, entryPath, prefix) {
  if (Array.isArray(entryPath)) {
    return entryPath.map((p) => prefix + path.relative(context, p))
  }
  return prefix + path.relative(context, entryPath)
}

function applyEntry(context, entry, compiler) {
  if (typeof entry === "string") {
    itemToPlugin(context, entry, "main").apply(compiler)
  } else if (Array.isArray(entry)) {
    entry.forEach((item) => {
      itemToPlugin(context, item, "main").apply(compiler)
    })
  } else if (typeof entry === "object") {
    Object.keys(entry).forEach((name) => {
      const item = entry[name]
      if (Array.isArray(item)) {
        item.forEach((subItem) => {
          itemToPlugin(context, subItem, name).apply(compiler)
        })
      } else {
        itemToPlugin(context, item, name).apply(compiler)
      }
    })
  }
}

function itemToPlugin(context, item, name) {
  return new EntryPlugin(context, item, { name })
}

module.exports = {
  runChildCompiler,
  getRootCompiler,
  getBestModuleExport,
  normalizeEntry,
  applyEntry,
}
