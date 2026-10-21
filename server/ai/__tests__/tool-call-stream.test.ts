import { describe, expect, it } from "vitest";
import {
  type AccumulatedToolCall,
  accumulateToolDelta,
} from "../tool-call-stream.js";

describe("compatible AI tool streams", () => {
  it("preserves Gemini thought signatures on the corresponding parallel tool call", () => {
    const calls = new Map<number, AccumulatedToolCall>();
    accumulateToolDelta(calls, {
      index: 0,
      id: "first",
      function: { name: "queryDatabase", arguments: '{"sql":' },
      extra_content: {
        google: { thought_signature: "opaque-provider-signature" },
      },
    });
    accumulateToolDelta(calls, {
      index: 1,
      id: "second",
      function: { name: "getSchema", arguments: "{" },
    });
    accumulateToolDelta(calls, {
      index: 0,
      function: { arguments: '"SELECT 1"}' },
    });
    accumulateToolDelta(calls, { index: 1, function: { arguments: "}" } });
    expect(calls.get(0)).toEqual({
      id: "first",
      function: { name: "queryDatabase", arguments: '{"sql":"SELECT 1"}' },
      extra_content: {
        google: { thought_signature: "opaque-provider-signature" },
      },
    });
    expect(calls.get(1)).toEqual({
      id: "second",
      function: { name: "getSchema", arguments: "{}" },
    });
  });
  it("accepts metadata arriving after the first chunk without losing arguments", () => {
    const calls = new Map<number, AccumulatedToolCall>();
    expect(
      accumulateToolDelta(calls, {
        index: 0,
        id: "t1",
        function: { name: "getSchema", arguments: "{}" },
      })
    ).toBe(true);
    expect(
      accumulateToolDelta(calls, {
        index: 0,
        extra_content: { google: { thought_signature: "signature" } },
      })
    ).toBe(false);
    expect(calls.get(0)?.function.arguments).toBe("{}");
    expect(calls.get(0)?.extra_content?.google?.thought_signature).toBe(
      "signature"
    );
  });
});
