import type { PontoHoursResponse } from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import api from "@/lib/api";
import { useUsersStore } from "@/stores/users";
import {
  formatClock,
  formatDay,
  formatMinutes,
  hoursFlags,
  useShopTz,
  ymdDaysAgo,
} from "./shared";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

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

export default function HoursTab() {
  const { i18n, t } = useTranslation();
  const shopTz = useShopTz();
  const tz = shopTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [from, setFrom] = useState(() => ymdDaysAgo(13, tz));
  const [to, setTo] = useState(() => ymdDaysAgo(0, tz));
  const [userId, setUserId] = useState("");
  const [data, setData] = useState<PontoHoursResponse | null>(null);
  const [error, setError] = useState(false);
  const storeUsers = useUsersStore((s) => s.users);
  const fetchAllUsers = useUsersStore((s) => s.fetchAllUsers);
  const allUsersLoaded = useUsersStore((s) => s.allUsersLoaded);

  const datesValid = useMemo(
    () => YMD.test(from) && YMD.test(to) && from <= to,
    [from, to]
  );

  const load = useCallback(async () => {
    if (!datesValid) {
      return;
    }
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
  }, [datesValid, from, to, userId]);

  useEffect(() => {
    load().catch(() => undefined);
    // allUsersLoaded distingue "fetchUsers trouxe 1 página" de "lista
    // completa" — sem isto o filtro só mostrava os primeiros 20.
    if (!allUsersLoaded) {
      fetchAllUsers().catch(() => undefined);
    }
  }, [load, allUsersLoaded, fetchAllUsers]);

  const users = useMemo(
    () => storeUsers.map((u) => ({ id: u.id, name: u.name || u.username })),
    [storeUsers]
  );

  // userId pode ficar stale se o utilizador for desativado — ignora.
  const userOptions = useMemo(
    () => [{ id: "", name: t("ponto.all_users") }, ...users],
    [users, t]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("ponto.from")}>
          <Input
            onChange={(e) => setFrom(e.target.value)}
            type="date"
            value={from}
          />
        </Field>
        <Field label={t("ponto.to")}>
          <Input
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
        <Button
          disabled={!datesValid}
          icon="refresh"
          onClick={load}
          size="sm"
          variant="secondary"
        >
          {t("refresh")}
        </Button>
      </div>

      {!datesValid && (
        <p className="text-on-surface-variant text-sm">
          {t("ponto.dates_invalid")}
        </p>
      )}
      {datesValid && error && (
        <div className="rounded-2xl bg-error-container p-4 text-center text-on-error-container text-sm">
          {t("ponto.load_failed")}
          <Button className="ms-3" onClick={load} size="sm" variant="secondary">
            {t("retry")}
          </Button>
        </div>
      )}
      {datesValid && !(error || data) && (
        <div className="h-48 animate-pulse rounded-xl bg-surface-container-low" />
      )}
      {datesValid && data && data.days.length === 0 && (
        <div className="rounded-2xl bg-surface-container-low p-8 text-center text-on-surface-variant text-sm">
          {t("ponto.hours_empty")}
        </div>
      )}
      {datesValid && data && data.days.length > 0 && (
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
                    {formatClock(d.hours.firstEntradaAt, i18n.language, tz)}
                  </td>
                  <td className="px-4 py-2.5 text-on-surface-variant">
                    {formatClock(d.hours.lastSaidaAt, i18n.language, tz)}
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
