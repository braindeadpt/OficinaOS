import { useTranslation } from "react-i18next";
import { ActivityItemRow } from "@/components/modules/profile/activity-timeline";
import { PasswordForm } from "@/components/modules/profile/password-form";
import { PersonalForm } from "@/components/modules/profile/personal-form";
import { PersonalSpecSheet } from "@/components/modules/profile/personal-spec-sheet";
import { SessionButton } from "@/components/modules/profile/session-button";
import type { ActivityItem } from "@/components/modules/profile/shared";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ThemeToggle } from "@/components/ui/theme-toggle";

function ActivitySkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="flex gap-4" key={`skel-${String(i)}`}>
          <div className="h-8 w-8 animate-pulse rounded-full bg-surface-container-high" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container-high" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-surface-container-highest" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          className="flex items-center justify-between rounded-lg bg-surface-container-low p-4"
          key={`skel-${String(i)}`}
        >
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-pulse rounded-full bg-surface-container-high" />
            <div className="space-y-1.5">
              <div className="h-4 w-24 animate-pulse rounded bg-surface-container-high" />
              <div className="h-3 w-32 animate-pulse rounded bg-surface-container-highest" />
            </div>
          </div>
          <div className="h-3 w-16 animate-pulse rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}

interface ProfileTabContentProps {
  activeTab: string;
  activity: ActivityItem[];
  activityLoading: boolean;
  editing: boolean;
  handleCancelPersonal: () => void;
  handlePersonalSubmit: (e: React.FormEvent) => void;
  handleSecuritySubmit: (e: React.FormEvent) => void;
  hasMoreActivity: boolean;
  isSelf: boolean;
  loadMoreActivity: () => void;
  onEdit: () => void;
  onOpenSessionsModal: () => void;
  passwordError: string;
  passwordSuccess: string;
  personalDirty: boolean;
  personalError: string;
  personalForm: {
    email: string;
    language: string;
    name: string;
    username: string;
  };
  personalFormRef: React.RefObject<HTMLFormElement | null>;
  personalInitial: { language: string };
  personalSubmitting: boolean;
  personalSuccess: string;
  securityDirty: boolean;
  securityForm: {
    confirmPassword: string;
    currentPassword: string;
    newPassword: string;
  };
  securityFormRef: React.RefObject<HTMLFormElement | null>;
  securitySubmitting: boolean;
  sessions: { length: number };
  sessionsLoading: boolean;
  setPasswordError: (error: string) => void;
  setPasswordSuccess: (success: string) => void;
  setPersonalDirty: (dirty: boolean) => void;
  setPersonalForm: React.Dispatch<
    React.SetStateAction<{
      email: string;
      language: string;
      name: string;
      username: string;
    }>
  >;
  setSecurityDirty: (dirty: boolean) => void;
  setSecurityForm: React.Dispatch<
    React.SetStateAction<{
      confirmPassword: string;
      currentPassword: string;
      newPassword: string;
    }>
  >;
  setShowResetModal: (show: boolean) => void;
}

