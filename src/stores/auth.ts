import type { RoleType } from "@shared/constants";
import { create } from "zustand";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";

interface AuthUser {
  email: string;
  id: string;
  image: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  name: string;
  role: RoleType;
  username: string;
}

interface AuthState {
  checkSession: (forceRefresh?: boolean) => Promise<void>;
  clearError: () => void;
  error: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    username: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<void>;
  logout: () => Promise<void>;
  role: RoleType;
  setRole: (role: RoleType) => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  user: AuthUser | null;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
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
      if (identifier.includes("@")) {
        await api.post("/auth/sign-in/email", {
          email: identifier,
          password,
          rememberMe,
        });
      } else {
        await api.post("/auth/sign-in/username", {
          username: identifier,
          password,
          rememberMe,
        });
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
