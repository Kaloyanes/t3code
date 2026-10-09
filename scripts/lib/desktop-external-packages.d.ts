/**
 * Packages the desktop main-process bundle must NOT inline.
 *
 * The desktop bundle follows the same policy as the server CLI bundle (see
 * cli-external-packages.ts): everything is inlined except what Node has to
 * load from the real filesystem. Both `apps/desktop/vite.config.ts` and the
 * artifact stage in scripts/build-desktop-artifact.ts derive from this list,
 * so a package that is external is also the only kind of package the staged
 * production install carries. Anything not listed here ships inside
 * `dist-electron/*.cjs` and has no `node_modules` presence at all.
 *
 * Entries are matched as prefixes so platform-specific siblings are covered.
 */
export declare const DESKTOP_RUNTIME_EXTERNAL_PREFIXES: readonly [
  "@napi-rs/keyring",
  "@crowecawcaw/xa11y",
  "@clerk/electron-passkeys",
  "ffi-rs",
  "@yuuang/",
  "playwright-core",
];
export declare function isDesktopRuntimeExternalDependency(id: string): boolean;
/** Select the desktop dependency roots whose runtime closure the stage must install. */
export declare function selectDesktopRuntimeExternalDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string>;
