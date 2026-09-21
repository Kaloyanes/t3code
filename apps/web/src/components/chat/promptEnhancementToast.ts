import { stackedThreadToast } from "../ui/toastHelpers";

export function promptEnhancementLoadingToast(
  enhancingSelection: boolean,
  onCancel?: () => void,
  cancelDisabled = false,
  preview?: string,
) {
  return stackedThreadToast({
    type: "loading",
    title: enhancingSelection ? "Enhancing selection…" : "Enhancing prompt…",
    ...(preview === undefined ? {} : { description: preview }),
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
