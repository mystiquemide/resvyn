// Minimal ESM loader: append .ts when extensionless relative imports fail to resolve.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw err
  }
}
