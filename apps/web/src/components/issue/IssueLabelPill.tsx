import { Badge } from "../ui/badge";
import { issueLabelForeground, normalizeIssueLabelColor } from "./issue.logic";

export function IssueLabelPill({
  name,
  color,
}: {
  readonly name: string;
  readonly color?: string | null | undefined;
}) {
  const backgroundColor = normalizeIssueLabelColor(color);
  return (
    <Badge
      size="sm"
      variant="secondary"
      style={
        backgroundColor === null
          ? undefined
          : {
              backgroundColor,
              borderColor: backgroundColor,
              color: issueLabelForeground(backgroundColor),
            }
      }
    >
      {name}
    </Badge>
  );
}
