import { describe, expect, it } from "vite-plus/test";

import { promptEnhancementLoadingToast } from "./promptEnhancementToast";

describe("prompt enhancement loading toast", () => {
  it("communicates that the whole prompt is being enhanced", () => {
    expect(promptEnhancementLoadingToast(false)).toMatchObject({
      type: "loading",
      title: "Enhancing prompt…",
      timeout: 0,
    });
  });

  it("communicates when only a selection is being enhanced", () => {
    expect(promptEnhancementLoadingToast(true)).toMatchObject({
      type: "loading",
      title: "Enhancing selection…",
      timeout: 0,
    });
  });

  it("provides a cancel action without overriding the loading spinner", () => {
    const onCancel = () => {};
    const toast = promptEnhancementLoadingToast(false, onCancel);

    expect(toast.data).toMatchObject({
      additionalActions: [
        {
          id: "cancel",
          props: {
            children: "Cancel",
            disabled: false,
            onClick: onCancel,
          },
        },
      ],
    });
    expect(toast.data?.leadingIcon).toBeUndefined();
  });

  it("uses the shared disabled button state while cancelling", () => {
    const toast = promptEnhancementLoadingToast(false, () => {}, true);

    expect(toast.data?.additionalActions?.[0]?.props).toMatchObject({
      children: "Cancel",
      disabled: true,
    });
  });

  it("previews streamed enhancement text", () => {
    expect(
      promptEnhancementLoadingToast(false, undefined, false, "A clearer prompt"),
    ).toMatchObject({
      description: "A clearer prompt",
    });
  });
});
