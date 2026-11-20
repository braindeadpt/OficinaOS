import { ac, roles } from "@shared/permissions";
import {
  adminClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? ""
      : API_BASE_URL || `${window.location.protocol}//${window.location.host}`,
  basePath: "/api/auth",
  plugins: [usernameClient(), adminClient({ ac, roles }), twoFactorClient()],
});
