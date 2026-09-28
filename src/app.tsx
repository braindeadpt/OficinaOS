import type { RoleType } from "@shared/constants";
import { Role } from "@shared/constants";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, Route, Routes } from "react-router";
import DashboardLayout from "@/components/modules/dashboard-layout";
import ProtectedRoute, {
  RequirePermission,
} from "@/components/modules/protected-route";
import { ChunkErrorBoundary } from "@/components/ui/chunk-error-boundary";
import { useAuthStore } from "@/stores/auth";

const AiAnalystPage = lazy(() => import("@/pages/ai-analyst"));
const AiAnalystLayout = lazy(() => import("@/pages/ai-analyst/layout"));
const AiMemoriesPage = lazy(() => import("@/pages/ai-analyst/memories/page"));
const ChangePasswordPage = lazy(() => import("@/pages/auth/change-password"));
const LoginPage = lazy(() => import("@/pages/auth/login"));
const ResetPasswordPage = lazy(() => import("@/pages/auth/reset-password"));
const CustomersPage = lazy(() => import("@/pages/customers"));
const CustomerDetailPage = lazy(() => import("@/pages/customers/detail"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const FrontDeskPage = lazy(() => import("@/pages/dashboard/front-desk"));
const TechnicianDashboardPage = lazy(
  () => import("@/pages/dashboard/technician")
);
const ReturnsListPage = lazy(() => import("@/pages/returns"));
const ReturnDetailPage = lazy(() => import("@/pages/returns/detail"));
const JobsPage = lazy(() => import("@/pages/jobs"));
const JobDetailPage = lazy(() => import("@/pages/jobs/detail"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const PartsCatalogPage = lazy(() => import("@/pages/parts"));
const PosPage = lazy(() => import("@/pages/pos"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const RepairsPage = lazy(() => import("@/pages/repairs"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const TrackingPage = lazy(() => import("@/pages/tracking"));

const DASHBOARD_LAZY_MAP: Record<
  RoleType,
  React.LazyExoticComponent<() => React.JSX.Element>
> = {
  [Role.OWNER]: DashboardPage,
  [Role.TECHNICIAN]: TechnicianDashboardPage,
  [Role.FRONT_DESK]: FrontDeskPage,
};

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-24">
        <span className="material-symbols-outlined text-6xl text-on-surface-variant/40">
          error_outline
        </span>
        <h1 className="mt-4 font-extrabold font-headline text-3xl text-on-surface">
          {t("not_found.title")}
        </h1>
        <p className="mt-2 text-on-surface-variant">
          {t("not_found.description")}
        </p>
        <Link
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-6 font-bold text-on-primary text-sm"
          to="/"
        >
          {t("not_found.go_home")}
        </Link>
      </div>
    </DashboardLayout>
  );
}

function PageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading page"
      className="m-4 h-96 animate-pulse rounded-lg bg-muted"
      role="status"
    />
  );
}

export default function App() {
  const role = useAuthStore((s) => s.role);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const DashboardComponent = DASHBOARD_LAZY_MAP[role] ?? DashboardPage;

  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route element={<LoginPage />} path="/login" />
          <Route element={<ResetPasswordPage />} path="/reset-password" />
          <Route element={<ProtectedRoute requireMustChangePassword={false} />}>
            <Route element={<ChangePasswordPage />} path="/change-password" />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route
              element={
                <DashboardLayout>
                  <DashboardComponent />
                </DashboardLayout>
              }
              path="/"
            />
            <Route
              element={
                <DashboardLayout>
                  <JobsPage />
                </DashboardLayout>
              }
              path="/jobs"
            />
            <Route
              element={
                <DashboardLayout>
                  <JobDetailPage />
                </DashboardLayout>
              }
              path="/jobs/:id"
            />
            <Route
              element={<RequirePermission perm={{ returns: ["viewSelf"] }} />}
            >
              <Route
                element={
                  <DashboardLayout>
                    <ReturnsListPage />
                  </DashboardLayout>
                }
                path="/returns"
              />
              <Route
                element={
                  <DashboardLayout>
                    <ReturnDetailPage />
                  </DashboardLayout>
                }
                path="/returns/:id"
              />
            </Route>
            <Route
              element={<RequirePermission perm={{ notifications: ["read"] }} />}
            >
              <Route
                element={
                  <DashboardLayout>
                    <NotificationsPage />
                  </DashboardLayout>
                }
                path="/notifications"
              />
            </Route>
            <Route element={<RequirePermission perm={{ sales: ["view"] }} />}>
              <Route
                element={
                  <DashboardLayout>
                    <PosPage />
                  </DashboardLayout>
                }
                path="/pos"
              />
            </Route>
            <Route
              element={<RequirePermission perm={{ parts: ["viewCatalog"] }} />}
            >
              <Route
                element={
                  <DashboardLayout>
                    <PartsCatalogPage />
                  </DashboardLayout>
                }
                path="/parts"
              />
            </Route>
            <Route
              element={
                <RequirePermission perm={{ repairs: ["viewCatalog"] }} />
              }
            >
              <Route
                element={
                  <DashboardLayout>
                    <RepairsPage />
                  </DashboardLayout>
                }
                path="/repairs"
              />
            </Route>
            <Route
              element={
                <DashboardLayout>
                  <SettingsPage />
                </DashboardLayout>
              }
              path="/settings"
            />
            <Route element={<RequirePermission perm={{ ai: ["access"] }} />}>
              <Route
                element={
                  <DashboardLayout>
                    <AiAnalystLayout>
                      <AiAnalystPage />
                    </AiAnalystLayout>
                  </DashboardLayout>
                }
                path="/ai-analyst"
              />
              <Route
                element={
                  <DashboardLayout>
                    <AiAnalystLayout>
                      <AiMemoriesPage />
                    </AiAnalystLayout>
                  </DashboardLayout>
                }
                path="/ai-analyst/memories"
              />
            </Route>
            <Route
              element={
                <DashboardLayout>
                  <ProfilePage />
                </DashboardLayout>
              }
              path="/profile"
            />
            <Route
              element={
                <DashboardLayout>
                  <ProfilePage />
                </DashboardLayout>
              }
              path="/profile/:userId"
            />
            <Route
              element={<RequirePermission perm={{ customers: ["view"] }} />}
            >
              <Route
                element={
                  <DashboardLayout>
                    <CustomersPage />
                  </DashboardLayout>
                }
                path="/customers"
              />
              <Route
                element={
                  <DashboardLayout>
                    <CustomerDetailPage />
                  </DashboardLayout>
                }
                path="/customers/:id"
              />
            </Route>
            <Route
              element={<RequirePermission perm={{ reports: ["viewSelf"] }} />}
            >
              <Route
                element={
                  <DashboardLayout>
                    <ReportsPage />
                  </DashboardLayout>
                }
                path="/reports"
              />
            </Route>
          </Route>
          <Route element={<TrackingPage />} path="/tracking/:jobCode?" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
      </Suspense>
    </ChunkErrorBoundary>
  );
}