export function ProfileTabContent({
  activeTab,
  activity,
  activityLoading,
  editing,
  hasMoreActivity,
  isSelf,
  loadMoreActivity,
  onEdit,
  onOpenSessionsModal,
  personalDirty,
  personalError,
  personalForm,
  personalFormRef,
  personalInitial,
  personalSubmitting,
  personalSuccess,
  securityDirty,
  securityForm,
  securityFormRef,
  securitySubmitting,
  sessions,
  sessionsLoading,
  handlePersonalSubmit,
  handleSecuritySubmit,
  setPersonalDirty,
  setPasswordError,
  setPasswordSuccess,
  setPersonalForm,
  setSecurityDirty,
  setSecurityForm,
  setShowResetModal,
  passwordError,
  passwordSuccess,
  handleCancelPersonal,
}: ProfileTabContentProps) {
  const { t } = useTranslation();

  if (activeTab === "personal") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-bold font-headline text-lg text-on-surface">
            {t("profile_tab_personal")}
          </h3>
          {isSelf && !editing && (
            <Button
              icon="edit"
              onClick={onEdit}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("profile_edit")}
            </Button>
          )}
        </div>
        {editing ? (
          <PersonalForm
            error={personalError}
            form={personalForm}
            formRef={personalFormRef}
            initialLanguage={personalInitial.language}
            isDirty={personalDirty}
            isSubmitting={personalSubmitting}
            onCancel={handleCancelPersonal}
            onChange={(field, value) => {
              setPersonalForm((f) => ({ ...f, [field]: value }));
              setPersonalDirty(true);
            }}
            onSubmit={handlePersonalSubmit}
          />
        ) : (
          <PersonalSpecSheet
            error={personalError}
            form={personalForm}
            success={personalSuccess}
          />
        )}
        {isSelf && (
          <div className="border-outline-variant border-t pt-6">
            <ThemeToggle />
          </div>
        )}
      </div>
    );
  }

  if (activeTab === "security" && !isSelf) {
    return (
      <section aria-label={t("profile_tab_security")} className="space-y-6">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-on-surface text-sm uppercase tracking-wider">
            {t("profile_change_password")}
          </h4>
          <Button
            icon="lock_reset"
            onClick={() => setShowResetModal(true)}
            type="button"
            variant="primary"
          >
            {t("reset_password_title")}
          </Button>
        </div>
        <div className="h-2 rounded-full bg-surface-container-low" />
        {sessionsLoading ? (
          <SessionSkeleton />
        ) : (
          <SessionButton
            loading={sessionsLoading}
            onClick={onOpenSessionsModal}
            sessionCount={sessions.length}
          />
        )}
      </section>
    );
  }

  if (activeTab === "security" && isSelf) {
    return (
      <div className="space-y-6">
        <PasswordForm
          error={passwordError}
          form={securityForm}
          formRef={securityFormRef}
          isDirty={securityDirty}
          isSubmitting={securitySubmitting}
          onDirtyChange={setSecurityDirty}
          onErrorChange={setPasswordError}
          onFormChange={setSecurityForm}
          onSubmit={handleSecuritySubmit}
          onSuccessChange={setPasswordSuccess}
          success={passwordSuccess}
        />
        <div className="h-2 rounded-full bg-surface-container-low" />
        {sessionsLoading ? (
          <SessionSkeleton />
        ) : (
          <SessionButton
            loading={sessionsLoading}
            onClick={onOpenSessionsModal}
            sessionCount={sessions.length}
          />
        )}
      </div>
    );
  }

  if (activeTab === "activity") {
    return (
      <div
        aria-busy={activityLoading && activity.length === 0}
        aria-live="polite"
      >
        {activityLoading && activity.length === 0 && <ActivitySkeleton />}
        {!activityLoading && activity.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Icon
              className="mb-3 text-on-surface-variant"
              name="timeline"
              size="xl"
            />
            <p className="font-semibold text-on-surface-variant text-sm">
              {t("profile_no_activity")}
            </p>
            <p className="mt-1 max-w-xs text-on-surface-variant text-xs">
              {t("profile_no_activity_desc")}
            </p>
          </div>
        )}
        {activity.length > 0 && (
          <div className="space-y-6">
            <h3 className="font-bold font-headline text-lg text-on-surface">
              {t("profile_recent_activity")}
            </h3>
            <div className="space-y-5">
              {activity.map((item, idx) => (
                <ActivityItemRow
                  item={item}
                  key={item.id}
                  showConnector={idx < activity.length - 1}
                />
              ))}
            </div>
            {hasMoreActivity && (
              <div className="flex justify-center pt-4">
                <Button
                  icon="expand_more"
                  loading={activityLoading}
                  onClick={loadMoreActivity}
                  type="button"
                  variant="ghost"
                >
                  {t("profile_load_more")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
