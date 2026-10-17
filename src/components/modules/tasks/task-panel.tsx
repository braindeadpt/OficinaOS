import {
  WORKFLOW_PERMISSIONS,
  type WorkflowType,
} from "@shared/constants/workflow";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";
import { type TaskRecord, TaskTable } from "./task-table";

export function TaskPanel({
  entityType,
  entityId,
}: {
  entityType?: WorkflowType;
  entityId?: string;
}) {
  const { t } = useTranslation();
  const canEdit = useCan(WORKFLOW_PERMISSIONS[entityType ?? "GENERAL"].edit);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [nextTitle, setNextTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/tasks", {
        params: { entityType, entityId },
      });
      setTasks(data.data);
      setNextCursor(data.nextCursor);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [entityType, entityId]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post("/tasks", {
        title,
        nextTitle: nextTitle || undefined,
        entityType,
        entityId,
      });
      setTitle("");
      setNextTitle("");
      await load();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  const complete = async (id: string) => {
    setBusy(true);
    try {
      await api.post(`/tasks/${id}/complete`);
      await load();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  const params = new URLSearchParams(
    entityType ? { entityType, ...(entityId ? { entityId } : {}) } : {}
  );
  return (
    <section className="my-5 space-y-3 rounded-2xl bg-surface-container-low p-5">
      <div className="flex justify-between gap-3">
        <h2 className="font-bold text-lg">{t("tasks.title")}</h2>
        <Link className="text-primary underline" to={`/tasks?${params}`}>
          {t("workflow.manage_tasks")}
        </Link>
      </div>
      {failed && (
        <p role="alert">
          {t("tasks.failed")}{" "}
          <Button onClick={load}>{t("workflow.retry")}</Button>
        </p>
      )}
      <TaskTable
        busy={busy}
        onChanged={load}
        onComplete={complete}
        tasks={tasks}
      />
      {nextCursor && (
        <Button
          onClick={async () => {
            try {
              const { data } = await api.get("/tasks", {
                params: { entityType, entityId, cursor: nextCursor },
              });
              setTasks((old) => [...old, ...data.data]);
              setNextCursor(data.nextCursor);
            } catch {
              toast.error(t("tasks.failed"));
            }
          }}
        >
          {t("tasks.more")}
        </Button>
      )}
      {canEdit && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={save}>
          <Field label={t("tasks.task_title")}>
            <Input
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              required
              value={title}
            />
          </Field>
          <Field label={t("tasks.next")}>
            <Input
              maxLength={200}
              onChange={(e) => setNextTitle(e.target.value)}
              value={nextTitle}
            />
          </Field>
          <Button loading={busy} type="submit">
            {t("save")}
          </Button>
        </form>
      )}
    </section>
  );
}
