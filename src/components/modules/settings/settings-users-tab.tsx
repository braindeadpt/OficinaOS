import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { getAvatarSrc } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useUsersStore } from "@/stores/users";

const ROLE_CONFIG: Record<string, { color: string; icon: string }> = {
  OWNER: { color: "bg-primary/10 text-primary", icon: "admin_panel_settings" },
  TECHNICIAN: {
    color: "bg-on-secondary-container/10 text-on-secondary-container",
    icon: "build",
  },
  FRONT_DESK: { color: "bg-tertiary/10 text-tertiary", icon: "desk" },
};

interface UserRowData {
  email: string;
  id: string;
  image: string | null;
  isActive: boolean;
  role: string;
  username: string;
}

function UserRow({
  user,
  isSelf,
  onEdit,
  onResetPassword,
  onToggleStatus,
  t,
}: {
  isSelf: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggleStatus: () => void;
  t: (key: string, options?: Record<string, string>) => string;
  user: UserRowData;
}) {
  const roleCfg = ROLE_CONFIG[user.role] ?? {
    color: "bg-surface-container text-on-surface-variant",
    icon: "person",
  };
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-surface-container-low p-4 transition-colors hover:bg-surface-container-high/60">
      <Avatar
        alt={user.username}
        initials={user.username.charAt(0).toUpperCase()}
        size="md"
        src={getAvatarSrc(user.image)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-on-surface text-sm">
            {user.username}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold text-xs uppercase ${roleCfg.color}`}
          >
            <span className="material-symbols-outlined text-[12px]">
              {roleCfg.icon}
            </span>
            {t(`role.${user.role}`)}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs ${user.isActive ? "bg-success/10 text-success" : "bg-on-surface-variant/10 text-on-surface-variant"}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${user.isActive ? "bg-success" : "bg-on-surface-variant/40"}`}
            />
            {user.isActive ? t("status_active") : t("status_inactive")}
          </span>
        </div>
        <p className="mt-0.5 truncate text-on-surface-variant text-xs">
          {user.email}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!isSelf && (
          <button
            aria-checked={user.isActive}
            aria-label={
              user.isActive
                ? t("disable_user", { name: user.username })
                : t("enable_user", { name: user.username })
            }
            className="relative h-6 w-11 rounded-full transition-colors"
            onClick={onToggleStatus}
            role="switch"
            style={{
              backgroundColor: user.isActive
                ? "var(--color-primary)"
                : "var(--color-outline-variant)",
            }}
            type="button"
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-on-primary shadow-sm transition-all"
              style={{ insetInlineStart: user.isActive ? "22px" : "2px" }}
            />
          </button>
        )}
        <button
          aria-label={t("reset_password_title")}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg p-2 text-on-surface-variant text-xs transition-colors hover:bg-surface-container hover:text-primary"
          onClick={onResetPassword}
          title={t("reset_password_title")}
          type="button"
        >
          <span className="material-symbols-outlined text-[16px]">key</span>
        </button>
        <button
          aria-label={`${t("edit")} ${user.username}`}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg p-2 text-on-surface-variant text-xs transition-colors hover:bg-surface-container hover:text-primary"
          onClick={onEdit}
          type="button"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
          <span className="hidden sm:inline">{t("edit")}</span>
        </button>
      </div>
    </div>
  );
}

interface SettingsUsersTabProps {
  onAddUser: () => void;
  onEditUser: (userId: string) => void;
  onResetPassword: (userId: string, username: string) => void;
}

export default function SettingsUsersTab({
  onAddUser,
  onEditUser,
  onResetPassword,
}: SettingsUsersTabProps) {
  const { t } = useTranslation();
  const { users, isLoading: usersLoading, fetchUsers } = useUsersStore();
  const currentUser = useAuthStore((s) => s.user);
  const [deactivateTarget, setDeactivateTarget] = useState<{
    id: string;
    username: string;
  } | null>(null);

  // Fetch users on mount if needed
  useEffect(() => {
    if (users.length === 0 && !usersLoading) {
      fetchUsers().catch((err) => {
        console.error("Failed to fetch users:", err);
      });
    }
  }, [users.length, usersLoading, fetchUsers]);

  const applyToggle = (id: string, isActive: boolean) => {
    useUsersStore
      .getState()
      .toggleUserStatus(id, isActive)
      .then(() => {
        const err = useUsersStore.getState().error;
        if (err) {
          toast.error(err);
          useUsersStore.getState().clearError();
        }
      });
  };

  const handleToggle = (user: UserRowData) => {
    // Deactivation locks someone out — confirm first. Activation is safe.
    if (user.isActive) {
      setDeactivateTarget({ id: user.id, username: user.username });
    } else {
      applyToggle(user.id, true);
    }
  };

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="material-symbols-outlined animate-spin text-3xl text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-on-primary text-sm transition-all active:opacity-80"
          onClick={onAddUser}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">
            person_add
          </span>
          {t("add_user")}
        </button>
      </div>
      {users.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-low py-12 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">
            group_off
          </span>
          <p className="mt-3 text-on-surface-variant text-sm">
            {t("no_users_found")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <UserRow
              isSelf={currentUser?.id === user.id}
              key={user.id}
              onEdit={() => onEditUser(user.id)}
              onResetPassword={() => onResetPassword(user.id, user.username)}
              onToggleStatus={() => handleToggle(user)}
              t={t}
              user={user}
            />
          ))}
        </div>
      )}
      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
          <ConfirmDiscardDialog
            description={t("confirm_deactivate_user_desc", {
              name: deactivateTarget.username,
            })}
            discardLabel={t("deactivate_user_btn")}
            keepLabel={t("cancel")}
            onDiscard={() => {
              applyToggle(deactivateTarget.id, false);
              setDeactivateTarget(null);
            }}
            onKeepEditing={() => setDeactivateTarget(null)}
            open
            title={t("confirm_deactivate_user")}
          />
        </div>
      )}
    </div>
  );
}
