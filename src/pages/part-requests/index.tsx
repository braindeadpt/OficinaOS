import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import type { ApiError } from "@/lib/api";
import {
  closePartRequest,
  createPartRequest,
  fetchPartRequestReplies,
  fetchPartRequests,
  type PartCondition,
  type PartRequest,
  type PartRequestReply,
  type PartType,
  replyToPartRequest,
} from "@/lib/api-part-requests";

const PART_TYPES: PartType[] = [
  "SCREEN",
  "BATTERY",
  "BOARD",
  "CAMERA",
  "PORT",
  "OTHER",
];
const CONDITIONS: PartCondition[] = ["ANY", "NEW", "OEM", "USED"];

type Tab = "board" | "mine";
type Gate = "ok" | "not-paired" | "no-module";

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
      role="dialog"
    >
      <button
        aria-label="close"
        className="absolute inset-0 bg-on-surface/60"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface-container-low p-6 shadow-2xl sm:rounded-2xl">
        <h2 className="mb-4 font-bold font-headline text-lg text-on-surface">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export default function PartRequestsPage() {
  const { t, i18n } = useTranslation();
  const fmtCurrency = useFormatCurrency();
  const [tab, setTab] = useState<Tab>("board");
  const [items, setItems] = useState<PartRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState<Gate>("ok");
  const [creating, setCreating] = useState(false);
  const [replyingTo, setReplyingTo] = useState<PartRequest | null>(null);
  const [repliesOf, setRepliesOf] = useState<PartRequest | null>(null);
  const [replies, setReplies] = useState<PartRequestReply[]>([]);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchPartRequests(tab));
      setGate("ok");
    } catch (err) {
      const code = (err as ApiError).code;
      if (code === "CLOUD_NOT_PAIRED") {
        setGate("not-paired");
      } else if (code === "CLOUD_MODULE_REQUIRED") {
        setGate("no-module");
      } else {
        toast.error(t("parts_board.load_error"));
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, t]);

  useEffect(() => {
    load();
  }, [load]);

  const openReplies = async (r: PartRequest) => {
    setRepliesOf(r);
    setReplies([]);
    try {
      setReplies(await fetchPartRequestReplies(r.id));
    } catch {
      toast.error(t("parts_board.load_error"));
      setRepliesOf(null);
    }
  };

  const closeRequest = async (id: string, status: "FOUND" | "CLOSED") => {
    setActing(true);
    try {
      await closePartRequest(id, status);
      toast.success(t("parts_board.closed_ok"));
      await load();
    } catch {
      toast.error(t("parts_board.action_error"));
    } finally {
      setActing(false);
    }
  };

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
    }).format(new Date(iso));

  const deviceLabel = (r: PartRequest) =>
    [r.deviceBrand, r.deviceModel].filter(Boolean).join(" ");

  let body: React.ReactNode;
  if (gate === "not-paired") {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          cloud_off
        </span>
        <p className="mt-4 max-w-sm font-medium text-on-surface-variant">
          {t("parts_board.not_paired")}
        </p>
      </div>
    );
  } else if (gate === "no-module") {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          lock
        </span>
        <p className="mt-4 max-w-sm font-medium text-on-surface-variant">
          {t("parts_board.no_module")}
        </p>
      </div>
    );
  } else if (loading) {
    body = (
      <div className="flex justify-center py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          travel_explore
        </span>
        <p className="mt-4 font-medium text-on-surface-variant">
          {tab === "board"
            ? t("parts_board.empty_board")
            : t("parts_board.empty_mine")}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {items.map((r) => (
          <div
            className="rounded-xl bg-surface-container-low p-5 shadow-sm"
            key={r.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-primary-container/20 px-2 py-0.5 font-medium text-primary-container text-xs">
                    {t(`parts_board.type_${r.partType}`)}
                  </span>
                  {r.condition !== "ANY" && (
                    <span className="rounded-lg bg-surface-container-highest px-2 py-0.5 text-on-surface-variant text-xs">
                      {t(`parts_board.cond_${r.condition}`)}
                    </span>
                  )}
                  {r.maxPriceCents != null && (
                    <span className="rounded-lg bg-tertiary-container/30 px-2 py-0.5 text-on-tertiary-container text-xs">
                      {t("parts_board.max_price", {
                        price: fmtCurrency(r.maxPriceCents / 100),
                      })}
                    </span>
                  )}
                  {r.status && r.status !== "OPEN" && (
                    <span className="rounded-lg bg-surface-container-highest px-2 py-0.5 text-on-surface-variant text-xs">
                      {t(`parts_board.status_${r.status}`)}
                    </span>
                  )}
                  <span className="text-on-surface-variant text-xs">
                    {fmtDate(r.createdAt)}
                  </span>
                </div>
                <p className="mt-2 font-bold text-on-surface">{r.title}</p>
                {deviceLabel(r) && (
                  <p className="font-medium text-on-surface-variant text-sm">
                    {deviceLabel(r)}
                  </p>
                )}
                {r.notes && (
                  <p className="mt-1 whitespace-pre-wrap text-on-surface-variant text-sm">
                    {r.notes}
                  </p>
                )}
                <p className="mt-2 text-on-surface-variant text-xs">
                  {t("parts_board.by_shop", { shop: r.shop.name })} ·{" "}
                  {t("parts_board.reply_count", { count: r._count.replies })}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {tab === "board" && (
                  <button
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold text-on-primary text-sm transition-all active:scale-[0.98]"
                    onClick={() => setReplyingTo(r)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-lg">
                      reply
                    </span>
                    {t("parts_board.reply")}
                  </button>
                )}
                {tab === "mine" && r.status === "OPEN" && (
                  <>
                    <button
                      className="flex items-center gap-2 rounded-xl bg-surface-container-high px-4 py-2.5 font-bold text-on-surface text-sm transition-all hover:bg-surface-container-highest active:scale-[0.98] disabled:opacity-50"
                      disabled={acting}
                      onClick={() => openReplies(r)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-lg">
                        forum
                      </span>
                      {t("parts_board.replies")}
                    </button>
                    <button
                      className="flex items-center gap-2 rounded-xl bg-surface-container-high px-4 py-2.5 font-bold text-on-surface text-sm transition-all hover:bg-surface-container-highest active:scale-[0.98] disabled:opacity-50"
                      disabled={acting}
                      onClick={() => closeRequest(r.id, "FOUND")}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-lg">
                        check_circle
                      </span>
                      {t("parts_board.mark_found")}
                    </button>
                    <button
                      aria-label={t("parts_board.close")}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-highest text-on-surface-variant transition-colors hover:text-error disabled:opacity-50"
                      disabled={acting}
                      onClick={() => closeRequest(r.id, "CLOSED")}
                      title={t("parts_board.close")}
                      type="button"
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </>
                )}
                {tab === "mine" &&
                  r.status !== "OPEN" &&
                  r._count.replies > 0 && (
                    <button
                      className="flex items-center gap-2 rounded-xl bg-surface-container-high px-4 py-2.5 font-bold text-on-surface text-sm transition-all hover:bg-surface-container-highest"
                      onClick={() => openReplies(r)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-lg">
                        forum
                      </span>
                      {t("parts_board.replies")}
                    </button>
                  )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("parts_board.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm">
            {t("parts_board.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-surface-container-low p-1">
            {(["board", "mine"] as const).map((tb) => (
              <button
                className={`rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
                  tab === tb
                    ? "bg-surface-container-lowest text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
                key={tb}
                onClick={() => setTab(tb)}
                type="button"
              >
                {tb === "board"
                  ? t("parts_board.tab_board")
                  : t("parts_board.tab_mine")}
              </button>
            ))}
          </div>
          <button
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold text-on-primary text-sm transition-all active:scale-[0.98]"
            onClick={() => setCreating(true)}
            type="button"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            {t("parts_board.new")}
          </button>
          <button
            aria-label={t("requests_refresh")}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant transition-colors hover:text-on-surface"
            onClick={load}
            type="button"
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>
      </div>

      {body}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            toast.success(t("parts_board.created_ok"));
            if (tab === "mine") {
              load();
            } else {
              setTab("mine");
            }
          }}
        />
      )}

      {replyingTo && (
        <ReplyModal
          onClose={() => setReplyingTo(null)}
          onSent={() => {
            setReplyingTo(null);
            toast.success(t("parts_board.reply_sent"));
          }}
          request={replyingTo}
        />
      )}

      {repliesOf && (
        <Modal onClose={() => setRepliesOf(null)} title={repliesOf.title}>
          {replies.length === 0 ? (
            <p className="py-6 text-center text-on-surface-variant text-sm">
              {t("parts_board.no_replies")}
            </p>
          ) : (
            <div className="space-y-3">
              {replies.map((rep) => (
                <div
                  className="rounded-xl bg-surface-container-lowest p-4"
                  key={rep.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-on-surface text-sm">
                      {rep.shop.name}
                    </span>
                    <span className="text-on-surface-variant text-xs">
                      {fmtDate(rep.createdAt)}
                    </span>
                    {rep.priceCents != null && (
                      <span className="rounded-lg bg-tertiary-container/30 px-2 py-0.5 font-bold text-on-tertiary-container text-xs">
                        {fmtCurrency(rep.priceCents / 100)}
                      </span>
                    )}
                  </div>
                  {rep.note && (
                    <p className="mt-1 whitespace-pre-wrap text-on-surface text-sm">
                      {rep.note}
                    </p>
                  )}
                  {rep.contact && (
                    <p className="mt-2 flex items-center gap-1 font-medium text-primary text-sm">
                      <span className="material-symbols-outlined text-sm">
                        call
                      </span>
                      {rep.contact}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

const EMPTY_CREATE = {
  contact: "",
  deviceBrand: "",
  deviceModel: "",
  maxPrice: "",
  notes: "",
  title: "",
};

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_CREATE);
  const [partType, setPartType] = useState<PartType>("SCREEN");
  const [condition, setCondition] = useState<PartCondition>("ANY");
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<typeof EMPTY_CREATE>) =>
    setForm((p) => ({ ...p, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || form.title.trim().length < 3) {
      return;
    }
    setBusy(true);
    try {
      const euros = Number.parseFloat(form.maxPrice.replace(",", "."));
      await createPartRequest({
        condition,
        contact: form.contact.trim() || undefined,
        deviceBrand: form.deviceBrand.trim() || undefined,
        deviceModel: form.deviceModel.trim() || undefined,
        maxPriceCents:
          Number.isFinite(euros) && euros > 0
            ? Math.round(euros * 100)
            : undefined,
        notes: form.notes.trim() || undefined,
        partType,
        title: form.title.trim(),
      });
      onCreated();
    } catch (err) {
      toast.error((err as ApiError).message || t("parts_board.action_error"));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={t("parts_board.new")}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("parts_board.f_title")} required>
          <Input
            maxLength={200}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={t("parts_board.f_title_ph")}
            required
            value={form.title}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("parts_board.f_part_type")} required>
            <Select
              onChange={(e) => setPartType(e.target.value as PartType)}
              value={partType}
            >
              {PART_TYPES.map((p) => (
                <option key={p} value={p}>
                  {t(`parts_board.type_${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("parts_board.f_condition")}>
            <Select
              onChange={(e) => setCondition(e.target.value as PartCondition)}
              value={condition}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`parts_board.cond_${c}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("parts_board.f_brand")}>
            <Input
              maxLength={100}
              onChange={(e) => set({ deviceBrand: e.target.value })}
              placeholder="Apple, Samsung…"
              value={form.deviceBrand}
            />
          </Field>
          <Field label={t("parts_board.f_model")}>
            <Input
              maxLength={100}
              onChange={(e) => set({ deviceModel: e.target.value })}
              placeholder="iPhone 12, S21…"
              value={form.deviceModel}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("parts_board.f_max_price")}>
            <Input
              inputMode="decimal"
              maxLength={10}
              onChange={(e) => set({ maxPrice: e.target.value })}
              placeholder="45,00"
              value={form.maxPrice}
            />
          </Field>
          <Field label={t("parts_board.f_contact")}>
            <Input
              maxLength={200}
              onChange={(e) => set({ contact: e.target.value })}
              placeholder={t("parts_board.f_contact_ph")}
              value={form.contact}
            />
          </Field>
        </div>
        <Field label={t("parts_board.f_notes")}>
          <Textarea
            maxLength={2000}
            onChange={(e) => set({ notes: e.target.value })}
            rows={3}
            value={form.notes}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} type="button" variant="ghost">
            {t("cancel")}
          </Button>
          <Button disabled={busy || form.title.trim().length < 3} type="submit">
            {busy ? t("saving") : t("parts_board.publish")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReplyModal({
  onClose,
  onSent,
  request,
}: {
  onClose: () => void;
  onSent: () => void;
  request: PartRequest;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !(note.trim() || price.trim() || contact.trim())) {
      return;
    }
    setBusy(true);
    try {
      const euros = Number.parseFloat(price.replace(",", "."));
      await replyToPartRequest(request.id, {
        contact: contact.trim() || undefined,
        note: note.trim() || undefined,
        priceCents:
          Number.isFinite(euros) && euros > 0
            ? Math.round(euros * 100)
            : undefined,
      });
      onSent();
    } catch (err) {
      toast.error((err as ApiError).message || t("parts_board.action_error"));
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={t("parts_board.reply_to", { title: request.title })}
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("parts_board.f_reply_note")}>
          <Textarea
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("parts_board.f_reply_note_ph")}
            rows={3}
            value={note}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("parts_board.f_reply_price")}>
            <Input
              inputMode="decimal"
              maxLength={10}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="45,00"
              value={price}
            />
          </Field>
          <Field label={t("parts_board.f_contact")}>
            <Input
              maxLength={200}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("parts_board.f_contact_ph")}
              value={contact}
            />
          </Field>
        </div>
        <p className="text-on-surface-variant text-xs">
          {t("parts_board.reply_hint")}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} type="button" variant="ghost">
            {t("cancel")}
          </Button>
          <Button disabled={busy} type="submit">
            {busy ? t("saving") : t("parts_board.send_reply")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
