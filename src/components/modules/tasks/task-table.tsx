import {
  WORKFLOW_PERMISSIONS,
  type WorkflowType,
} from "@shared/constants/workflow";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useCan } from "@/hooks/use-can";
import { TaskEditor } from "./task-editor";
export interface TaskRecord {
  assignee: { name: string; username: string } | null;
  assigneeId?: string | null;
  canComplete?: boolean;
  canEdit?: boolean;
  completedAt?: string | null;
  dueAt: string | null;
  entityId: string | null;
  entityType: WorkflowType;
  id: string;
  job: { id: string; jobCode: string } | null;
  nextDelayHours?: number;
  nextTitle?: string | null;
  notes: string | null;
  priority?: string;
  scheduledAt: string;
  title: string;
}
export function TaskTable({
  tasks,
  busy,
  onComplete,
  onChanged,
}: {
  tasks: TaskRecord[];
  busy: boolean;
  onComplete: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<TaskRecord | null>(null);
  return (
    <>
      <div className="max-h-[32rem] overflow-auto rounded-xl border border-outline-variant/30">
        <table
          aria-label={t("tasks.title")}
          className="w-full text-left text-sm"
        >
          <thead className="sticky top-0 bg-surface-container-high text-on-surface-variant">
            <tr>
              {[
                "tasks.name",
                "tasks.section",
                "tasks.assignee",
                "tasks.priority",
                "tasks.scheduled",
                "tasks.due",
                "tasks.state",
                "tasks.actions",
              ].map((key) => (
                <th
                  className="whitespace-nowrap px-4 py-3"
                  key={key}
                  scope="col"
                >
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30">
            {tasks.map((task) => (
              <TaskTableRow
                busy={busy}
                key={task.id}
                onComplete={onComplete}
                onEdit={setEditing}
                task={task}
              />
            ))}
            {tasks.length === 0 && (
              <tr>
                <td
                  className="p-5 text-center text-on-surface-variant"
                  colSpan={8}
                >
                  {t("workflow.no_tasks")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <TaskEditor
          key={editing.id}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
          task={editing}
        />
      )}
    </>
  );
}
function TaskTableRow({
  task,
  busy,
  onComplete,
  onEdit,
}: {
  task: TaskRecord;
  busy: boolean;
  onComplete: (id: string) => Promise<void>;
  onEdit: (task: TaskRecord) => void;
}) {
  const { t } = useTranslation();
  const edit = useCan(WORKFLOW_PERMISSIONS[task.entityType ?? "GENERAL"].edit);
  const due = task.dueAt ? new Date(task.dueAt) : null;
  return (
    <tr className="bg-surface-container-low align-top hover:bg-surface-container">
      <td className="min-w-52 px-4 py-3">
        <p className="font-semibold">{task.title}</p>
        {task.notes && (
          <p className="mt-1 whitespace-pre-wrap text-on-surface-variant text-xs">
            {task.notes}
          </p>
        )}
        {task.nextTitle && (
          <p className="mt-1 text-xs">
            {t("tasks.next")}: {task.nextTitle}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        {t(`workflow.types.${task.entityType ?? "GENERAL"}`)}
        {task.job && (
          <Link
            className="block text-primary underline"
            to={`/jobs/${task.job.id}`}
          >
            {task.job.jobCode}
          </Link>
        )}
      </td>
      <td className="px-4 py-3">
        {task.assignee?.name ||
          task.assignee?.username ||
          t("tasks.unassigned")}
      </td>
      <td className="px-4 py-3">{t(`tasks.${task.priority ?? "NORMAL"}`)}</td>
      <td className="whitespace-nowrap px-4 py-3">
        {new Date(task.scheduledAt).toLocaleString()}
      </td>
      <td
        className={`whitespace-nowrap px-4 py-3 ${due && !task.completedAt && due.getTime() < Date.now() ? "text-error" : ""}`}
      >
        {due?.toLocaleString() ?? "—"}
      </td>
      <td className="px-4 py-3">
        {t(task.completedAt ? "tasks.completed" : "tasks.pending")}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          {!task.completedAt && (task.canEdit ?? edit) && (
            <Button disabled={busy} onClick={() => onEdit(task)}>
              {t("edit")}
            </Button>
          )}
          {!task.completedAt && (task.canComplete ?? edit) && (
            <Button disabled={busy} onClick={() => onComplete(task.id)}>
              {t("tasks.complete")}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
