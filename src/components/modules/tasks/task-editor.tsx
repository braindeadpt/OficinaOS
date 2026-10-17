import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTechnicians } from "@/hooks/use-technicians";
import api from "@/lib/api";
import type { TaskRecord } from "./task-table";

function localDate(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function TaskEditor({
  task,
  onClose,
  onSaved,
}: {
  task: TaskRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { technicians } = useTechnicians();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: task.title,
    notes: task.notes ?? "",
    priority: task.priority ?? "NORMAL",
    assigneeId: task.assigneeId ?? "",
    scheduledAt: localDate(task.scheduledAt),
    dueAt: localDate(task.dueAt),
    nextTitle: task.nextTitle ?? "",
    nextDelayHours: String(task.nextDelayHours ?? 0),
  });
  const set = (patch: Partial<typeof form>) =>
    setForm((old) => ({ ...old, ...patch }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/tasks/${task.id}`, {
        ...form,
        notes: form.notes || null,
        assigneeId: form.assigneeId || null,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        nextTitle: form.nextTitle || null,
        nextDelayHours: Number(form.nextDelayHours),
      });
      await onSaved();
      onClose();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      dismissible={!busy}
      onClose={onClose}
      open
      title={t("tasks.edit_task")}
    >
      <form className="space-y-4" onSubmit={save}>
        <Field label={t("tasks.name")}>
          <Input
            maxLength={200}
            onChange={(e) => set({ title: e.target.value })}
            required
            value={form.title}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("tasks.assignee")}>
            <Select
              onChange={(e) => set({ assigneeId: e.target.value })}
              value={form.assigneeId}
            >
              <option value="">{t("tasks.unassigned")}</option>
              {form.assigneeId &&
                !technicians.some((user) => user.id === form.assigneeId) && (
                  <option value={form.assigneeId}>
                    {task.assignee?.name ||
                      task.assignee?.username ||
                      t("tasks.unassigned")}
                  </option>
                )}
              {technicians.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tasks.priority")}>
            <Select
              onChange={(e) => set({ priority: e.target.value })}
              value={form.priority}
            >
              {["LOW", "NORMAL", "HIGH"].map((priority) => (
                <option key={priority} value={priority}>
                  {t(`tasks.${priority}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tasks.scheduled")}>
            <Input
              onChange={(e) => set({ scheduledAt: e.target.value })}
              required
              type="datetime-local"
              value={form.scheduledAt}
            />
          </Field>
          <Field label={t("tasks.due")}>
            <Input
              min={form.scheduledAt}
              onChange={(e) => set({ dueAt: e.target.value })}
              type="datetime-local"
              value={form.dueAt}
            />
          </Field>
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
        <div className="flex justify-end gap-3">
          <Button disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button loading={busy} type="submit">
            {t("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
