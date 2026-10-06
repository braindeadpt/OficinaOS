import type { RoleType } from "@shared/constants";
import type { NotificationTemplate } from "@shared/types";
import type { KeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import AddUserModal from "@/components/modules/settings/add-user-modal";
import ResetPasswordModal from "@/components/modules/settings/reset-password-modal";
import type { SettingsAiTabHandle } from "@/components/modules/settings/settings-ai-tab";
import SettingsAiTab from "@/components/modules/settings/settings-ai-tab";
import SettingsCloudTab from "@/components/modules/settings/settings-cloud-tab";
import SettingsNotificationsTab from "@/components/modules/settings/settings-notifications-tab";
import type { SettingsShopTabHandle } from "@/components/modules/settings/settings-shop-tab";
import SettingsShopTab from "@/components/modules/settings/settings-shop-tab";
import SettingsUsersTab from "@/components/modules/settings/settings-users-tab";
import TemplateEditor from "@/components/modules/settings/template-editor";
import UnsavedChangesBar from "@/components/modules/settings/unsaved-changes-bar";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useDirtyState } from "@/hooks/use-dirty-state";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { useSettingsStore } from "@/stores/settings";
import { useUsersStore } from "@/stores/users";

type SettingsTab = "ai" | "cloud" | "shop" | "notifications" | "users";

const TAB_KEYS: SettingsTab[] = [
  "ai",
  "cloud",
  "shop",
  "notifications",
  "users",
];

const TAB_ICONS: Record<SettingsTab, string> = {
  ai: "psychology",
  cloud: "cloud",
  shop: "storefront",
  notifications: "notifications",
  users: "group",
};

