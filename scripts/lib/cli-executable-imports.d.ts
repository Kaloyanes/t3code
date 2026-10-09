/**
 * Scan an emitted bundle chunk for ESM imports of packages that are not Node
 * built-ins.
 *
 * Inside a Node single-executable, `import` statements and `import()` can only
 * resolve built-in modules; any file-backed specifier throws at module
 * evaluation (static) or at first use (dynamic). External packages therefore
 * have to be reached through `createRequire`, which reads the real filesystem
 * in every runtime. The bundler cannot enforce this, so the check reads what it
 * produced.
 */
export declare function findEsmImportsOfExternalPackages(source: string): ReadonlyArray<string>;
