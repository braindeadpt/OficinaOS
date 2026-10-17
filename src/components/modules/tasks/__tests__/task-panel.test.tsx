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
import { TaskPanel } from "../task-panel";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/hooks/use-technicians", () => ({
  useTechnicians: () => ({ technicians: [] }),
}));
vi.mock("@/lib/api", () => ({ default: mocks }));
vi.mock("@/hooks/use-can", () => ({ useCan: () => true }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
function translate(key: string) {
  return key;
}
describe("embedded repair tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({
      data: {
        data: [
          {
            id: "t1",
            title: "Order screen",
            entityType: "JOB",
            entityId: "j1",
            job: { id: "j1", jobCode: "OS-1" },
            assignee: null,
            scheduledAt: "2026-10-17T12:00:00Z",
            dueAt: null,
            notes: null,
          },
        ],
        nextCursor: null,
      },
    });
    mocks.post.mockResolvedValue({});
  });
  it("shows repair tasks and completes them from the repair panel", async () => {
    render(
      <MemoryRouter>
        <TaskPanel entityId="j1" entityType="JOB" />
      </MemoryRouter>
    );
    expect(await screen.findByText("Order screen")).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith("/tasks", {
      params: { entityType: "JOB", entityId: "j1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "tasks.complete" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/tasks/t1/complete")
    );
  });
  it("preserves the repair association and next task when creating inline", async () => {
    render(
      <MemoryRouter>
        <TaskPanel entityId="j1" entityType="JOB" />
      </MemoryRouter>
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "tasks.task_title" }),
      { target: { value: "Order battery" } }
    );
    fireEvent.change(screen.getByRole("textbox", { name: "tasks.next" }), {
      target: { value: "Await receipt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/tasks", {
        title: "Order battery",
        nextTitle: "Await receipt",
        entityType: "JOB",
        entityId: "j1",
      })
    );
  });

  it("edits a task from its table row", async () => {
    mocks.patch.mockResolvedValue({});
    render(
      <MemoryRouter>
        <TaskPanel entityId="j1" entityType="JOB" />
      </MemoryRouter>
    );
    await screen.findByText("Order screen");
    expect(
      screen.getByRole("table", { name: "tasks.title" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    const dialog = await screen.findByRole("dialog", {
      name: "tasks.edit_task",
    });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "tasks.name" }),
      { target: { value: "Await delivery" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "/tasks/t1",
        expect.objectContaining({
          title: "Await delivery",
          dueAt: null,
          assigneeId: null,
        })
      )
    );
  });
});
