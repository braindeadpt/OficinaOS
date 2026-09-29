import { AI_MODELS } from "@shared/constants";
import type { FormEvent } from "react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useModalEffects } from "@/hooks/use-modal-effects";
import api from "@/lib/api";
import { useSettingsStore } from "@/stores/settings";

type TestStatus = "idle" | "loading" | "success" | "fail";

const TEST_BUTTON_CLASSES: Record<TestStatus, string> = {
  fail: "bg-error text-on-error",
  idle: "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
  loading:
    "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
  success: "bg-success text-on-success",
};

const TEST_ICON: Record<TestStatus, string> = {
  fail: "error",
  idle: "network_check",
  loading: "progress_activity",
  success: "check_circle",
};

function getCreativityLabel(value: number, t: (key: string) => string): string {
  if (value <= 0.2) {
    return t("creativity_very_precise");
  }
  if (value <= 0.5) {
    return t("creativity_slightly_precise");
  }
  if (value <= 0.7) {
    return t("creativity_balanced");
  }
  return t("creativity_creative");
}

interface AgentDefinition {
  createdAt: string;
  displayName: string;
  enabledHostedTools: string[];
  handoffKeywords: string[];
  id: string;
  instructions: string;
  isActive: boolean;
  isBuiltIn: boolean;
  model: string | null;
  name: string;
  temperature: number | null;
  toolNames: string[];
  updatedAt: string;
  vectorStoreId: string | null;
}

interface AgentFormData {
  displayName: string;
  enabledHostedTools: string[];
  handoffKeywords: string;
  id?: string;
  instructions: string;
  isActive: boolean;
  model: string;
  name: string;
  temperature: string;
  toolNames: string[];
  vectorStoreId: string;
}

const EMPTY_AGENT_FORM: AgentFormData = {
  displayName: "",
  enabledHostedTools: [],
  handoffKeywords: "",
  instructions: "",
  isActive: true,
  model: "",
  name: "",
  temperature: "",
  toolNames: [],
  vectorStoreId: "",
};

const LOCAL_TOOLS = ["queryDatabase", "getSchema"];
const HOSTED_TOOLS = ["web_search", "file_search"];

