import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import api, { getErrorMessage } from "@/lib/api";

interface StorefrontStatus {
  accentColor: string | null;
  description: string | null;
  dirty: boolean;
  email: string | null;
  itemCount: number;
  logoData: string | null;
  module: boolean;
  paired: boolean;
  plus: boolean;
  published: boolean;
  slug: string | null;
  template: string;
  url: string | null;
}

// ~200KB binary — matches the cap the cloud enforces on the base64 payload.
const LOGO_MAX_BYTES = 200 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
  const [accentColor, setAccentColor] = useState("#0040a1");
  const [template, setTemplate] = useState("vitrine");
  const [logoData, setLogoData] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<StorefrontStatus>("/storefront");
      setStatus(res.data);
      setSlug(res.data.slug ?? "");
      setDescription(res.data.description ?? "");
      setEmail(res.data.email ?? "");
      setPublished(res.data.published);
      setAccentColor(res.data.accentColor ?? "#0040a1");
      setTemplate(res.data.template ?? "vitrine");
      setLogoData(res.data.logoData);
    } catch {
      // Section is best-effort: the Cloud tab still works without it.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => null);
  }, [refresh]);

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }
    if (!LOGO_TYPES.has(file.type) || file.size > LOGO_MAX_BYTES) {
      onToast(t("storefront.logo_invalid"), "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoData(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setBusy(true);
    try {
      const res = await api.put<StorefrontStatus>("/storefront", {
        description,
        email,
        published,
        slug,
        ...(status?.plus
          ? {
              accentColor,
              logo: logoData ?? "",
              template,
            }
          : {}),
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

      {status.plus ? (
        <>
          <Field label={t("storefront.accent_color")}>
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("storefront.accent_color")}
                className="h-9 w-12 cursor-pointer rounded-lg border border-outline-variant bg-surface p-1"
                onChange={(e) => setAccentColor(e.target.value)}
                type="color"
                value={accentColor}
              />
              <Input
                autoComplete="off"
                className="w-28"
                maxLength={7}
                onChange={(e) => setAccentColor(e.target.value)}
                value={accentColor}
              />
            </div>
          </Field>

          <Field label={t("storefront.template")}>
            <Select
              onChange={(e) => setTemplate(e.target.value)}
              value={template}
            >
              <option value="vitrine">
                {t("storefront.template_vitrine")}
              </option>
              <option value="compacta">
                {t("storefront.template_compacta")}
              </option>
            </Select>
          </Field>

          <Field label={t("storefront.logo")}>
            <div>
              <Input
                accept="image/png,image/jpeg,image/webp"
                aria-label={t("storefront.logo")}
                className="hidden"
                onChange={handleLogoFile}
                ref={logoInput}
                type="file"
              />
              <div className="flex items-center gap-3">
                {logoData && (
                  <img
                    alt={t("storefront.logo")}
                    className="h-12 w-12 rounded-xl border border-outline-variant bg-surface object-contain"
                    height={48}
                    src={logoData}
                    width={48}
                  />
                )}
                <Button
                  icon="upload"
                  onClick={() => logoInput.current?.click()}
                  variant="secondary"
                >
                  {t("storefront.logo_upload")}
                </Button>
                {logoData && (
                  <Button onClick={() => setLogoData(null)} variant="ghost">
                    {t("storefront.logo_remove")}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-on-surface-variant text-xs">
                {t("storefront.logo_hint")}
              </p>
            </div>
          </Field>
        </>
      ) : (
        <p className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
          {t("storefront.plus_upsell")}
        </p>
      )}

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
