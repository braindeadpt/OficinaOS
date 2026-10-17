import type OpenAI from "openai";

interface GeminiMetadata {
  google?: { thought_signature?: string };
}
export interface AccumulatedToolCall {
  extra_content?: GeminiMetadata;
  function: { name: string; arguments: string };
  id: string;
}
type ToolDelta = OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall & {
  extra_content?: GeminiMetadata;
};

/** Keep parallel tool fragments separate and return Gemini metadata unchanged. */
export function accumulateToolDelta(
  calls: Map<number, AccumulatedToolCall>,
  delta: ToolDelta
) {
  let call = calls.get(delta.index);
  const isNew = !call;
  if (!call) {
    call = { id: delta.id ?? "", function: { name: "", arguments: "" } };
    calls.set(delta.index, call);
  }
  if (delta.id) {
    call.id = delta.id;
  }
  if (delta.function?.name) {
    call.function.name += delta.function.name;
  }
  if (delta.function?.arguments) {
    call.function.arguments += delta.function.arguments;
  }
  if (delta.extra_content) {
    call.extra_content = delta.extra_content;
  }
  return isNew;
}
