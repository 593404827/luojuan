import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.luojuan.app",
  appName: "落卷",
  webDir: "capacitor-shell",
  bundledWebRuntime: false,
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
        allowNavigation: ["*"],
      }
    : undefined,
  android: {
    allowMixedContent: true,
  },
};

export default config;
