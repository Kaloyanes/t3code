import { createElement } from "react";
import { PenLineIcon, SparklesIcon } from "lucide-react";

import { stackedThreadToast } from "../ui/toastHelpers";

const promptEnhancementIcon = createElement(
  "span",
  { className: "relative size-4", "aria-hidden": true },
  createElement(PenLineIcon, { className: "absolute inset-0 size-4" }),
  createElement(SparklesIcon, { className: "absolute -end-1 -top-1 size-2.5" }),
);

export function promptEnhancementLoadingToast(
  enhancingSelection: boolean,
  onCancel?: () => void,
  cancelDisabled = false,
) {
  return stackedThreadToast({
    type: "loading",
    title: enhancingSelection ? "Enhancing selection…" : "Enhancing prompt…",
    timeout: 0,
    data: {
      leadingIcon: promptEnhancementIcon,
      ...(onCancel
        ? {
            additionalActions: [
              {
                id: "cancel",
                props: {
                  children: "Cancel",
                  disabled: cancelDisabled,
                  onClick: onCancel,
                },
              },
            ],
          }
        : {}),
    },
  });
}
