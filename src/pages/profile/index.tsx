import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { ProfileSidebar } from "@/components/modules/profile/profile-sidebar";
import { ProfileTabContent } from "@/components/modules/profile/profile-tab-content";
import SessionsModal from "@/components/modules/profile/sessions-modal";
import type {
  ActivityItem,
  SessionItem,
} from "@/components/modules/profile/shared";
import ResetPasswordModal from "@/components/modules/settings/reset-password-modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useProfileMultiUser } from "@/hooks/use-profile-multi-user";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useUsersStore } from "@/stores/users";

type ProfileTab = "personal" | "security" | "activity";

const DEFAULT_TAB: ProfileTab = "personal";

const TAB_IDS: Record<ProfileTab, string> = {
  personal: "profile-tab-personal",
  security: "profile-tab-security",
  activity: "profile-tab-activity",
};

const TAB_ICONS: Record<ProfileTab, string> = {
  personal: "person",
  security: "lock",
  activity: "history",
};

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    avatarUploading,
    displayUser,
    fileInputRef,
    handleAvatarRemove,
    handleAvatarUpload,
    isSelf,
    userId,
  } = useProfileMultiUser(role);

  const displayName = displayUser.name || t("default_user_display");
  const initials = useMemo(
    () => displayUser.name?.charAt(0)?.toUpperCase() ?? "?",
    [displayUser.name]
  );

  const tabParam = searchParams.get("tab") as ProfileTab | null;
  const activeTab: ProfileTab =
    tabParam && ["personal", "security", "activity"].includes(tabParam)
      ? tabParam
      : DEFAULT_TAB;

  function setActiveTab(tab: ProfileTab) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });
  }

  const [editing, setEditing] = useState(false);
  const [personalDirty, setPersonalDirty] = useState(false);
  const [securityDirty, setSecurityDirty] = useState(false);
  const [personalSubmitting, setPersonalSubmitting] = useState(false);
  const [securitySubmitting, setSecuritySubmitting] = useState(false);
  const [personalSuccess, setPersonalSuccess] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const personalSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const passwordSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(
    () => () => {
      if (personalSuccessTimer.current) {
        clearTimeout(personalSuccessTimer.current);
      }
      if (passwordSuccessTimer.current) {
        clearTimeout(passwordSuccessTimer.current);
      }
    },
    []
  );

  const detectLanguage = useCallback((): string => {
    if (i18n.language.startsWith("fr")) {
      return "fr";
    }
    if (i18n.language.startsWith("en")) {
      return "en";
    }
    if (i18n.language.startsWith("es")) {
      return "es";
    }
    return "pt";
  }, [i18n.language]);

  const personalFormDefault = useMemo(
    () => ({
      name: displayUser.name || displayUser.username || "",
      email: displayUser.email || "",
      language: detectLanguage(),
      username: displayUser.username || "",
    }),
    [displayUser.name, displayUser.username, displayUser.email, detectLanguage]
  );

  const [personalForm, setPersonalForm] = useState(personalFormDefault);
  const [personalInitial, setPersonalInitial] = useState(personalFormDefault);
  const prevUserIdRef = useRef<string>("");

  useEffect(() => {
    if (displayUser.id !== prevUserIdRef.current) {
      prevUserIdRef.current = displayUser.id;
      if (!personalDirty) {
        setPersonalForm(personalFormDefault);
        setPersonalInitial(personalFormDefault);
      }
    }
  }, [displayUser.id, personalFormDefault, personalDirty]);

  const [securityForm, setSecurityForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [personalError, setPersonalError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [hasMoreActivity, setHasMoreActivity] = useState(false);
  const [stats, setStats] = useState({ completedJobs: 0, monthlyJobs: 0 });
  const [statsLoading, setStatsLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);

  const personalFormRef = useRef<HTMLFormElement>(null);
  const securityFormRef = useRef<HTMLFormElement>(null);

  const loadActivity = useCallback(
    async (append = false) => {
      if (!userId) {
        return;
      }
      setActivityLoading(true);
      try {
        const params: Record<string, string> = {};
        if (append && activityCursor) {
          params.cursor = activityCursor;
        }
        const res = await api.get(`/users/${userId}/activity`, { params });
        const data = res.data;
        const items: ActivityItem[] = data.items ?? data;
        if (append) {
          setActivity((prev) => [...prev, ...items]);
        } else {
          setActivity(items);
        }
        setActivityCursor(data.nextCursor ?? null);
        setHasMoreActivity(!!data.nextCursor);
      } catch {
        if (!append) {
          setActivity([]);
        }
      } finally {
        setActivityLoading(false);
      }
    },
    [userId, activityCursor]
  );

  const loadStats = useCallback(async () => {
    if (!userId) {
      return;
    }
    setStatsLoading(true);
    try {
      const res = await api.get(`/users/${userId}/stats`);
      setStats(res.data);
    } catch {
      setStats({ completedJobs: 0, monthlyJobs: 0 });
    } finally {
      setStatsLoading(false);
    }
  }, [userId]);

  const loadSessions = useCallback(async () => {
    if (!userId) {
      return;
    }
    setSessionsLoading(true);
    try {
      const res = await api.get(`/users/${userId}/sessions`);
      setSessions(res.data);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [userId]);

  function openSessionsModal() {
    loadSessions();
    setShowSessionsModal(true);
  }

  async function handleRevokeSession(sessionId: string) {
    if (!userId) {
      return;
    }
    try {
      await api.delete(`/users/${userId}/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      // error handled by interceptor
    }
  }

  const loadActivityRef = useRef(loadActivity);
  loadActivityRef.current = loadActivity;

  useEffect(() => {
    if (activeTab === "activity") {
      setActivityCursor(null);
      setHasMoreActivity(false);
      setActivity([]);
      loadActivityRef.current();
    }
  }, [activeTab]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (activeTab === "security") {
      loadSessions();
    }
  }, [activeTab, loadSessions]);

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "personal", label: t("profile_tab_personal") },
    { key: "security", label: t("profile_tab_security") },
    { key: "activity", label: t("profile_tab_activity") },
  ];

  async function handlePersonalSubmit(e: FormEvent) {
    e.preventDefault();
    setPersonalError("");
    setPersonalSuccess("");
    if (!userId) {
      return;
    }
    setPersonalSubmitting(true);
    try {
      await api.patch(`/users/${userId}`, {
        name: personalForm.name,
        email: personalForm.email,
        username: personalForm.username,
      });
      if (isSelf) {
        useAuthStore.getState().updateUser({
          name: personalForm.name,
          email: personalForm.email,
          username: personalForm.username,
        });
        if (personalForm.language !== detectLanguage()) {
          i18n.changeLanguage(personalForm.language);
        }
      }
      setPersonalInitial(personalForm);
      setPersonalDirty(false);
      setEditing(false);
      setPersonalSuccess(t("profile_info_updated"));
      if (personalSuccessTimer.current) {
        clearTimeout(personalSuccessTimer.current);
      }
      personalSuccessTimer.current = setTimeout(
        () => setPersonalSuccess(""),
        4000
      );
    } catch {
      setPersonalError(t("profile_update_failed"));
    } finally {
      setPersonalSubmitting(false);
    }
  }

  async function handleSecuritySubmit(e: FormEvent) {
    e.preventDefault();
    if (!securityForm.newPassword.trim()) {
      return;
    }
    if (securityForm.newPassword !== securityForm.confirmPassword) {
      setPasswordError(t("profile_password_mismatch"));
      return;
    }
    if (securityForm.newPassword && !securityForm.currentPassword) {
      setPasswordError(t("profile_current_password_required"));
      return;
    }
    setPasswordError("");
    setPasswordSuccess("");
    setSecuritySubmitting(true);
    try {
      await api.post("/auth/change-password", {
        oldPassword: securityForm.currentPassword,
        newPassword: securityForm.newPassword,
      });
      setSecurityForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setSecurityDirty(false);
      setPasswordSuccess(t("profile_password_updated"));
      if (passwordSuccessTimer.current) {
        clearTimeout(passwordSuccessTimer.current);
      }
      passwordSuccessTimer.current = setTimeout(
        () => setPasswordSuccess(""),
        4000
      );
    } catch {
      setPasswordError(t("profile_password_update_failed"));
    } finally {
      setSecuritySubmitting(false);
    }
  }

  function handleCancelPersonal() {
    setPersonalForm(personalInitial);
    setPersonalDirty(false);
    setEditing(false);
    setPersonalError("");
    setPersonalSuccess("");
  }

  function handleCancelSecurity() {
    setSecurityForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setPasswordError("");
    setSecurityDirty(false);
  }

  function handleCancelAll() {
    if (personalDirty) {
      handleCancelPersonal();
    }
    if (securityDirty) {
      handleCancelSecurity();
    }
  }

  function handleSaveAll() {
    if (personalDirty) {
      personalFormRef.current?.requestSubmit();
    }
    if (securityDirty) {
      securityFormRef.current?.requestSubmit();
    }
  }

  const isDirty = personalDirty || securityDirty;

  return (
    <>
      {!isSelf && (
        <button
          className="mb-4 flex min-h-[44px] items-center gap-1 font-semibold text-primary text-sm transition-colors hover:underline"
          onClick={() => navigate("/settings")}
          type="button"
        >
          <Icon name="arrow_back" size="sm" />
          {t("profile_back_to_users")}
        </button>
      )}

      <div className="mb-8">
        <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
          {isSelf
            ? t("profile_title")
            : t("profile_viewing_user", { name: displayName })}
        </h2>
        <p className="mt-1 text-on-surface-variant text-sm md:text-base">
          {t("profile_subtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <ProfileSidebar
          avatarUploading={avatarUploading}
          displayName={displayName}
          fileInputRef={fileInputRef}
          handleAvatarRemove={handleAvatarRemove}
          handleAvatarUpload={handleAvatarUpload}
          image={displayUser.image}
          initials={initials}
          isSelf={isSelf}
          onAvatarError={(msg) => setPersonalError(t(msg))}
          role={displayUser.role}
          stats={stats}
          statsLoading={statsLoading}
        />

        <section className="min-w-0 flex-1 space-y-6">
          <div
            aria-label={t("profile_title")}
            className="flex gap-2"
            role="tablist"
          >
            {tabs.map(({ key, label }) => (
              <button
                aria-controls={`profile-panel-${key}`}
                aria-selected={activeTab === key}
                className={`min-h-[44px] rounded-lg px-4 py-2.5 font-medium text-sm transition-all ${
                  activeTab === key
                    ? "bg-primary-tint font-bold text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
                id={TAB_IDS[key]}
                key={key}
                onClick={() => setActiveTab(key)}
                role="tab"
                type="button"
              >
                <Icon
                  className="me-1.5 align-middle"
                  name={TAB_ICONS[key]}
                  size="xs"
                />
                <span className="align-middle">{label}</span>
              </button>
            ))}
          </div>

          <div
            aria-labelledby={TAB_IDS[activeTab]}
            className="rounded-lg bg-surface-container-lowest p-6 shadow-sm md:p-8"
            id={`profile-panel-${activeTab}`}
            role="tabpanel"
          >
            <ProfileTabContent
              activeTab={activeTab}
              activity={activity}
              activityLoading={activityLoading}
              editing={editing}
              handleCancelPersonal={handleCancelPersonal}
              handlePersonalSubmit={handlePersonalSubmit}
              handleSecuritySubmit={handleSecuritySubmit}
              hasMoreActivity={hasMoreActivity}
              isSelf={isSelf}
              loadMoreActivity={() => loadActivity(true)}
              onEdit={() => setEditing(true)}
              onOpenSessionsModal={openSessionsModal}
              passwordError={passwordError}
              passwordSuccess={passwordSuccess}
              personalDirty={personalDirty}
              personalError={personalError}
              personalForm={personalForm}
              personalFormRef={personalFormRef}
              personalInitial={personalInitial}
              personalSubmitting={personalSubmitting}
              personalSuccess={personalSuccess}
              securityDirty={securityDirty}
              securityForm={securityForm}
              securityFormRef={securityFormRef}
              securitySubmitting={securitySubmitting}
              sessions={sessions}
              sessionsLoading={sessionsLoading}
              setPasswordError={setPasswordError}
              setPasswordSuccess={setPasswordSuccess}
              setPersonalDirty={setPersonalDirty}
              setPersonalForm={setPersonalForm}
              setSecurityDirty={setSecurityDirty}
              setSecurityForm={setSecurityForm}
              setShowResetModal={setShowResetModal}
            />
          </div>

          {isDirty && (
            <div
              className="flex items-center justify-between rounded-lg bg-surface-container-highest px-4 py-3 shadow-sm"
              role="status"
            >
              <div className="flex items-center gap-3">
                <Icon className="text-primary" name="info" size="sm" />
                <span className="font-medium text-on-surface-variant text-sm">
                  {t("profile_unsaved_changes")}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleCancelAll}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("cancel")}
                </Button>
                <Button
                  icon="save"
                  onClick={handleSaveAll}
                  size="sm"
                  type="button"
                  variant="primary"
                >
                  {t("save_changes")}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {showResetModal && !isSelf && userId && (
        <ResetPasswordModal
          onClose={() => setShowResetModal(false)}
          onSubmit={async (password) => {
            await useUsersStore.getState().resetUserPassword(userId, password);
            setShowResetModal(false);
          }}
          username={displayUser.username}
        />
      )}

      {showSessionsModal && (
        <SessionsModal
          loading={sessionsLoading}
          onClose={() => setShowSessionsModal(false)}
          onRevoke={handleRevokeSession}
          sessions={sessions}
        />
      )}
    </>
  );
}
