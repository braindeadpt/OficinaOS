import { JobStatus } from "@shared/constants/job-statuses";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Can } from "@/components/modules/can";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/hooks/use-can";
import { useTechnicians } from "@/hooks/use-technicians";
import api from "@/lib/api";

interface Task {
  assignee: { name: string; username: string } | null;
  completedAt: string | null;
  dueAt: string | null;
  id: string;
  job: { id: string; jobCode: string } | null;
  nextTitle: string | null;
  notes: string | null;
  priority: string;
  scheduledAt: string;
  title: string;
}
interface Rule {
  id: string;
  isActive: boolean;
  title: string;
  triggerStatus: string;
}

export default function TasksPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const jobId = params.get("jobId") || undefined;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [completed, setCompleted] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"task" | "rule">("task");
  const canRules = useCan({ settings: ["edit"] });
  const { technicians } = useTechnicians();
  const [form, setForm] = useState({
    title: "",
    notes: "",
    jobCode: params.get("jobCode") || "",
    assigneeId: "",
    priority: "NORMAL",
    scheduledAt: "",
    dueAt: "",
    nextTitle: "",
    nextDelayHours: "0",
    triggerStatus: "WAITING_FOR_PARTS",
    delayHours: "0",
  });
  const set = (patch: Partial<typeof form>) =>
    setForm((old) => ({ ...old, ...patch }));
  const load = useCallback(async () => {
    try {
      const res = await api.get("/tasks", {
        params: { completed: String(completed), jobId },
      });
      setTasks(res.data.data);
      setNextCursor(res.data.nextCursor);
      if (canRules) {
        setRules((await api.get("/tasks/rules")).data.data);
      }
    } catch {
      toast.error(t("tasks.failed"));
    }
  }, [completed, jobId, canRules, t]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const common = {
      title: form.title,
      notes: form.notes || undefined,
      assigneeId: form.assigneeId || undefined,
      priority: form.priority,
      nextTitle: form.nextTitle || undefined,
      nextDelayHours: Number(form.nextDelayHours),
    };
    try {
      if (mode === "rule") {
        await api.post("/tasks/rules", {
          ...common,
          triggerStatus: form.triggerStatus,
          delayHours: Number(form.delayHours),
        });
      } else {
        await api.post("/tasks", {
          ...common,
          jobCode: form.jobCode || undefined,
          scheduledAt: form.scheduledAt
            ? new Date(form.scheduledAt).toISOString()
            : undefined,
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
        });
      }
      set({ title: "", notes: "", nextTitle: "" });
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
  const disableRule = async (id: string) => {
    try {
      await api.patch(`/tasks/rules/${id}/disable`);
      await load();
    } catch {
      toast.error(t("tasks.failed"));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-bold text-2xl">{t("tasks.title")}</h1>
      <Can perm={{ jobs: ["edit"] }}>
        <form
          className="space-y-4 rounded-xl bg-surface-container-low p-5"
          onSubmit={save}
        >
          {canRules && (
            <Field label={t("tasks.mode")}>
              <Select
                onChange={(e) => setMode(e.target.value as "task" | "rule")}
                value={mode}
              >
                <option value="task">{t("tasks.new")}</option>
                <option value="rule">{t("tasks.rule")}</option>
              </Select>
            </Field>
          )}
          <Field label={t("tasks.name")} required>
            <Input
              maxLength={200}
              onChange={(e) => set({ title: e.target.value })}
              required
              value={form.title}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === "task" ? (
              <Field label={t("rmas.job_code")}>
                <Input
                  onChange={(e) => set({ jobCode: e.target.value })}
                  value={form.jobCode}
                />
              </Field>
            ) : (
              <Field label={t("tasks.trigger")}>
                <Select
                  onChange={(e) => set({ triggerStatus: e.target.value })}
                  value={form.triggerStatus}
                >
                  {Object.values(JobStatus).map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t("tasks.assignee")}>
              <Select
                onChange={(e) => set({ assigneeId: e.target.value })}
                value={form.assigneeId}
              >
                <option value="">{t("tasks.unassigned")}</option>
                {technicians.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("tasks.priority")}>
              <Select
                onChange={(e) => set({ priority: e.target.value })}
                value={form.priority}
              >
                {["LOW", "NORMAL", "HIGH"].map((p) => (
                  <option key={p} value={p}>
                    {t(`tasks.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {mode === "task" ? (
              <>
                <Field label={t("tasks.scheduled")}>
                  <Input
                    onChange={(e) => set({ scheduledAt: e.target.value })}
                    type="datetime-local"
                    value={form.scheduledAt}
                  />
                </Field>
                <Field label={t("tasks.due")}>
                  <Input
                    onChange={(e) => set({ dueAt: e.target.value })}
                    type="datetime-local"
                    value={form.dueAt}
                  />
                </Field>
              </>
            ) : (
              <Field label={t("tasks.delay")}>
                <Input
                  max={8760}
                  min={0}
                  onChange={(e) => set({ delayHours: e.target.value })}
                  type="number"
                  value={form.delayHours}
                />
              </Field>
            )}
            <Field label={t("tasks.next")}>
              <Input
                maxLength={200}
                onChange={(e) => set({ nextTitle: e.target.value })}
                value={form.nextTitle}
              />
            </Field>
            <Field label={t("tasks.next_delay")}>
              <Input
                max={8760}
                min={0}
                onChange={(e) => set({ nextDelayHours: e.target.value })}
                type="number"
                value={form.nextDelayHours}
              />
            </Field>
          </div>
          <Field label={t("tasks.notes")}>
            <Textarea
              maxLength={4000}
              onChange={(e) => set({ notes: e.target.value })}
              value={form.notes}
            />
          </Field>
          {mode === "rule" && <p className="text-sm">{t("tasks.rule_hint")}</p>}
          <Button loading={busy} type="submit">
            {t("save")}
          </Button>
        </form>
      </Can>
      <label className="flex gap-2">
        <input
          checked={completed}
          onChange={(e) => setCompleted(e.target.checked)}
          type="checkbox"
        />
        {t("tasks.show_completed")}
      </label>
      {tasks.map((task) => (
        <article
          className="space-y-2 rounded-xl bg-surface-container-low p-4"
          key={task.id}
        >
          <h2 className="font-bold">
            {task.title} · {t(`tasks.${task.priority}`)}
          </h2>
          {task.job && (
            <Link
              className="text-primary underline"
              to={`/jobs/${task.job.id}`}
            >
              {task.job.jobCode}
            </Link>
          )}
          <p>
            {task.assignee?.name ||
              task.assignee?.username ||
              t("tasks.unassigned")}
          </p>
          <p>
            {t("tasks.scheduled")}:{" "}
            {new Date(task.scheduledAt).toLocaleString()}
          </p>
          {task.dueAt && (
            <p>
              {t("tasks.due")}: {new Date(task.dueAt).toLocaleString()}
            </p>
          )}
          {task.notes && <p className="whitespace-pre-wrap">{task.notes}</p>}
          {task.nextTitle && (
            <p>
              {t("tasks.next")}: {task.nextTitle}
            </p>
          )}
          {!task.completedAt && (
            <Can perm={{ jobs: ["edit"] }}>
              <Button disabled={busy} onClick={() => complete(task.id)}>
                {t("tasks.complete")}
              </Button>
            </Can>
          )}
        </article>
      ))}
      {nextCursor && (
        <Button
          onClick={async () => {
            try {
              const res = await api.get("/tasks", {
                params: {
                  completed: String(completed),
                  jobId,
                  cursor: nextCursor,
                },
              });
              setTasks((old) => [...old, ...res.data.data]);
              setNextCursor(res.data.nextCursor);
            } catch {
              toast.error(t("tasks.failed"));
            }
          }}
        >
          {t("tasks.more")}
        </Button>
      )}
      {canRules && (
        <section className="space-y-3">
          <h2 className="font-bold">{t("tasks.rules")}</h2>
          {rules
            .filter((r) => r.isActive)
            .map((rule) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-4"
                key={rule.id}
              >
                <span>
                  {rule.title} · {t(`status.${rule.triggerStatus}`)}
                </span>
                <Button onClick={() => disableRule(rule.id)}>
                  {t("tasks.disable")}
                </Button>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
