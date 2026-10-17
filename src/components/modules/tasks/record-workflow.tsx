import {
  WORKFLOW_PERMISSIONS,
  type WorkflowType,
} from "@shared/constants/workflow";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";
import { TaskPanel } from "./task-panel";

interface State {
  id: string;
  isActive: boolean;
  name: string;
}
export function RecordWorkflow({
  entityType,
  entityId,
  expanded = false,
}: {
  entityType: WorkflowType;
  entityId: string;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(expanded);
  const [revision, setRevision] = useState(0);
  return (
    <details
      className="my-3 w-full"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary className="cursor-pointer font-semibold text-primary">
        {t("workflow.tasks_status")}
      </summary>
      {open && (
        <>
          <WorkflowStateControl
            entityId={entityId}
            entityType={entityType}
            onChanged={() => setRevision((value) => value + 1)}
          />
          <TaskPanel
            entityId={entityId}
            entityType={entityType}
            key={revision}
          />
        </>
      )}
    </details>
  );
}
function WorkflowStateControl({
  entityType,
  entityId,
  onChanged,
}: {
  entityType: WorkflowType;
  entityId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const edit = useCan(WORKFLOW_PERMISSIONS[entityType].edit);
  const admin = useCan({ settings: ["edit"] });
  const [states, setStates] = useState<State[]>([]);
  const [stateId, setStateId] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/workflow", {
        params: { entityType, entityId },
      });
      setStates(data.states);
      setStateId(data.stateId ?? "");
    } catch {
      toast.error(t("tasks.failed"));
    }
  }, [entityType, entityId, t]);
  useEffect(() => {
    load();
  }, [load]);
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
      await load();
    } catch {
      toast.error(t("tasks.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm">{t("workflow.status_hint")}</p>
      <Select
        aria-label={t("workflow.status")}
        disabled={!edit || busy}
        onChange={async (event) => {
          setBusy(true);
          try {
            await api.put("/workflow", {
              entityType,
              entityId,
              stateId: event.target.value || null,
            });
            await load();
            onChanged();
          } catch {
            toast.error(t("tasks.failed"));
          } finally {
            setBusy(false);
          }
        }}
        value={stateId}
      >
        <option value="">{t("workflow.no_status")}</option>
        {states
          .filter((state) => state.isActive || state.id === stateId)
          .map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
      </Select>
      {admin && (
        <details>
          <summary className="cursor-pointer">
            {t("workflow.manage_states")}
          </summary>
          <form className="my-3 flex flex-wrap gap-2" onSubmit={save}>
            <Input
              aria-label={t("workflow.state_name")}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              required
              value={name}
            />
            <Button loading={busy} type="submit">
              {t("save")}
            </Button>
            {editing && (
              <Button
                onClick={() => {
                  setEditing("");
                  setName("");
                }}
              >
                {t("cancel")}
              </Button>
            )}
          </form>
          {states.map((state) => (
            <div className="my-2 flex items-center gap-3" key={state.id}>
              <span>{state.name}</span>
              <Button
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
                    await load();
                  } catch {
                    toast.error(t("tasks.failed"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t(
                  state.isActive ? "workflow.deactivate" : "workflow.activate"
                )}
              </Button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
