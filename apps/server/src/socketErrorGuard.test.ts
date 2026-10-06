import { describe, expect, it } from "vite-plus/test";

import { isSetTypeOfServiceFailure } from "./socketErrorGuard.ts";

const errno = (code: string, syscall: string) =>
  Object.assign(new Error(`${syscall} ${code}`), { code, syscall });

describe("isSetTypeOfServiceFailure", () => {
  it("matches the undici EINVAL crash only", () => {
    expect(isSetTypeOfServiceFailure(errno("EINVAL", "setTypeOfService"))).toBe(true);
    expect(isSetTypeOfServiceFailure(errno("EINVAL", "write"))).toBe(false);
    expect(isSetTypeOfServiceFailure(errno("EPIPE", "setTypeOfService"))).toBe(false);
    expect(isSetTypeOfServiceFailure("setTypeOfService EINVAL")).toBe(false);
  });
});
