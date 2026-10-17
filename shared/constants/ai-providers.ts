const TRAILING_SLASH = /\/$/;
export const AI_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    endpointUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    endpointUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-3.5-flash-lite",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    endpointUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
  },
  { id: "custom", name: "", endpointUrl: "", model: "" },
] as const;
export function aiProviderId(endpoint: string) {
  return (
    AI_PROVIDERS.find(
      (provider) =>
        provider.endpointUrl &&
        endpoint.replace(TRAILING_SLASH, "") ===
          provider.endpointUrl.replace(TRAILING_SLASH, "")
    )?.id ?? "custom"
  );
}
