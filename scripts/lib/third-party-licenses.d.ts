import type { Plugin } from "vite-plus";
export declare const THIRD_PARTY_LICENSES_FILE_NAME = "third-party-licenses.json";
export interface ThirdPartyLicenseEntry {
  readonly bundles: ReadonlyArray<string>;
  readonly kind: "custom" | "package";
  readonly license: string;
  readonly name: string;
  readonly noticeText: string;
  readonly sourceUrl: string | null;
  readonly version: string | null;
}
export interface ThirdPartyLicenseManifest {
  readonly schemaVersion: 1;
  readonly entries: ReadonlyArray<ThirdPartyLicenseEntry>;
}
export interface ThirdPartyLicensePackageManifest {
  readonly bundle: string;
  readonly path: string | URL;
}
export interface ThirdPartyLicensesPluginOptions {
  readonly configFile?: string | URL;
  readonly packageManifests: ReadonlyArray<ThirdPartyLicensePackageManifest>;
  readonly bundleName: string;
}
export declare function syncThirdPartyLicenseNotices(configFile: string | URL): Promise<void>;
export declare function generateThirdPartyLicenseManifest(input: {
  readonly configFile?: string | URL;
  readonly packageManifests: ReadonlyArray<ThirdPartyLicensePackageManifest>;
  readonly bundledModuleIds?: ReadonlyArray<string>;
  readonly bundleName?: string;
  readonly allowMissingGeneratedNotices?: boolean;
}): Promise<ThirdPartyLicenseManifest>;
export declare function thirdPartyLicensesPlugin(options: ThirdPartyLicensesPluginOptions): Plugin;