function AgentRow({
  agent,
  onEdit,
  onDelete,
  t,
}: {
  agent: AgentDefinition;
  onDelete: () => void;
  onEdit: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-surface-container-low p-4 transition-colors hover:bg-surface-container-high/60">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-on-surface text-sm">
            {agent.displayName}
          </span>
          <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-mono text-on-surface-variant text-xs">
            {agent.name}
          </span>
          {agent.isBuiltIn && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary text-xs uppercase">
              {t("ai_defs_built_in")}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs ${agent.isActive ? "bg-success/10 text-success" : "bg-on-surface-variant/10 text-on-surface-variant"}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${agent.isActive ? "bg-success" : "bg-on-surface-variant/40"}`}
            />
            {agent.isActive ? t("status_active") : t("status_inactive")}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-on-surface-variant text-xs">
          {agent.instructions || t("ai_defs_instructions_placeholder")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          aria-label={`${t("ai_defs_edit")} ${agent.displayName}`}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg p-2 text-on-surface-variant text-xs transition-colors hover:bg-surface-container hover:text-primary"
          onClick={onEdit}
          type="button"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
        </button>
        <button
          aria-label={`${t("delete")} ${agent.displayName}`}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg p-2 text-on-surface-variant text-xs transition-colors hover:bg-surface-container hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          disabled={agent.isBuiltIn}
          onClick={onDelete}
          title={agent.isBuiltIn ? t("ai_defs_built_in") : undefined}
          type="button"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
      </div>
    </div>
  );
}

function AgentForm({
  initial,
  isEdit,
  onCancel,
  onSaved,
  t,
}: {
  initial: AgentFormData;
  isEdit: boolean;
  onCancel: () => void;
  onSaved: () => void;
  t: (key: string) => string;
}) {
  const [form, setForm] = useState<AgentFormData>(initial);
  const [saving, setSaving] = useState(false);

  function toggleLocalTool(tool: string) {
    setForm((f) => ({
      ...f,
      toolNames: f.toolNames.includes(tool)
        ? f.toolNames.filter((t) => t !== tool)
        : [...f.toolNames, tool],
    }));
  }

  function toggleHostedTool(tool: string) {
    setForm((f) => ({
      ...f,
      enabledHostedTools: f.enabledHostedTools.includes(tool)
        ? f.enabledHostedTools.filter((t) => t !== tool)
        : [...f.enabledHostedTools, tool],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        handoffKeywords: form.handoffKeywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        model: form.model || undefined,
        temperature: form.temperature ? Number(form.temperature) : undefined,
        vectorStoreId: form.vectorStoreId || undefined,
      };
      if (isEdit && initial.id) {
        await api.put(`/ai/definitions/${initial.id}`, payload);
        toast.success(t("ai_defs_updated"));
      } else {
        await api.post("/ai/definitions", payload);
        toast.success(t("ai_defs_created"));
      }
      onSaved();
    } catch {
      toast.error(t("settings_save_error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <label
            className="block font-semibold text-on-surface text-sm"
            htmlFor="agent-display-name"
          >
            {t("ai_defs_display_name")}
          </label>
          <input
            className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
            id="agent-display-name"
            onChange={(e) =>
              setForm((f) => ({ ...f, displayName: e.target.value }))
            }
            placeholder={t("ai_defs_display_name_placeholder")}
            required
            value={form.displayName}
          />
        </div>
        <div className="space-y-2">
          <label
            className="block font-semibold text-on-surface text-sm"
            htmlFor="agent-name"
          >
            {t("ai_defs_name")}
          </label>
          <input
            className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all disabled:opacity-60"
            disabled={isEdit}
            id="agent-name"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t("ai_defs_name_placeholder")}
            required
            value={form.name}
          />
          <p className="text-on-surface-variant text-xs">
            {t("ai_defs_name_help")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <label
            className="block font-semibold text-on-surface text-sm"
            htmlFor="agent-model"
          >
            {t("ai_defs_model")}
          </label>
          <input
            className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
            id="agent-model"
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder={t("ai_defs_model_placeholder")}
            value={form.model}
          />
          <p className="text-on-surface-variant text-xs">
            {t("ai_defs_model_help")}
          </p>
        </div>
        <div className="space-y-2">
          <label
            className="block font-semibold text-on-surface text-sm"
            htmlFor="agent-temperature"
          >
            {t("ai_defs_temperature")}
          </label>
          <input
            className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
            id="agent-temperature"
            max="2"
            min="0"
            onChange={(e) =>
              setForm((f) => ({ ...f, temperature: e.target.value }))
            }
            placeholder="0.7"
            step="0.1"
            type="number"
            value={form.temperature}
          />
          <p className="text-on-surface-variant text-xs">
            {t("ai_defs_temperature_help")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label
          className="block font-semibold text-on-surface text-sm"
          htmlFor="agent-instructions"
        >
          {t("ai_defs_instructions")}
        </label>
        <textarea
          className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
          id="agent-instructions"
          onChange={(e) =>
            setForm((f) => ({ ...f, instructions: e.target.value }))
          }
          placeholder={t("ai_defs_instructions_placeholder")}
          rows={5}
          value={form.instructions}
        />
        <p className="text-on-surface-variant text-xs">
          {t("ai_defs_instructions_help")}
        </p>
      </div>

      <div className="rounded-2xl bg-surface-container-low p-5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-on-surface text-sm">
            {t("ai_defs_active")}
          </span>
          <button
            aria-checked={form.isActive}
            aria-label={t("ai_defs_active")}
            className="relative h-6 w-11 rounded-full transition-colors"
            onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
            role="switch"
            style={{
              backgroundColor: form.isActive
                ? "var(--color-primary)"
                : "var(--color-outline-variant)",
            }}
            type="button"
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-on-primary shadow-sm transition-all"
              style={{ insetInlineStart: form.isActive ? "22px" : "2px" }}
            />
          </button>
        </div>
        <p className="mt-1 text-on-surface-variant text-xs">
          {t("ai_defs_active_desc")}
        </p>
      </div>

      <div className="rounded-2xl bg-surface-container-low p-5">
        <h4 className="font-semibold text-on-surface text-sm">
          {t("ai_defs_tools")}
        </h4>
        <div className="mt-3 space-y-2">
          {LOCAL_TOOLS.map((tool) => (
            <label
              className="flex cursor-pointer items-center gap-3"
              key={tool}
            >
              <input
                checked={form.toolNames.includes(tool)}
                className="h-4 w-4 rounded accent-primary"
                onChange={() => toggleLocalTool(tool)}
                type="checkbox"
              />
              <span className="text-on-surface text-sm">{tool}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-surface-container-low p-5">
        <h4 className="font-semibold text-on-surface text-sm">
          {t("ai_defs_hosted_tools")}
        </h4>
        <div className="mt-3 space-y-2">
          {HOSTED_TOOLS.map((tool) => (
            <label
              className="flex cursor-pointer items-center gap-3"
              key={tool}
            >
              <input
                checked={form.enabledHostedTools.includes(tool)}
                className="h-4 w-4 rounded accent-primary"
                onChange={() => toggleHostedTool(tool)}
                type="checkbox"
              />
              <span className="text-on-surface text-sm">
                {tool === "web_search"
                  ? t("ai_defs_hosted_web_search")
                  : t("ai_defs_hosted_file_search")}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label
          className="block font-semibold text-on-surface text-sm"
          htmlFor="agent-keywords"
        >
          {t("ai_defs_keywords")}
        </label>
        <input
          className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
          id="agent-keywords"
          onChange={(e) =>
            setForm((f) => ({ ...f, handoffKeywords: e.target.value }))
          }
          placeholder={t("ai_defs_keywords_placeholder")}
          value={form.handoffKeywords}
        />
        <p className="text-on-surface-variant text-xs">
          {t("ai_defs_keywords_help")}
        </p>
      </div>

      <div className="space-y-2">
        <label
          className="block font-semibold text-on-surface text-sm"
          htmlFor="agent-vector-store"
        >
          {t("ai_defs_vector_store_id")}
        </label>
        <input
          className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
          id="agent-vector-store"
          onChange={(e) =>
            setForm((f) => ({ ...f, vectorStoreId: e.target.value }))
          }
          placeholder={t("ai_defs_vector_store_placeholder")}
          value={form.vectorStoreId}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-container px-5 py-2.5 font-bold text-on-surface-variant text-sm transition-all hover:bg-surface-container-high"
          onClick={onCancel}
          type="button"
        >
          {t("cancel")}
        </button>
        <button
          className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-6 py-2.5 font-bold text-on-primary text-sm transition-all active:opacity-80 disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {saving && (
            <span className="material-symbols-outlined animate-spin text-[18px]">
              progress_activity
            </span>
          )}
          {t("save")}
        </button>
      </div>
    </form>
  );
}

export interface SettingsAiTabHandle {
  requestSubmit: () => void;
  reset: () => void;
}

interface SettingsAiTabProps {
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  onToast: (message: string, type: "success" | "error") => void;
  ref?: React.Ref<SettingsAiTabHandle>;
}

function AgentListSection({
  agents,
  agentsLoading,
  onEdit,
  onDelete,
  t,
}: {
  agents: AgentDefinition[];
  agentsLoading: boolean;
  onEdit: (agent: AgentDefinition) => void;
  onDelete: (agent: AgentDefinition) => void;
  t: (key: string) => string;
}) {
  if (agentsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="material-symbols-outlined animate-spin text-3xl text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-2xl bg-surface-container-low py-12 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">
          smart_toy
        </span>
        <p className="mt-3 font-semibold text-on-surface-variant text-sm">
          {t("ai_defs_empty")}
        </p>
        <p className="mt-1 text-on-surface-variant text-xs">
          {t("ai_defs_empty_desc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <AgentRow
          agent={agent}
          key={agent.id}
          onDelete={() => onDelete(agent)}
          onEdit={() => onEdit(agent)}
          t={t}
        />
      ))}
    </div>
  );
}

export default function SettingsAiTab({
  ref,
  onDirtyChange,
  onSavingChange,
  onToast,
}: SettingsAiTabProps) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);

  const { aiSettings, fetchAiSettings, saveAiSettings, testAiConnection } =
    useSettingsStore();

  const [aiForm, setAiForm] = useState({
    endpointUrl: "",
    apiKey: "",
    model: "gpt-4o",
    temperature: 0.4,
    enabled: false,
  });
  const [aiFormInitial, setAiFormInitial] = useState(aiForm);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");

  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<AgentDefinition | null>(
    null
  );

  const deleteDialogRef = useRef<HTMLDivElement>(null);

  useModalEffects(
    deleteTarget !== null,
    () => setDeleteTarget(null),
    deleteDialogRef
  );

  useImperativeHandle(ref, () => ({
    requestSubmit: () => formRef.current?.requestSubmit(),
    reset: () => setAiForm({ ...aiFormInitial }),
  }));

  useEffect(() => {
    if (aiSettings) {
      const form = {
        endpointUrl: aiSettings.endpointUrl ?? "",
        apiKey: "",
        model: aiSettings.model ?? "gpt-4o",
        temperature: aiSettings.temperature ?? 0.4,
        enabled: aiSettings.enabled ?? false,
      };
      setAiForm(form);
      setAiFormInitial(form);
    }
  }, [aiSettings]);

  useEffect(() => {
    if (!aiSettings) {
      fetchAiSettings().catch((err) => {
        console.error("Failed to fetch AI settings:", err);
      });
    }
  }, [aiSettings, fetchAiSettings]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await api.get<AgentDefinition[]>("/ai/definitions");
      setAgents(res.data);
    } catch {
      toast.error(t("settings_save_error"));
    } finally {
      setAgentsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAgents().catch(() => {
      // Error handled by toast in fetchAgents
    });
  }, [fetchAgents]);

  async function handleTestConnection() {
    setTestStatus("loading");
    const result = await testAiConnection();
    if (result.success) {
      setTestStatus("success");
    } else {
      setTestStatus("fail");
    }
    setTimeout(() => setTestStatus("idle"), 3000);
  }

  async function handleAiSubmit(e: FormEvent) {
    e.preventDefault();
    if (!aiForm.endpointUrl.trim()) {
      onToast(t("settings_error_endpoint_required"), "error");
      return;
    }
    onSavingChange(true);
    try {
      await saveAiSettings(aiForm);
      setAiFormInitial({ ...aiForm });
      onDirtyChange(false);
      onToast(t("ai_config_saved"), "success");
    } catch {
      onToast(t("settings_save_error"), "error");
    } finally {
      onSavingChange(false);
    }
  }

  function handleEditAgent(agent: AgentDefinition) {
    setEditingAgent(agent);
    setShowAgentForm(true);
  }

  function handleAgentFormClose() {
    setShowAgentForm(false);
    setEditingAgent(null);
  }

  async function handleDeleteAgent() {
    if (!deleteTarget) {
      return;
    }
    try {
      await api.delete(`/ai/definitions/${deleteTarget.id}`);
      toast.success(t("ai_defs_deleted"));
      setDeleteTarget(null);
      await fetchAgents();
    } catch {
      toast.error(t("settings_save_error"));
    }
  }

  const isTesting = testStatus === "loading";

  const agentFormInitial = editingAgent
    ? {
        displayName: editingAgent.displayName,
        enabledHostedTools: editingAgent.enabledHostedTools,
        handoffKeywords: editingAgent.handoffKeywords.join(", "),
        id: editingAgent.id,
        instructions: editingAgent.instructions,
        isActive: editingAgent.isActive,
        model: editingAgent.model ?? "",
        name: editingAgent.name,
        temperature: editingAgent.temperature?.toString() ?? "",
        toolNames: editingAgent.toolNames,
        vectorStoreId: editingAgent.vectorStoreId ?? "",
      }
    : { ...EMPTY_AGENT_FORM };

  return (
    <div className="space-y-8">
      <form className="space-y-6" onSubmit={handleAiSubmit} ref={formRef}>
        <div className="flex items-center justify-between rounded-2xl bg-surface-container-low p-5">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${aiForm.enabled ? "bg-primary/10" : "bg-surface-container-highest"}`}
            >
              <span
                className={`material-symbols-outlined text-xl ${aiForm.enabled ? "text-primary" : "text-on-surface-variant"}`}
              >
                smart_toy
              </span>
            </div>
            <div>
              <p className="font-semibold text-on-surface text-sm">
                {t("ai_analyst")}
              </p>
              <p className="text-on-surface-variant text-xs">
                {aiForm.enabled ? t("ai_enabled_desc") : t("ai_disabled_desc")}
              </p>
            </div>
          </div>
          <Switch
            ariaLabel={t("ai_analyst")}
            checked={aiForm.enabled}
            onChange={(checked) => {
              setAiForm((f) => ({ ...f, enabled: checked }));
              onDirtyChange(true);
            }}
          />
        </div>
        <div className="rounded-2xl bg-surface-container-low p-5">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <label
                className="block font-semibold text-on-surface text-sm"
                htmlFor="ai-endpoint"
              >
                {t("ai_endpoint_label")}
                <span aria-hidden="true" className="ms-0.5 text-error">
                  *
                </span>
              </label>
              <input
                className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm transition-all"
                id="ai-endpoint"
                onChange={(e) => {
                  setAiForm((f) => ({ ...f, endpointUrl: e.target.value }));
                  onDirtyChange(true);
                }}
                placeholder="https://api.openai.com/v1"
                required
                type="url"
                value={aiForm.endpointUrl}
              />
              <p className="text-on-surface-variant text-xs">
                {t("ai_endpoint_hint")}
              </p>
            </div>
            <div className="space-y-2">
              <label
                className="block font-semibold text-on-surface text-sm"
                htmlFor="ai-key"
              >
                {t("ai_key_label")}
              </label>
              <div className="relative">
                <input
                  className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 pe-12 text-sm transition-all"
                  id="ai-key"
                  onChange={(e) => {
                    setAiForm((f) => ({ ...f, apiKey: e.target.value }));
                    onDirtyChange(true);
                  }}
                  placeholder="sk-••••••••••••••"
                  type={showApiKey ? "text" : "password"}
                  value={aiForm.apiKey}
                />
                <button
                  aria-label={
                    showApiKey
                      ? t("auth_hide_password")
                      : t("auth_show_password")
                  }
                  className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                  onClick={() => setShowApiKey(!showApiKey)}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showApiKey ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
              <p className="text-on-surface-variant text-xs">
                {t("ai_key_hint")}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-surface-container-low p-5">
          <div className="space-y-2">
            <label
              className="block font-semibold text-on-surface text-sm"
              htmlFor="ai-model"
            >
              {t("analytical_model")}
            </label>
            <div className="relative">
              <select
                className="w-full cursor-pointer appearance-none rounded-xl border-none bg-surface-container-lowest px-4 py-3 pe-10 text-sm transition-all"
                id="ai-model"
                onChange={(e) => {
                  setAiForm((f) => ({ ...f, model: e.target.value }));
                  onDirtyChange(true);
                }}
                value={aiForm.model}
              >
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {t(m.labelKey)}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
                <span className="material-symbols-outlined text-[20px]">
                  expand_more
                </span>
              </span>
            </div>
          </div>
          <button
            aria-expanded={showAdvanced}
            className="mt-4 flex items-center gap-2 text-on-surface-variant text-sm transition-colors hover:text-primary"
            onClick={() => setShowAdvanced(!showAdvanced)}
            type="button"
          >
            <span
              className={`material-symbols-outlined text-[18px] transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`}
            >
              expand_more
            </span>
            {t("advanced_settings")}
          </button>
          {showAdvanced && (
            <div className="mt-4 space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <label
                  className="font-semibold text-on-surface text-sm"
                  htmlFor="ai-temp"
                >
                  {t("ai_creativity_label")}
                </label>
                <span className="font-mono font-semibold text-primary text-sm">
                  {aiForm.temperature.toFixed(1)}
                </span>
              </div>
              <input
                aria-labelledby="ai-temp"
                aria-valuetext={getCreativityLabel(aiForm.temperature, t)}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-outline-variant/30 accent-primary"
                id="ai-temp"
                max="1"
                min="0"
                onChange={(e) => {
                  setAiForm((f) => ({
                    ...f,
                    temperature: Number.parseFloat(e.target.value),
                  }));
                  onDirtyChange(true);
                }}
                step="0.1"
                type="range"
                value={aiForm.temperature}
              />
              <div className="flex justify-between text-on-surface-variant text-xs">
                <span>{t("precise")}</span>
                <span>{t("creative")}</span>
              </div>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                {t("temperature_note")}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            className={`flex min-h-11 items-center gap-2 rounded-xl px-6 py-3 font-bold text-sm transition-all ${TEST_BUTTON_CLASSES[testStatus]}`}
            disabled={isTesting}
            onClick={handleTestConnection}
            type="button"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${isTesting ? "animate-spin" : ""}`}
            >
              {TEST_ICON[testStatus]}
            </span>
            {isTesting ? t("testing_connection") : t("test_connection")}
          </button>
          {testStatus === "success" && (
            <span className="font-medium text-sm text-success">
              {t("connection_success")}
            </span>
          )}
          {testStatus === "fail" && (
            <span className="font-medium text-error text-sm">
              {t("connection_failed")}
            </span>
          )}
        </div>

        <div className="rounded-2xl bg-primary/5 p-5">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-[20px] text-primary">
              psychology
            </span>
            <div>
              <p className="font-semibold text-on-surface text-sm">
                {t("ai_memory_title")}
              </p>
              <p className="mt-0.5 max-w-prose text-on-surface-variant text-xs leading-relaxed">
                {t("ai_memory_desc")}
              </p>
            </div>
          </div>
        </div>
      </form>

      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-[20px] text-primary">
          smart_toy
        </span>
        <h4 className="font-extrabold font-headline text-base text-on-surface">
          {t("ai_defs_title")}
        </h4>
      </div>

      {showAgentForm ? (
        <AgentForm
          initial={agentFormInitial}
          isEdit={!!editingAgent}
          onCancel={handleAgentFormClose}
          onSaved={() => {
            handleAgentFormClose();
            fetchAgents().catch(() => {
              // Error handled by toast in fetchAgents
            });
          }}
          t={t}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <button
              className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-on-primary text-sm transition-all active:opacity-80"
              onClick={() => setShowAgentForm(true)}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t("ai_defs_add")}
            </button>
          </div>
          <AgentListSection
            agents={agents}
            agentsLoading={agentsLoading}
            onDelete={(agent) => setDeleteTarget(agent)}
            onEdit={handleEditAgent}
            t={t}
          />
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-on-surface/40">
          <div
            className="relative z-[60] mx-4 w-full max-w-[360px] overflow-y-auto rounded-2xl bg-surface-container-lowest shadow-2xl"
            ref={deleteDialogRef}
          >
            <div className="px-6 py-6">
              <h3 className="font-bold font-headline text-lg text-on-surface">
                {t("ai_defs_delete_confirm_title")}
              </h3>
              <p className="mt-2 text-on-surface-variant text-sm">
                {t("ai_defs_delete_confirm_desc")}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4">
              <button
                className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-container px-5 py-2.5 font-bold text-on-surface-variant text-sm transition-all hover:bg-surface-container-high"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="flex min-h-11 items-center gap-2 rounded-xl bg-error px-5 py-2.5 font-bold text-on-error text-sm transition-all active:opacity-80"
                onClick={handleDeleteAgent}
                type="button"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
