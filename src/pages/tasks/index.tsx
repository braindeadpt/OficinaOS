import { JobStatus } from "@shared/constants/job-statuses";
import {
  WORKFLOW_PERMISSIONS,
  WORKFLOW_TYPES,
  type WorkflowType,
} from "@shared/constants/workflow";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Can } from "@/components/modules/can";
import {
  type TaskRecord,
  TaskTable,
} from "@/components/modules/tasks/task-table";
import { WorkflowStatesManager } from "@/components/modules/tasks/workflow-states-manager";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/hooks/use-can";
import { useTechnicians } from "@/hooks/use-technicians";
import api from "@/lib/api";

interface Rule {
  assigneeId: string | null;
  delayHours: number;
  id: string;
  isActive: boolean;
  nextDelayHours: number;
  nextTitle: string | null;
  notes: string | null;
  priority: string;
  title: string;
  triggerStatus: string | null;
  workflowState?: { name: string; entityType: WorkflowType } | null;
  workflowStateId: string | null;
}

function ruleTrigger(value: string) {
  return value.startsWith("WORKFLOW:")
    ? { workflowStateId: value.slice(9) }
    : { triggerStatus: value };
}

function taskContext(params: URLSearchParams) {
  const kind = params.get("entityType") as WorkflowType;
  const entityType = WORKFLOW_TYPES.includes(kind) ? kind : undefined;
  return {
    entityType,
    entityId: params.get("entityId") || undefined,
    jobId: params.get("jobId") || undefined,
    initialSection:
      entityType && entityType !== "GENERAL"
        ? entityType
        : ("JOB" as WorkflowType),
  };
}

export default function TasksPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { jobId, entityType, entityId, initialSection } = taskContext(params);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [workflowStates, setWorkflowStates] = useState<
    { id: string; name: string; entityType: WorkflowType }[]
  >([]);
  const [completed, setCompleted] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ruleSection, setRuleSection] = useState<WorkflowType>(initialSection);
  const [editingRule, setEditingRule] = useState("");
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
    triggerStatus: initialSection === "JOB" ? "WAITING_FOR_PARTS" : "",
    delayHours: "0",
  });
  const set = (patch: Partial<typeof form>) =>
    setForm((old) => ({ ...old, ...patch }));
  const load = useCallback(async () => {
    try {
      const res = await api.get("/tasks", {
        params: { completed: String(completed), jobId, entityType, entityId },
      });
      setTasks(res.data.data);
      setNextCursor(res.data.nextCursor);
      if (canRules) {
        const [rulesResult, statesResult] = await Promise.all([
          api.get("/tasks/rules"),
          api.get("/workflow/states"),
        ]);
        setRules(rulesResult.data.data);
        setWorkflowStates(statesResult.data.data);
      }
    } catch {
      toast.error(t("tasks.failed"));
    }
  }, [completed, jobId, entityType, entityId, canRules, t]);
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
        const data = {
          entityType: ruleSection,
          ...common,
          ...ruleTrigger(form.triggerStatus),
          delayHours: Number(form.delayHours),
        };
        if (editingRule) {
          await api.patch(`/tasks/rules/${editingRule}`, data);
        } else {
          await api.post("/tasks/rules", data);
        }
        setEditingRule("");
      } else {
        await api.post("/tasks", {
          ...common,
          entityType,
          entityId,
          jobCode:
            entityType && entityType !== "JOB"
              ? undefined
              : form.jobCode || undefined,
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
      <h1 className="font-bold text-2xl">
        {t("tasks.title")}
        {entityType && ` · ${t(`workflow.types.${entityType}`)}`}
      </h1>
      <WorkflowStatesManager onChanged={load} />
      <Can perm={WORKFLOW_PERMISSIONS[entityType ?? "GENERAL"].edit}>
        <form
          className="space-y-4 rounded-xl bg-surface-container-low p-5"
          onSubmit={save}
        >
          {canRules && (
            <Field label={t("tasks.mode")}>
              <Select
                onChange={(e) => {
                  setMode(e.target.value as "task" | "rule");
                  setEditingRule("");
                }}
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
            {mode === "task" && (!entityType || entityType === "JOB") && (
              <Field label={t("rmas.job_code")}>
                <Input
                  onChange={(e) => set({ jobCode: e.target.value })}
                  value={form.jobCode}
                />
              </Field>
            )}
            {mode === "rule" && (
              <Field label={t("tasks.section")}>
                <Select
                  onChange={(event) => {
                    const section = event.target.value as WorkflowType;
                    setRuleSection(section);
                    set({
                      triggerStatus:
                        section === "JOB" ? "WAITING_FOR_PARTS" : "",
                    });
                  }}
                  value={ruleSection}
                >
                  {WORKFLOW_TYPES.filter((type) => type !== "GENERAL").map(
                    (type) => (
                      <option key={type} value={type}>
                        {t(`workflow.types.${type}`)}
                      </option>
                    )
                  )}
                </Select>
              </Field>
            )}
            {mode === "rule" && (
              <Field label={t("tasks.trigger")}>
                <Select
                  onChange={(e) => set({ triggerStatus: e.target.value })}
                  required
                  value={form.triggerStatus}
                >
                  <option value="">{t("tasks.select_state")}</option>
                  {workflowStates
                    .filter((state) => state.entityType === ruleSection)
                    .map((state) => (
                      <option key={state.id} value={`WORKFLOW:${state.id}`}>
                        {t(`workflow.types.${state.entityType}`)} · {state.name}
                      </option>
                    ))}
                  {(ruleSection === "JOB" ? Object.values(JobStatus) : []).map(
                    (status) => (
                      <option key={status} value={status}>
                        {t(`status.${status}`)}
                      </option>
                    )
                  )}
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
          {mode === "rule" &&
            ruleSection !== "JOB" &&
            !workflowStates.some(
              (state) => state.entityType === ruleSection
            ) && <p role="status">{t("tasks.no_states")}</p>}
          {mode === "rule" && <p className="text-sm">{t("tasks.rule_hint")}</p>}
          {editingRule && <p>{t("tasks.edit_rule")}</p>}
          <Button loading={busy} type="submit">
            {t("save")}
          </Button>
          {editingRule && (
            <Button
              disabled={busy}
              onClick={() => {
                setEditingRule("");
                set({ title: "", notes: "", nextTitle: "", assigneeId: "" });
              }}
            >
              {t("cancel")}
            </Button>
          )}
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
              const res = await api.get("/tasks", {
                params: {
                  completed: String(completed),
                  jobId,
                  entityType,
                  entityId,
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
                  {rule.title} ·{" "}
                  {rule.workflowState
                    ? `${t(`workflow.types.${rule.workflowState.entityType}`)} · ${rule.workflowState.name}`
                    : t(`status.${rule.triggerStatus}`)}
                </span>
                <Button
                  onClick={() => {
                    setMode("rule");
                    setEditingRule(rule.id);
                    setRuleSection(rule.workflowState?.entityType ?? "JOB");
                    set({
                      title: rule.title,
                      notes: rule.notes ?? "",
                      priority: rule.priority,
                      assigneeId: rule.assigneeId ?? "",
                      nextTitle: rule.nextTitle ?? "",
                      nextDelayHours: String(rule.nextDelayHours),
                      delayHours: String(rule.delayHours),
                      triggerStatus: rule.workflowStateId
                        ? `WORKFLOW:${rule.workflowStateId}`
                        : (rule.triggerStatus ?? ""),
                    });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  {t("edit")}
                </Button>
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
