import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { IssueLabelPill } from "./IssueLabelPill";

describe("IssueLabelPill", () => {
  it("uses the normalized label color and readable foreground while preserving the name", () => {
    const markup = renderToStaticMarkup(<IssueLabelPill name="bug" color="#B60205" />);

    expect(markup).toContain("bug");
    expect(markup).toContain("background-color:#b60205");
    expect(markup).toContain("color:#ffffff");
  });

  it("keeps unknown colors on the neutral badge presentation", () => {
    const markup = renderToStaticMarkup(<IssueLabelPill name="manual label" color="not-a-color" />);

    expect(markup).toContain("manual label");
    expect(markup).toContain("bg-secondary");
    expect(markup).not.toContain("background-color");
  });
});
