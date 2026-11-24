import type { PontoHoursResponse } from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import api from "@/lib/api";
import { useUsersStore } from "@/stores/users";
import { formatDay, formatMinutes, hoursFlags } from "./shared";

function ymdDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const FLAG_STYLE: Record<string, string> = {
  correction: "bg-surface-container text-on-surface-variant",
  early: "bg-tertiary/15 text-tertiary",
  late: "bg-error/10 text-error",
  missing_exit: "bg-warning/15 text-warning",
};

function flagKind(f: string): keyof typeof FLAG_STYLE {
  if (f === "missing_exit") {
    return "missing_exit";
  }
  if (f.startsWith("late")) {
    return "late";
  }
  if (f.startsWith("early")) {
    return "early";
  }
  return "correction";
}

function flagLabel(f: string, t: TFunction): string {
  const kind = flagKind(f);
  if (kind === "missing_exit") {
    return t("ponto.flag_missing_exit");
  }
  if (kind === "late" || kind === "early") {
    return t(`ponto.flag_${kind}`, { min: f.split(":")[1] });
  }
  return t("ponto.flag_correction");
}

function FlagBadge({ flag, t }: { flag: string; t: TFunction }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${FLAG_STYLE[flagKind(flag)]}`}
    >
      {flagLabel(flag, t)}
    </span>
  );
}

function timeOrDash(iso: string | null, locale: string): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HoursTab() {
  const { i18n, t } = useTranslation();
  const [from, setFrom] = useState(ymdDaysAgo(13));
  const [to, setTo] = useState(ymdDaysAgo(0));
  const [userId, setUserId] = useState("");
  const [data, setData] = useState<PontoHoursResponse | null>(null);
  const [error, setError] = useState(false);
  const storeUsers = useUsersStore((s) => s.users);
  const fetchUsers = useUsersStore((s) => s.fetchUsers);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ from, to });
      if (userId) {
        params.set("userId", userId);
      }
      const hours = await api.get<PontoHoursResponse>(`/ponto/hours?${params}`);
      setData(hours.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [from, to, userId]);

  useEffect(() => {
    load().catch(() => undefined);
    if (storeUsers.length === 0) {
      fetchUsers().catch(() => undefined);
    }
  }, [load, storeUsers.length, fetchUsers]);

  const users = useMemo(
    () => storeUsers.map((u) => ({ id: u.id, name: u.name || u.username })),
    [storeUsers]
  );

  // userId pode ficar stale se o utilizador for desativado — ignora.
  const userOptions = useMemo(
    () => [{ id: "", name: t("ponto.all_users") }, ...users],
    [users, t]
  );

  if (error) {
    return (
      <div className="rounded-2xl bg-error-container p-4 text-center text-on-error-container text-sm">
        {t("ponto.load_failed")}
        <Button className="ms-3" onClick={load} size="sm" variant="secondary">
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("ponto.from")}>
          <input
            className="rounded-lg border border-outline bg-surface-container-lowest px-3 py-2 text-sm"
            onChange={(e) => setFrom(e.target.value)}
            type="date"
            value={from}
          />
        </Field>
        <Field label={t("ponto.to")}>
          <input
            className="rounded-lg border border-outline bg-surface-container-lowest px-3 py-2 text-sm"
            onChange={(e) => setTo(e.target.value)}
            type="date"
            value={to}
          />
        </Field>
        <Field label={t("ponto.user_filter")}>
          <Select onChange={(e) => setUserId(e.target.value)} value={userId}>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button icon="refresh" onClick={load} size="sm" variant="secondary">
          {t("refresh")}
        </Button>
      </div>

      {!(data || error) && (
        <div className="h-48 animate-pulse rounded-xl bg-surface-container-low" />
      )}
      {data && data.days.length === 0 && (
        <div className="rounded-2xl bg-surface-container-low p-8 text-center text-on-surface-variant text-sm">
          {t("ponto.hours_empty")}
        </div>
      )}
      {data && data.days.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-surface-container-lowest">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-outline-variant border-b text-left text-on-surface-variant text-xs">
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_date")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_user")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_worked")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_first")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_last")}
                </th>
                <th className="px-4 py-3 font-semibold">
                  {t("ponto.col_flags")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr
                  className="border-outline-variant/50 border-b last:border-0"
                  key={`${d.userId}-${d.date}`}
                >
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {formatDay(d.date, i18n.language)}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{d.userName}</td>
                  <td className="px-4 py-2.5 font-bold">
                    {formatMinutes(d.hours.workedMinutes)}
                  </td>
                  <td className="px-4 py-2.5 text-on-surface-variant">
                    {timeOrDash(d.hours.firstEntradaAt, i18n.language)}
                  </td>
                  <td className="px-4 py-2.5 text-on-surface-variant">
                    {timeOrDash(d.hours.lastSaidaAt, i18n.language)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {hoursFlags(d.hours).map((f) => (
                        <FlagBadge flag={f} key={f} t={t} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