export default function SettingsPage() {
  const { t } = useTranslation();
  const baseId = useId();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const requestedTab = searchParams.get("tab") as SettingsTab | null;
    return requestedTab && TAB_KEYS.includes(requestedTab)
      ? requestedTab
      : "shop";
  });
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<NotificationTemplate | null>(null);
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTarget, setResetTarget] = useState<{
    id: string;
    username: string;
  } | null>(null);

  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({
    ai: null,
    cloud: null,
    shop: null,
    notifications: null,
    users: null,
  });
  const aiTabRef = useRef<SettingsAiTabHandle>(null);
  const shopTabRef = useRef<SettingsShopTabHandle>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { notificationTemplates, fetchNotificationTemplates } =
    useSettingsStore();
  const navigate = useNavigate();
  const { markDirty, isDirty } = useDirtyState();

  useModalEffects(pendingTab !== null, () => setPendingTab(null), dialogRef);

  // Deep links (?tab=...) also drive tab switching — browser back/forward,
  // links from other pages. The dirty-form guard still applies.
  useEffect(() => {
    const requestedTab = searchParams.get("tab") as SettingsTab | null;
    if (!(requestedTab && TAB_KEYS.includes(requestedTab))) {
      return;
    }
    setActiveTab((current) => {
      if (current === requestedTab) {
        return current;
      }
      if (isDirty(current)) {
        setPendingTab(requestedTab);
        return current;
      }
      return requestedTab;
    });
  }, [searchParams, isDirty]);

  useEffect(() => {
    if (activeTab === "notifications" && notificationTemplates.length === 0) {
      fetchNotificationTemplates().catch(() => {
        // Error stored in Zustand state
      });
    }
  }, [activeTab, notificationTemplates.length, fetchNotificationTemplates]);

  const tabId = (key: SettingsTab) => `${baseId}-tab-${key}`;
  const headingId = (key: SettingsTab) => `${baseId}-heading-${key}`;
  const panelId = (key: SettingsTab) => `${baseId}-panel-${key}`;

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: "ai", label: t("ai_settings_title") },
    { key: "cloud", label: t("cloud_settings_title") },
    { key: "shop", label: t("shop_information") },
    { key: "notifications", label: t("notifications_settings") },
    { key: "users", label: t("users_management") },
  ];

  const sectionDescriptions: Record<SettingsTab, string> = {
    ai: t("ai_settings_description"),
    cloud: t("cloud_settings_desc"),
    shop: t("shop_information_desc"),
    notifications: t("notifications_settings_desc"),
    users: t("users_management_desc"),
  };

  const isFormTab = activeTab === "ai" || activeTab === "shop";

  function switchTab(key: SettingsTab) {
    if (isDirty(activeTab) && activeTab !== key) {
      setPendingTab(key);
      return;
    }
    setActiveTab(key);
    tabRefs.current[key]?.focus();
  }

  function handleDiscardAndSwitch() {
    if (!pendingTab) {
      return;
    }
    if (activeTab === "ai") {
      aiTabRef.current?.reset();
    } else if (activeTab === "shop") {
      shopTabRef.current?.reset();
    }
    markDirty(activeTab, false);
    setActiveTab(pendingTab);
    tabRefs.current[pendingTab]?.focus();
    setPendingTab(null);
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const idx = TAB_KEYS.indexOf(activeTab);
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (idx + 1) % TAB_KEYS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (idx - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = TAB_KEYS.length - 1;
    }
    if (next !== undefined) {
      e.preventDefault();
      switchTab(TAB_KEYS[next]);
    }
  }

  function handleCancel() {
    if (activeTab === "ai") {
      aiTabRef.current?.reset();
    } else if (activeTab === "shop") {
      shopTabRef.current?.reset();
    }
    markDirty(activeTab, false);
  }

  async function handleCreateUser(data: {
    username: string;
    email: string;
    password: string;
    role: RoleType;
  }) {
    await useUsersStore.getState().createUser(data);
    setShowAddUserModal(false);
  }

  async function handleResetPassword(password: string) {
    if (!resetTarget) {
      return;
    }
    await useUsersStore.getState().resetUserPassword(resetTarget.id, password);
    setShowResetModal(false);
    setResetTarget(null);
  }

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("settings_page")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("settings_page_desc")}
          </p>
        </div>
        <ThemeToggle className="shrink-0" hideHint />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <div
          aria-label={t("settings_page")}
          className="grid grid-cols-5 gap-1 lg:sticky lg:top-24 lg:flex lg:w-52 lg:shrink-0 lg:flex-col lg:self-start"
          role="tablist"
        >
          {tabs.map(({ key, label }) => (
            <button
              aria-controls={panelId(key)}
              aria-selected={activeTab === key}
              className={`flex min-h-16 flex-col items-center gap-0.5 rounded-xl px-1 py-2.5 text-center transition-all lg:min-h-12 lg:flex-row lg:gap-2.5 lg:px-4 lg:py-3 lg:text-start ${
                activeTab === key
                  ? "bg-primary-fixed font-bold text-primary"
                  : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
              }`}
              id={tabId(key)}
              key={key}
              onClick={() => switchTab(key)}
              onKeyDown={handleTabKeyDown}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              role="tab"
              tabIndex={activeTab === key ? 0 : -1}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">
                {TAB_ICONS[key]}
              </span>
              <span className="text-xs leading-tight lg:hidden">{label}</span>
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            aria-labelledby={headingId(activeTab)}
            className="rounded-3xl bg-surface-container-lowest p-5 md:p-7"
            id={panelId(activeTab)}
            role="tabpanel"
          >
            <div className="mb-5">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[22px] text-primary">
                  {TAB_ICONS[activeTab]}
                </span>
                <h3
                  className="font-extrabold font-headline text-lg text-on-surface"
                  id={headingId(activeTab)}
                >
                  {tabs.find((tab) => tab.key === activeTab)?.label}
                </h3>
              </div>
              <p className="mt-1 ps-9 text-on-surface-variant text-sm">
                {sectionDescriptions[activeTab]}
              </p>
            </div>
            {activeTab === "ai" && (
              <SettingsAiTab
                onDirtyChange={(d) => markDirty("ai", d)}
                onSavingChange={setSaving}
                onToast={(msg, type) =>
                  type === "error" ? toast.error(msg) : toast.success(msg)
                }
                ref={aiTabRef}
              />
            )}
            {activeTab === "cloud" && (
              <SettingsCloudTab
                onToast={(msg, type) =>
                  type === "error" ? toast.error(msg) : toast.success(msg)
                }
              />
            )}
            {activeTab === "shop" && (
              <SettingsShopTab
                onDirtyChange={(d) => markDirty("shop", d)}
                onSavingChange={setSaving}
                onToast={(msg, type) =>
                  type === "error" ? toast.error(msg) : toast.success(msg)
                }
                ref={shopTabRef}
              />
            )}
            {activeTab === "notifications" && (
              <SettingsNotificationsTab
                onEditTemplate={(tpl) => setEditingTemplate(tpl)}
              />
            )}
            {activeTab === "users" && (
              <SettingsUsersTab
                onAddUser={() => setShowAddUserModal(true)}
                onEditUser={(id) => navigate(`/profile/${id}`)}
                onResetPassword={(id, username) => {
                  setResetTarget({ id, username });
                  setShowResetModal(true);
                }}
              />
            )}
          </div>

          <UnsavedChangesBar
            onCancel={handleCancel}
            onSave={() => {
              if (activeTab === "ai") {
                aiTabRef.current?.requestSubmit();
              } else if (activeTab === "shop") {
                shopTabRef.current?.requestSubmit();
              }
            }}
            saving={saving}
            visible={isDirty(activeTab) && isFormTab}
          />
        </div>
      </div>

      {pendingTab && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay">
          <div ref={dialogRef}>
            <ConfirmDiscardDialog
              description={t("confirm_tab_switch_desc")}
              discardLabel={t("discard_changes")}
              keepLabel={t("keep_editing")}
              onDiscard={handleDiscardAndSwitch}
              onKeepEditing={() => setPendingTab(null)}
              open
              title={t("confirm_tab_switch_title")}
            />
          </div>
        </div>
      )}

      {showAddUserModal && (
        <AddUserModal
          onClose={() => setShowAddUserModal(false)}
          onSubmit={handleCreateUser}
        />
      )}
      {showResetModal && resetTarget && (
        <ResetPasswordModal
          onClose={() => {
            setShowResetModal(false);
            setResetTarget(null);
          }}
          onSubmit={handleResetPassword}
          username={resetTarget.username}
        />
      )}
      <TemplateEditor
        onClose={() => setEditingTemplate(null)}
        onSaved={() => fetchNotificationTemplates()}
        open={editingTemplate !== null}
        template={editingTemplate}
      />
    </>
  );
}
