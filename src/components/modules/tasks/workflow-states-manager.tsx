import { WORKFLOW_TYPES, type WorkflowType } from "@shared/constants/workflow";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";

interface State {
  id: string;
  isActive: boolean;
  name: string;
}
export function WorkflowStatesManager({
  entityType,
  onChanged,
}: {
  entityType?: WorkflowType;
  onChanged?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const admin = useCan({ settings: ["edit"] });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WorkflowType>(entityType ?? "JOB");
  if (!admin) {
    return null;
  }
  return (
    <details
      className="my-4 rounded-xl border border-outline-variant/30 p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary className="cursor-pointer font-semibold text-primary">
        {t("workflow.manage_states")}
        {entityType && ` · ${t(`workflow.types.${entityType}`)}`}
      </summary>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-sm">{t("workflow.status_hint")}</p>
          {!entityType && (
            <Field label={t("tasks.section")}>
              <Select
                onChange={(event) =>
                  setSelected(event.target.value as WorkflowType)
                }
                value={selected}
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
          <StateList
            entityType={entityType ?? selected}
            key={entityType ?? selected}
            onChanged={onChanged}
          />
        </div>
      )}
    </details>
  );
}
function StateList({
  entityType,
  onChanged,
}: {
  entityType: WorkflowType;
  onChanged?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [states, setStates] = useState<State[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/workflow/states", {
        params: { entityType, includeInactive: "true" },
      });
      setStates(data.data);
    } catch {
      toast.error(t("tasks.failed"));
    }
  }, [entityType, t]);
  useEffect(() => {
    load();
  }, [load]);
  const refresh = async () => {
    await load();
    window.dispatchEvent(new Event("workflow-states-changed"));
    await onChanged?.();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/workflow/states/${editing}`, { name });
      } else {
        await api.post("/workflow/states", { entityType, name });
      }
      setName("");
      setEditing("");
      await refresh();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={save}>
        <Field label={t("workflow.state_name")}>
          <Input
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            required
            value={name}
          />
        </Field>
        <Button loading={busy} type="submit">
          {t(editing ? "save" : "tasks.add_state")}
        </Button>
        {editing && (
          <Button
            disabled={busy}
            onClick={() => {
              setEditing("");
              setName("");
            }}
          >
            {t("cancel")}
          </Button>
        )}
      </form>
      {states.length === 0 && <p>{t("tasks.no_states")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-3" scope="col">
                {t("workflow.state_name")}
              </th>
              <th className="p-3" scope="col">
                {t("tasks.state")}
              </th>
              <th className="p-3" scope="col">
                {t("tasks.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {states.map((state) => (
              <tr className="border-outline-variant/30 border-t" key={state.id}>
                <td className="p-3">{state.name}</td>
                <td className="p-3">
                  {t(state.isActive ? "tasks.active" : "tasks.inactive")}
                </td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setEditing(state.id);
                        setName(state.name);
                      }}
                    >
                      {t("edit")}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.patch(`/workflow/states/${state.id}`, {
                            isActive: !state.isActive,
                          });
                          await refresh();
                        } catch {
                          toast.error(t("tasks.failed"));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t(
                        state.isActive
                          ? "workflow.deactivate"
                          : "workflow.activate"
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
