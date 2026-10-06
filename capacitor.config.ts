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
      // Auto-hide: the splash-screen plugin is not a dependency today,
      // and with `false` + no SplashScreen.hide() call the splash would
      // cover the app forever if the plugin is ever added.
      launchAutoHide: true,
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
