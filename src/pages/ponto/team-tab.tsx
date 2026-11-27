import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { PontoUserPayload } from "@/stores/users";
import { useUsersStore } from "@/stores/users";
import TeamInfoSheets from "./team-info-sheets";

interface EditState {
  externalWork: boolean;
  phoneE164: string;
  pontoEnabled: boolean;
  pontoScheduleEnd: string;
  pontoScheduleExempt: boolean;
  pontoScheduleStart: string;
  pontoSmsAllowed: boolean;
  pontoTeleworkDays: number[];
  userId: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const E164 = /^\+?[1-9]\d{7,14}$/;

function SwitchRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch ariaLabel={label} checked={checked} onChange={onChange} />
    </div>
  );
}

export default function TeamTab() {
  const { i18n, t } = useTranslation();
  const users = useUsersStore((s) => s.users);
  const isLoading = useUsersStore((s) => s.isLoading);
  const allUsersLoaded = useUsersStore((s) => s.allUsersLoaded);
  // fetchAllUsers: GET /users é paginado (20/pág por defeito) e a aba
  // equipa precisa de toda a gente — sem isto só apareciam 20.
  const fetchAllUsers = useUsersStore((s) => s.fetchAllUsers);
  const updateUserProfile = useUsersStore((s) => s.updateUserProfile);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!allUsersLoaded) {
      fetchAllUsers().catch(() => undefined);
    }
  }, [allUsersLoaded, fetchAllUsers]);

  const openEdit = (u: (typeof users)[number]) => {
    setFormError(null);
    setEditing({
      externalWork: u.externalWork,
      phoneE164: u.phoneE164 ?? "",
      pontoEnabled: u.pontoEnabled,
      pontoScheduleEnd: u.pontoScheduleEnd ?? "",
      pontoScheduleExempt: u.pontoScheduleExempt,
      pontoScheduleStart: u.pontoScheduleStart ?? "",
      pontoSmsAllowed: u.pontoSmsAllowed,
      pontoTeleworkDays: u.pontoTeleworkDays ?? [],
      userId: u.id,
    });
  };

  const save = async () => {
    if (!editing) {
      return;
    }
    const phone = editing.phoneE164.trim();
    const start = editing.pontoScheduleStart.trim();
    const end = editing.pontoScheduleEnd.trim();
    if (phone && !E164.test(phone)) {
      setFormError(t("ponto.err_phone"));
      return;
    }
    if ((start && !HHMM.test(start)) || (end && !HHMM.test(end))) {
      setFormError(t("ponto.err_schedule"));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const payload: PontoUserPayload = {
        externalWork: editing.externalWork,
        phoneE164: phone || null,
        pontoEnabled: editing.pontoEnabled,
        pontoScheduleEnd: end || null,
        pontoScheduleExempt: editing.pontoScheduleExempt,
        pontoScheduleStart: start || null,
        pontoSmsAllowed: editing.pontoSmsAllowed,
        pontoTeleworkDays: editing.pontoTeleworkDays,
      };
      await updateUserProfile(editing.userId, payload);
      setEditing(null);
      // Ativar/desativar o ponto muda quem precisa da folha RGPD — o
      // aviso do painel e a lista de entregas refrescam sem recarregar.
      window.dispatchEvent(new Event("ponto-info-deliveries-changed"));
    } catch {
      setFormError(t("ponto.err_save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-on-surface-variant text-sm">{t("ponto.team_hint")}</p>
      {isLoading && users.length === 0 ? (
        <div className="h-48 animate-pulse rounded-xl bg-surface-container-low" />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface-container-lowest">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-outline-variant border-b text-left text-on-surface-variant text-xs">
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_user")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_phone")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_ponto")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_schedule")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_flags")}
                </th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  className="border-outline-variant/50 border-b last:border-0"
                  key={u.id}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{u.name || u.username}</p>
                    <p className="text-on-surface-variant text-xs">
                      {u.username}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-on-surface-variant">
                    {u.phoneE164 ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {u.pontoEnabled ? (
                      <Badge variant="success">{t("ponto.enabled")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("ponto.disabled")}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-on-surface-variant">
                    {u.pontoScheduleStart && u.pontoScheduleEnd
                      ? `${u.pontoScheduleStart}–${u.pontoScheduleEnd}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.externalWork && (
                        <Badge variant="tertiary">
                          {t("ponto.flag_external")}
                        </Badge>
                      )}
                      {u.pontoScheduleExempt && (
                        <Badge variant="tertiary">
                          {t("ponto.flag_schedule_exempt")}
                        </Badge>
                      )}
                      {u.pontoSmsAllowed && (
                        <Badge variant="tertiary">{t("ponto.flag_sms")}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      icon="edit"
                      onClick={() => openEdit(u)}
                      size="sm"
                      variant="secondary"
                    >
                      {t("edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        onClose={() => setEditing(null)}
        open={editing !== null}
        title={t("ponto.team_edit_title")}
      >
        {editing && (
          <div className="space-y-4">
            <Field label={t("ponto.phone_label")}>
              <Input
                onChange={(e) =>
                  setEditing({ ...editing, phoneE164: e.target.value })
                }
                placeholder="+351 9…"
                value={editing.phoneE164}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("ponto.schedule_start")}>
                <Input
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      pontoScheduleStart: e.target.value,
                    })
                  }
                  type="time"
                  value={editing.pontoScheduleStart}
                />
              </Field>
              <Field label={t("ponto.schedule_end")}>
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, pontoScheduleEnd: e.target.value })
                  }
                  type="time"
                  value={editing.pontoScheduleEnd}
                />
              </Field>
            </div>
            <div className="space-y-3">
              <SwitchRow
                checked={editing.pontoEnabled}
                label={t("ponto.sw_enabled")}
                onChange={(v) => setEditing({ ...editing, pontoEnabled: v })}
              />
              <SwitchRow
                checked={editing.externalWork}
                label={t("ponto.sw_external")}
                onChange={(v) => setEditing({ ...editing, externalWork: v })}
              />
              <SwitchRow
                checked={editing.pontoSmsAllowed}
                label={t("ponto.sw_sms")}
                onChange={(v) => setEditing({ ...editing, pontoSmsAllowed: v })}
              />
              <SwitchRow
                checked={editing.pontoScheduleExempt}
                label={t("ponto.sw_schedule_exempt")}
                onChange={(v) =>
                  setEditing({ ...editing, pontoScheduleExempt: v })
                }
              />
              <div>
                <span className="text-sm">{t("ponto.team_telework_days")}</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                    const active = editing.pontoTeleworkDays.includes(day);
                    // Nome do dia pela língua da UI — sem chaves novas:
                    // 2024-01-01 é uma segunda-feira (ISO 1).
                    const label = new Intl.DateTimeFormat(i18n.language, {
                      weekday: "short",
                    }).format(new Date(2024, 0, day));
                    return (
                      <button
                        aria-pressed={active}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          active
                            ? "border-primary bg-primary text-on-primary"
                            : "border-outline-variant text-on-surface-variant"
                        }`}
                        key={day}
                        onClick={() =>
                          setEditing({
                            ...editing,
                            pontoTeleworkDays: active
                              ? editing.pontoTeleworkDays.filter(
                                  (d) => d !== day
                                )
                              : [...editing.pontoTeleworkDays, day].sort(),
                          })
                        }
                        type="button"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-on-surface-variant text-xs">
                  {t("ponto.team_telework_explain")}
                </p>
              </div>
            </div>
            {formError && <p className="text-error text-sm">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditing(null)} variant="secondary">
                {t("cancel")}
              </Button>
              <Button disabled={busy} onClick={save}>
                {t("save")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <TeamInfoSheets />
    </div>
  );
}
