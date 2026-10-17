// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowStatesManager } from "@/components/modules/tasks/workflow-states-manager";
import TasksPage from "..";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ default: mocks }));
vi.mock("@/hooks/use-can", () => ({ useCan: () => true }));
vi.mock("@/hooks/use-technicians", () => ({
  useTechnicians: () => ({ technicians: [] }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
function translate(key: string) {
  return key;
}
describe("workflow configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.post.mockResolvedValue({});
    mocks.get.mockImplementation((url) =>
      Promise.resolve({
        data: {
          data:
            url === "/workflow/states"
              ? [
                  {
                    id: "rma-state",
                    entityType: "RMA",
                    name: "Await replacement",
                    isActive: true,
                  },
                  {
                    id: "job-state",
                    entityType: "JOB",
                    name: "Job only",
                    isActive: true,
                  },
                ]
              : [],
        },
      })
    );
  });
  it("filters automatic triggers by the selected section", async () => {
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith("/workflow/states")
    );
    fireEvent.change(screen.getByRole("combobox", { name: "tasks.mode" }), {
      target: { value: "rule" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "tasks.section" }), {
      target: { value: "RMA" },
    });
    const trigger = screen.getByRole("combobox", { name: "tasks.trigger" });
    expect(
      within(trigger).getByRole("option", {
        name: "workflow.types.RMA · Await replacement",
      })
    ).toBeInTheDocument();
    expect(
      within(trigger).queryByRole("option", {
        name: "workflow.types.JOB · Job only",
      })
    ).not.toBeInTheDocument();
    expect(
      within(trigger).queryByRole("option", { name: "status.IN_REPAIR" })
    ).not.toBeInTheDocument();
    fireEvent.change(trigger, { target: { value: "WORKFLOW:rma-state" } });
    fireEvent.change(screen.getByRole("textbox", { name: "tasks.name" }), {
      target: { value: "Contact supplier" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/tasks/rules",
        expect.objectContaining({
          entityType: "RMA",
          workflowStateId: "rma-state",
          title: "Contact supplier",
        })
      )
    );
  });
  it("allows creating statuses before any orders exist", async () => {
    mocks.get.mockResolvedValue({ data: { data: [] } });
    render(<WorkflowStatesManager entityType="ORDER" />);
    const summary = screen.getByText(
      "workflow.manage_states · workflow.types.ORDER"
    );
    const details = summary.closest("details");
    if (!details) {
      throw new Error("Missing status manager");
    }
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("tasks.no_states")).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "workflow.state_name" }),
      { target: { value: "Await dispatch" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "tasks.add_state" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/workflow/states", {
        entityType: "ORDER",
        name: "Await dispatch",
      })
    );
  });
  it("edits a saved automatic rule with its original section", async () => {
    const fixtures = {
      "/tasks/rules": [
        {
          id: "rule1",
          isActive: true,
          title: "Call supplier",
          notes: null,
          priority: "HIGH",
          assigneeId: null,
          nextTitle: null,
          nextDelayHours: 0,
          delayHours: 2,
          triggerStatus: null,
          workflowStateId: "rma-state",
          workflowState: { name: "Await replacement", entityType: "RMA" },
        },
      ],
      "/workflow/states": [
        {
          id: "rma-state",
          name: "Await replacement",
          entityType: "RMA",
          isActive: true,
        },
      ],
    };
    mocks.get.mockImplementation((url: keyof typeof fixtures) =>
      Promise.resolve({ data: { data: fixtures[url] ?? [] } })
    );
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    mocks.patch.mockResolvedValue({});
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    expect(screen.getByRole("combobox", { name: "tasks.section" })).toHaveValue(
      "RMA"
    );
    fireEvent.change(screen.getByRole("textbox", { name: "tasks.name" }), {
      target: { value: "Check replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "/tasks/rules/rule1",
        expect.objectContaining({
          title: "Check replacement",
          entityType: "RMA",
          workflowStateId: "rma-state",
        })
      )
    );
  });
});
