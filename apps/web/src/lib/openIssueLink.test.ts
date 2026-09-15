import { describe, expect, it } from "vite-plus/test";

import { issueLinkExternalUrl, parseIssueUrl, shouldOpenIssueExternally } from "./openIssueLink";

describe("parseIssueUrl", () => {
  it("parses GitHub issue URLs without confusing pull requests", () => {
    expect(parseIssueUrl("https://github.com/pingdotgg/t3code/issues/123#issuecomment-9")).toEqual({
      host: "github.com",
      repository: "pingdotgg/t3code",
      number: 123,
    });
    expect(parseIssueUrl("https://github.com/pingdotgg/t3code/pull/123")).toBeNull();
  });

  it.each([
    "https://github.com/pingdotgg/t3code/issues/not-a-number",
    "https://github.com/pingdotgg/issues/1",
    "file:///pingdotgg/t3code/issues/1",
  ])("rejects malformed issue URL %s", (url) => {
    expect(parseIssueUrl(url)).toBeNull();
  });
});

describe("issue link navigation", () => {
  it("keeps command-click and control-click external", () => {
    expect(shouldOpenIssueExternally({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(shouldOpenIssueExternally({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(shouldOpenIssueExternally({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("builds the canonical external issue URL", () => {
    expect(
      issueLinkExternalUrl({ host: "github.acme.test", repository: "platform/api", number: 42 }),
    ).toBe("https://github.acme.test/platform/api/issues/42");
  });
});
