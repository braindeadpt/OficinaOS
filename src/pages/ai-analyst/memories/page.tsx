import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api from "@/lib/api";

interface MemoryItem {
  content: string;
  id: string;
  source: string;
  tags: string[];
}

interface InstructionItem {
  content: string;
  id: string;
  tags: string[];
}

function ItemForm({
  content: initialContent,
  onCancel,
  onSubmit,
  placeholder,
  saving,
  tags: initialTags,
  t,
}: {
  content: string;
  onCancel: () => void;
  onSubmit: (data: { content: string; tags: string[] }) => void;
  placeholder: string;
  saving: boolean;
  tags: string[];
  t: (key: string) => string;
}) {
  const [content, setContent] = useState(initialContent);
  const [tags, setTags] = useState(initialTags.join(", "));
  const tagsId = useId();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const parsedTags = tags
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        onSubmit({ content, tags: parsedTags });
      }}
    >
      <textarea
        className="rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm ring-1 ring-outline-variant"
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        rows={3}
        value={content}
      />
      <div>
        <label
          className="mb-1 block font-medium text-on-surface-variant text-xs"
          htmlFor={tagsId}
        >
          {t("ai_tags_label")}
        </label>
        <input
          className="w-full rounded-xl border-none bg-surface-container-lowest px-4 py-3 text-sm ring-1 ring-outline-variant"
          id={tagsId}
          onChange={(e) => setTags(e.target.value)}
          placeholder={t("ai_tags_placeholder")}
          type="text"
          value={tags}
        />
        <p className="mt-1 text-on-surface-variant text-xs">
          {t("ai_tags_help")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-surface-container-high px-4 py-2 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          {t("cancel")}
        </button>
        <button
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-on-primary text-sm shadow-md shadow-primary/10 transition-all hover:bg-primary/90 active:scale-[0.98]"
          disabled={saving || !content.trim()}
          type="submit"
        >
          {saving ? t("ai_saving") : t("save")}
        </button>
      </div>
    </form>
  );
}

