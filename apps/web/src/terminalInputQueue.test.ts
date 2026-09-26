import { describe, expect, it } from "vite-plus/test";
import { createTerminalInputQueue } from "./terminalInputQueue";

describe("terminal input during attach", () => {
  it("waits for the session and sends early input in order", async () => {
    const sent: string[] = [];
    const queue = createTerminalInputQueue(async (data: string) => {
      sent.push(data);
    });

    queue.push("a");
    queue.push("b");
    expect(sent).toEqual([]);

    await queue.setReady(true);
    expect(sent).toEqual(["a", "b"]);
  });

  it("drops pending input when the viewport is disposed", async () => {
    const sent: string[] = [];
    const queue = createTerminalInputQueue(async (data: string) => {
      sent.push(data);
    });

    queue.push("stale");
    queue.dispose();
    await queue.setReady(true);

    expect(sent).toEqual([]);
  });
});
