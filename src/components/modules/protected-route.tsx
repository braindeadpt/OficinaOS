import type { RoleType } from "@shared/constants";
import type { PermissionCheck } from "@shared/permissions";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet } from "react-router";
import { useCan } from "@/hooks/use-can";
import { useAuthStore } from "@/stores/auth";

interface ProtectedRouteProps {
  requireMustChangePassword?: boolean;
}

export default function ProtectedRoute({
  requireMustChangePassword = true,
}: ProtectedRouteProps) {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const mustChangePassword = useAuthStore((s) => s.user?.mustChangePassword);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined animate-spin text-4xl text-primary">
            progress_activity
          </span>
          <span className="font-medium text-on-surface-variant">
            {t("loading")}
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate replace to="/login" />;
  }

  if (requireMustChangePassword && mustChangePassword) {
    return <Navigate replace to="/change-password" />;
  }

  return <Outlet />;
}

interface RequireRoleProps {
  roles: RoleType[];
}

export function RequireRole({ roles }: RequireRoleProps) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);

  if (isLoading) {
    return null;
  }

  if (!roles.includes(role)) {
    return <Navigate replace to="/" />;
  }

  return <Outlet />;
}

interface RequirePermissionProps {
  perm: PermissionCheck;
}

/** Must be nested inside ProtectedRoute to ensure auth has initialized. */
export function RequirePermission({ perm }: RequirePermissionProps) {
  const allowed = useCan(perm);
  if (!allowed) {
    return <Navigate replace to="/" />;
  }
  return <Outlet />;
}
