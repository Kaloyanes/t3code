import { stackedThreadToast } from "../ui/toastHelpers";

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
