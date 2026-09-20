import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AnimatedText } from "./changing-state";

describe("changing-state motion", () => {
  it("keeps changing text accessible as one label while staggering its visible words", () => {
    const markup = renderToStaticMarkup(
      <AnimatedText value="Improve shared history" changeKey="environment:thread" />,
    );

    expect(markup).toContain('aria-label="Improve shared history"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("--changing-text-index:0");
    expect(markup).toContain("--changing-text-index:2");
  });
});
