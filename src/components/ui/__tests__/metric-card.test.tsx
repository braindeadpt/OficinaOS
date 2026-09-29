// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetricCard } from "@/components/ui/metric-card";

vi.mock("@/components/ui/icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid="icon">{name}</span>,
}));

describe("MetricCard", () => {
  it("renders label, value, and detail", () => {
    render(
      <MetricCard detail="all" icon="inventory_2" label="Parts" value="42" />
    );
    expect(screen.getByText("Parts")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("all")).toBeInTheDocument();
  });

  it("renders unit when provided", () => {
    render(
      <MetricCard
        detail=""
        icon="payments"
        label="Revenue"
        unit="EUR"
        value="452k"
      />
    );
    expect(screen.getByText("EUR")).toBeInTheDocument();
  });

  it("renders children slot", () => {
    render(
      <MetricCard detail="" icon="check" label="Done" value="12">
        <div>slot content</div>
      </MetricCard>
    );
    expect(screen.getByText("slot content")).toBeInTheDocument();
  });
});