function DeleteConfirm({
  confirmKey,
  descriptionKey,
  onCancel,
  onConfirm,
  t,
}: {
  confirmKey: string;
  descriptionKey: string;
  onCancel: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="mt-3 rounded-xl bg-error-container/50 p-3" role="alert">
      <p className="font-bold text-on-surface text-sm">{t(confirmKey)}</p>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t(descriptionKey)}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-surface-container-high px-4 py-2 font-bold text-on-surface-variant text-xs transition-colors hover:bg-surface-container-highest"
          onClick={onCancel}
          type="button"
        >
          {t("cancel")}
        </button>
        <button
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-error px-4 py-2 font-bold text-on-error text-xs transition-colors hover:opacity-90"
          onClick={onConfirm}
          type="button"
        >
          {t("delete")}
        </button>
      </div>
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\u2026`;
}

export default function AiMemoriesPage() {
  const { t } = useTranslation();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [instructions, setInstructions] = useState<InstructionItem[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(true);
  const [loadingInstructions, setLoadingInstructions] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddMemory, setShowAddMemory] = useState(false);
  const [showAddInstruction, setShowAddInstruction] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchMemories = useCallback(async () => {
    try {
      const res = await api.get("/ai/memories");
      setMemories(res.data);
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setLoadingMemories(false);
    }
  }, [t]);

  const fetchInstructions = useCallback(async () => {
    try {
      const res = await api.get("/ai/instructions");
      setInstructions(res.data);
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setLoadingInstructions(false);
    }
  }, [t]);

  useEffect(() => {
    fetchMemories();
    fetchInstructions();
  }, [fetchMemories, fetchInstructions]);

  const handleSaveMemory = useCallback(
    async (data: { content: string; tags: string[] }, id?: string) => {
      setSaving(true);
      try {
        if (id) {
          await api.put(`/ai/memories/${id}`, data);
          toast.success(t("ai_memories_updated"));
        } else {
          await api.post("/ai/memories", data);
          toast.success(t("ai_memories_added"));
        }
        setEditingId(null);
        setShowAddMemory(false);
        await fetchMemories();
      } catch {
        toast.error(t("errors.generic"));
      } finally {
        setSaving(false);
      }
    },
    [t, fetchMemories]
  );

  const handleSaveInstruction = useCallback(
    async (data: { content: string; tags: string[] }, id?: string) => {
      setSaving(true);
      try {
        if (id) {
          await api.put(`/ai/instructions/${id}`, data);
          toast.success(t("ai_instructions_updated"));
        } else {
          await api.post("/ai/instructions", data);
          toast.success(t("ai_instructions_added"));
        }
        setEditingId(null);
        setShowAddInstruction(false);
        await fetchInstructions();
      } catch {
        toast.error(t("errors.generic"));
      } finally {
        setSaving(false);
      }
    },
    [t, fetchInstructions]
  );

  const handleDeleteMemory = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/ai/memories/${id}`);
        toast.success(t("ai_memories_deleted"));
        setDeletingId(null);
        await fetchMemories();
      } catch {
        toast.error(t("errors.generic"));
      }
    },
    [t, fetchMemories]
  );

  const handleDeleteInstruction = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/ai/instructions/${id}`);
        toast.success(t("ai_instructions_deleted"));
        setDeletingId(null);
        await fetchInstructions();
      } catch {
        toast.error(t("errors.generic"));
      }
    },
    [t, fetchInstructions]
  );

  return (
    <>
      <div className="mb-8">
        <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
          {t("ai_memories_title")}
        </h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label={t("ai_memories_section")}>
          <div className="rounded-3xl bg-surface-container-lowest p-5 md:p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface-variant text-xl">
                    psychology
                  </span>
                  <h3 className="font-bold font-headline text-lg text-on-surface">
                    {t("ai_memories_section")}
                  </h3>
                </div>
                <p className="mt-1 text-on-surface-variant text-sm">
                  {t("ai_memories_description")}
                </p>
              </div>
              <button
                className="flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-on-primary text-sm shadow-md shadow-primary/10 transition-all hover:bg-primary/90 active:scale-[0.98]"
                onClick={() => setShowAddMemory(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
                <span>{t("ai_memories_add")}</span>
              </button>
            </div>

            {loadingMemories && (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    className="h-24 animate-pulse rounded-2xl bg-surface-container-low"
                    key={String(i)}
                  />
                ))}
              </div>
            )}

            {!loadingMemories && memories.length === 0 && !showAddMemory && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant">
                  psychology
                </span>
                <p className="font-bold text-on-surface-variant text-sm">
                  {t("ai_memories_empty")}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {showAddMemory && (
                <div className="rounded-2xl bg-surface-container-low p-5">
                  <ItemForm
                    content=""
                    onCancel={() => setShowAddMemory(false)}
                    onSubmit={(data) => handleSaveMemory(data)}
                    placeholder={t("ai_memories_placeholder")}
                    saving={saving}
                    t={t}
                    tags={[]}
                  />
                </div>
              )}
              {memories.map((memory) =>
                editingId === memory.id ? (
                  <div
                    className="rounded-2xl bg-surface-container-low p-5"
                    key={memory.id}
                  >
                    <ItemForm
                      content={memory.content}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(data) => handleSaveMemory(data, memory.id)}
                      placeholder={t("ai_memories_placeholder")}
                      saving={saving}
                      t={t}
                      tags={memory.tags}
                    />
                  </div>
                ) : (
                  <div
                    className="rounded-2xl bg-surface-container-low p-5"
                    key={memory.id}
                  >
                    <p className="whitespace-pre-wrap text-on-surface text-sm leading-relaxed">
                      {truncate(memory.content, 200)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {memory.tags.map((tag) => (
                        <span
                          className="rounded-full bg-primary-container px-2.5 py-1 font-bold text-on-primary-container text-xs uppercase"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                      {memory.source && (
                        <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-on-surface-variant text-xs">
                          {t("ai_memories_source", {
                            source: memory.source,
                          })}
                        </span>
                      )}
                    </div>
                    {deletingId === memory.id ? (
                      <DeleteConfirm
                        confirmKey="ai_memories_delete"
                        descriptionKey="ai_memories_delete_confirm"
                        onCancel={() => setDeletingId(null)}
                        onConfirm={() => handleDeleteMemory(memory.id)}
                        t={t}
                      />
                    ) : (
                      <div className="mt-3 flex items-center gap-1">
                        <button
                          aria-label={t("ai_memories_edit")}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                          onClick={() => setEditingId(memory.id)}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            edit
                          </span>
                        </button>
                        <button
                          aria-label={t("ai_memories_delete")}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                          onClick={() => setDeletingId(memory.id)}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            delete
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </section>

        <section aria-label={t("ai_instructions_section")}>
          <div className="rounded-3xl bg-surface-container-lowest p-5 md:p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-on-surface-variant text-xl">
                    description
                  </span>
                  <h3 className="font-bold font-headline text-lg text-on-surface">
                    {t("ai_instructions_section")}
                  </h3>
                </div>
                <p className="mt-1 text-on-surface-variant text-sm">
                  {t("ai_instructions_description")}
                </p>
              </div>
              <button
                className="flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-on-primary text-sm shadow-md shadow-primary/10 transition-all hover:bg-primary/90 active:scale-[0.98]"
                onClick={() => setShowAddInstruction(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
                <span>{t("ai_instructions_add")}</span>
              </button>
            </div>

            {loadingInstructions && (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    className="h-24 animate-pulse rounded-2xl bg-surface-container-low"
                    key={String(i)}
                  />
                ))}
              </div>
            )}

            {!loadingInstructions &&
              instructions.length === 0 &&
              !showAddInstruction && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant">
                    description
                  </span>
                  <p className="font-bold text-on-surface-variant text-sm">
                    {t("ai_instructions_empty")}
                  </p>
                </div>
              )}

            <div className="flex flex-col gap-3">
              {showAddInstruction && (
                <div className="rounded-2xl bg-surface-container-low p-5">
                  <ItemForm
                    content=""
                    onCancel={() => setShowAddInstruction(false)}
                    onSubmit={(data) => handleSaveInstruction(data)}
                    placeholder={t("ai_instructions_placeholder")}
                    saving={saving}
                    t={t}
                    tags={[]}
                  />
                </div>
              )}
              {instructions.map((instruction) =>
                editingId === instruction.id ? (
                  <div
                    className="rounded-2xl bg-surface-container-low p-5"
                    key={instruction.id}
                  >
                    <ItemForm
                      content={instruction.content}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(data) =>
                        handleSaveInstruction(data, instruction.id)
                      }
                      placeholder={t("ai_instructions_placeholder")}
                      saving={saving}
                      t={t}
                      tags={instruction.tags}
                    />
                  </div>
                ) : (
                  <div
                    className="rounded-2xl bg-surface-container-low p-5"
                    key={instruction.id}
                  >
                    <p className="whitespace-pre-wrap text-on-surface text-sm leading-relaxed">
                      {truncate(instruction.content, 200)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {instruction.tags.map((tag) => (
                        <span
                          className="rounded-full bg-primary-container px-2.5 py-1 font-bold text-on-primary-container text-xs uppercase"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {deletingId === instruction.id ? (
                      <DeleteConfirm
                        confirmKey="ai_instructions_delete"
                        descriptionKey="ai_instructions_delete_confirm"
                        onCancel={() => setDeletingId(null)}
                        onConfirm={() =>
                          handleDeleteInstruction(instruction.id)
                        }
                        t={t}
                      />
                    ) : (
                      <div className="mt-3 flex items-center gap-1">
                        <button
                          aria-label={t("ai_instructions_edit")}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                          onClick={() => setEditingId(instruction.id)}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            edit
                          </span>
                        </button>
                        <button
                          aria-label={t("ai_instructions_delete")}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                          onClick={() => setDeletingId(instruction.id)}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            delete
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
