// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AgentForm } from "../settings-ai-tab";

const DISPLAY_NAME = /Display Name/;
const AGENT_ID = /Agent ID/;
const INSTRUCTIONS = /System Instructions/;
const KEYWORDS = /Handoff Keywords/;
const VECTOR_STORE = /Vector Store ID/;
const MODEL = /Model/;
const TEMPERATURE = /Temperature/;
const ACTIVE = /Active/;
const LOCAL_TOOL = /queryDatabase/;
const AGENT_ID_HELP = /Unique identifier used internally/;

function renderForm(props: Partial<React.ComponentProps<typeof AgentForm>>) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AgentForm
        initial={{
          displayName: "",
          enabledHostedTools: [],
          handoffKeywords: "",
          instructions: "",
          isActive: true,
          model: "",
          name: "",
          temperature: "",
          toolNames: [],
          vectorStoreId: "",
        }}
        isEdit={false}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        t={((key: string) => i18n.t(key)) as (key: string) => string}
        {...props}
      />
    </I18nextProvider>
  );
}

describe("AgentForm", () => {
  it("gives every control an accessible name, so nothing is a bare box", () => {
    renderForm({});

    for (const label of [
      DISPLAY_NAME,
      AGENT_ID,
      INSTRUCTIONS,
      KEYWORDS,
      VECTOR_STORE,
      MODEL,
      TEMPERATURE,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("ties the help text to its control instead of leaving it floating", () => {
    renderForm({});

    expect(screen.getByLabelText(AGENT_ID)).toHaveAccessibleDescription(
      AGENT_ID_HELP
    );
  });

  it("marks the two required fields, which the server also enforces", () => {
    renderForm({});

    expect(screen.getByLabelText(DISPLAY_NAME)).toBeRequired();
    expect(screen.getByLabelText(AGENT_ID)).toBeRequired();
  });

  it("locks the agent id when editing, since renaming would orphan its prompts", () => {
    renderForm({ isEdit: true });

    expect(screen.getByLabelText(AGENT_ID)).toBeDisabled();
  });

  it("exposes the active flag as a named switch", () => {
    renderForm({});

    expect(screen.getByRole("switch", { name: ACTIVE })).toBeChecked();
  });

  it("lets a local tool be toggled from its own label", () => {
    renderForm({});

    const checkbox = screen.getByRole("checkbox", { name: LOCAL_TOOL });
    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it("keeps a hosted tool under its translated name, not its internal id", () => {
    renderForm({});

    expect(
      screen.getByRole("checkbox", { name: "Web Search" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "File Search" })
    ).toBeInTheDocument();
  });
});
