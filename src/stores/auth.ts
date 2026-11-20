import type { RoleType } from "@shared/constants";
import { create } from "zustand";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";

const TOTP_CODE_REGEX = /^\d{6}$/;

interface AuthUser {
  email: string;
  id: string;
  image: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  name: string;
  role: RoleType;
  twoFactorEnabled: boolean;
  username: string;
}

interface AuthState {
  checkSession: (forceRefresh?: boolean) => Promise<void>;
  clearError: () => void;
  clearPendingTwoFactor: () => void;
  error: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    username: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<void>;
  logout: () => Promise<void>;
  pendingTwoFactor: boolean;
  role: RoleType;
  setRole: (role: RoleType) => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  user: AuthUser | null;
  verifyTwoFactor: (code: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  pendingTwoFactor: false,
  role: "FRONT_DESK" as RoleType,
  error: null,

  checkSession: async (forceRefresh = false) => {
    set({ isLoading: true });
    try {
      const url = forceRefresh
        ? `/auth/get-session?_=${Date.now()}`
        : "/auth/get-session";
      const res = await api.get(url);
      const user = res.data.user;
      if (!user) {
        throw new Error(i18n.t("errors.no_user_session"));
      }
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        role: user.role as RoleType,
        error: null,
      });
    } catch {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        role: "FRONT_DESK" as RoleType,
        error: null,
      });
    }
  },

  login: async (username, password, rememberMe) => {
    set({ isLoading: true, error: null });
    try {
      // The first-run setup lets the owner pick an email as their login,
      // so an identifier with "@" signs in through the email endpoint.
      const identifier = username.trim();
      const signIn = identifier.includes("@")
        ? await api.post("/auth/sign-in/email", {
            email: identifier,
            password,
            rememberMe,
          })
        : await api.post("/auth/sign-in/username", {
            username: identifier,
            password,
            rememberMe,
          });
      // 2FA pending: the server deleted the credential session and set a
      // signed challenge cookie — the code step completes the sign-in.
      if (signIn.data?.twoFactorRedirect === true) {
        set({ isLoading: false, pendingTwoFactor: true, error: null });
        return;
      }
      const res = await api.get("/auth/get-session");
      const user = res.data.user;
      if (!user) {
        throw new Error(i18n.t("errors.no_user_session"));
      }
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        role: user.role as RoleType,
        error: null,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.login_failed"));
      set({ isLoading: false, error: message });
      throw new Error(message);
    }
  },

  verifyTwoFactor: async (code) => {
    set({ isLoading: true, error: null });
    try {
      // TOTP codes are 6 digits; backup codes are "XXXXX-XXXXX". Sending a
      // wrong TOTP to the backup endpoint too would burn two attempts of
      // the same challenge, so each format only hits its own endpoint.
      const endpoint = TOTP_CODE_REGEX.test(code)
        ? "/auth/two-factor/verify-totp"
        : "/auth/two-factor/verify-backup-code";
      await api.post(endpoint, { code, trustDevice: false });
      const res = await api.get("/auth/get-session");
      const user = res.data.user;
      if (!user) {
        throw new Error(i18n.t("errors.no_user_session"));
      }
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        pendingTwoFactor: false,
        role: user.role as RoleType,
        error: null,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.login_failed"));
      set({ isLoading: false, error: message });
      throw new Error(message);
    }
  },

  clearPendingTwoFactor: () => set({ pendingTwoFactor: false }),

  logout: async () => {
    try {
      await api.post("/auth/sign-out");
    } catch {
      // Intentionally ignored: clear local state regardless of API result
    }
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      role: "FRONT_DESK" as RoleType,
      error: null,
    });
    window.location.href = "/login";
  },

  clearError: () => set({ error: null }),

  setRole: (role) => set({ role }),
  updateUser: (updates) =>
    set((state) => {
      if (!state.user) {
        return state;
      }
      const newUser = { ...state.user, ...updates };
      return {
        user: newUser,
        ...(updates.role !== undefined && { role: updates.role }),
      };
    }),
}));
