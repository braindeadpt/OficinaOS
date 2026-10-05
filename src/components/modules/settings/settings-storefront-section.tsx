import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import api, { getErrorMessage } from "@/lib/api";

interface StorefrontStatus {
  description: string | null;
  dirty: boolean;
  email: string | null;
  itemCount: number;
  module: boolean;
  paired: boolean;
  published: boolean;
  slug: string | null;
  url: string | null;
}

export default function SettingsStorefrontSection({
  onToast,
}: {
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StorefrontStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [published, setPublished] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<StorefrontStatus>("/storefront");
      setStatus(res.data);
      setSlug(res.data.slug ?? "");
      setDescription(res.data.description ?? "");
      setEmail(res.data.email ?? "");
      setPublished(res.data.published);
    } catch {
      // Section is best-effort: the Cloud tab still works without it.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => null);
  }, [refresh]);

  async function handleSave() {
    setBusy(true);
    try {
      const res = await api.put<StorefrontStatus>("/storefront", {
        description,
        email,
        published,
        slug,
      });
      setStatus(res.data);
      setSlug(res.data.slug ?? "");
      setPublished(res.data.published);
      onToast(t("storefront.saved"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("storefront.save_failed")), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!status?.module) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-on-surface text-sm">
            {t("storefront.title")}
          </div>
          <p className="text-on-surface-variant text-xs">
            {t("storefront.subtitle")}
          </p>
        </div>
        {status.url && (
          <a
            className="text-primary text-xs underline"
            href={status.url}
            rel="noreferrer"
            target="_blank"
          >
            {status.url}
          </a>
        )}
      </div>

      <Field label={t("storefront.slug")}>
        <Input
          autoComplete="off"
          onChange={(e) => setSlug(e.target.value)}
          placeholder={t("storefront.slug_placeholder")}
          value={slug}
        />
      </Field>

      <Field label={t("storefront.description")}>
        <Input
          autoComplete="off"
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("storefront.description_placeholder")}
          value={description}
        />
      </Field>

      <Field label={t("storefront.email")}>
        <Input
          autoComplete="off"
          inputMode="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("storefront.email_placeholder")}
          value={email}
        />
      </Field>

      <div className="flex items-center justify-between">
        <p
          className="font-medium text-on-surface text-sm"
          id="storefront-published-label"
        >
          {t("storefront.published")}
        </p>
        <Switch
          ariaLabelledBy="storefront-published-label"
          checked={published}
          onChange={setPublished}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-on-surface-variant text-xs">
          {t("storefront.items_listed", { count: status.itemCount })}
          {status.dirty ? ` — ${t("storefront.sync_pending")}` : ""}
        </p>
        <Button disabled={busy} icon="save" onClick={handleSave}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
