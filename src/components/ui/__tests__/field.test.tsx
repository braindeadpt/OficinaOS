// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("Field", () => {
  it("labels the control through htmlFor and id", () => {
    render(
      <Field label="Full name">
        <Input />
      </Field>
    );
    const input = screen.getByLabelText("Full name");
    expect(input).toBeInTheDocument();
  });

  it("keeps an id the caller set on the control", () => {
    render(
      <Field label="Email">
        <Input id="my-email" />
      </Field>
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "my-email");
  });

  it("describes the control with the hint", () => {
    render(
      <Field hint="We only use this for receipts." label="Email">
        <Input />
      </Field>
    );
    const hint = screen.getByText("We only use this for receipts.");
    const input = screen.getByLabelText("Email");
    expect(hint).toBeInTheDocument();
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("marks the control invalid and announces the error", () => {
    render(
      <Field error="That email is not valid." label="Email">
        <Input />
      </Field>
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("That email is not valid.");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("drops the hint reference from aria-describedby once an error shows", () => {
    render(
      <Field error="Too short." hint="At least 8 characters." label="Password">
        <Input />
      </Field>
    );
    const input = screen.getByLabelText("Password");
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const error = screen.getByRole("alert");
    // Every referenced id must exist in the document.
    for (const ref of ids) {
      expect(document.getElementById(ref)).not.toBeNull();
    }
    expect(ids).toContain(error.id);
  });

  it("replaces the hint with the error so only one shows", () => {
    render(
      <Field error="Too short." hint="At least 8 characters." label="Password">
        <Input />
      </Field>
    );
    expect(
      screen.queryByText("At least 8 characters.")
    ).not.toBeInTheDocument();
  });

  it("leaves the control valid when there is no error", () => {
    render(
      <Field label="Email">
        <Input />
      </Field>
    );
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });

  it("gives every field a unique id", () => {
    render(
      <>
        <Field label="First">
          <Input />
        </Field>
        <Field label="Second">
          <Input />
        </Field>
      </>
    );
    expect(screen.getByLabelText("First").id).not.toBe(
      screen.getByLabelText("Second").id
    );
  });

  it("shows a required marker", () => {
    render(
      <Field label="Name" required>
        <Input required />
      </Field>
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });
});
