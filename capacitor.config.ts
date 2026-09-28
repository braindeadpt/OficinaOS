import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.oficinaos.app",
  appName: "OficinaOS",
  webDir: "dist",
  server: {
    androidScheme: "https",
    ...(process.env.NODE_ENV === "development" && {
      url: "http://localhost:5173",
      cleartext: true,
    }),
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
    },
    Camera: {
      presentationStyle: "fullscreen",
    },
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
