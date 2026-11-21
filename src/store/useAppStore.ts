import { create } from "zustand";
import {
  commands,
  type PingResponse,
  type RosHealthStatus,
  type Settings,
  type ThemeMode,
} from "../bindings";

export interface ResolvedSettings {
  rosSetupPath: string;
  defaultWorkspace: string | null;
  defaultMaintainerName: string;
  defaultMaintainerEmail: string;
  rosDomainId: number;
  externalEditorCommand: string;
  buildBeforeRun: boolean;
  theme: ThemeMode;
  recentWorkspaces: string[];
}

export const DEFAULT_SETTINGS: ResolvedSettings = {
  rosSetupPath: "/opt/ros/jazzy/setup.bash",
  defaultWorkspace: null,
  defaultMaintainerName: "",
  defaultMaintainerEmail: "",
  rosDomainId: 0,
  externalEditorCommand: "code -g {file}:{line}",
  buildBeforeRun: true,
  theme: "dark",
  recentWorkspaces: [],
};

export function resolveSettings(raw?: Settings | null): ResolvedSettings {
  return {
    rosSetupPath: raw?.rosSetupPath ?? DEFAULT_SETTINGS.rosSetupPath,
    defaultWorkspace: raw?.defaultWorkspace ?? DEFAULT_SETTINGS.defaultWorkspace,
    defaultMaintainerName:
      raw?.defaultMaintainerName ?? DEFAULT_SETTINGS.defaultMaintainerName,
    defaultMaintainerEmail:
      raw?.defaultMaintainerEmail ?? DEFAULT_SETTINGS.defaultMaintainerEmail,
    rosDomainId: raw?.rosDomainId ?? DEFAULT_SETTINGS.rosDomainId,
    externalEditorCommand:
      raw?.externalEditorCommand ?? DEFAULT_SETTINGS.externalEditorCommand,
    buildBeforeRun: raw?.buildBeforeRun ?? DEFAULT_SETTINGS.buildBeforeRun,
    theme: raw?.theme ?? DEFAULT_SETTINGS.theme,
    recentWorkspaces: raw?.recentWorkspaces ?? DEFAULT_SETTINGS.recentWorkspaces,
  };
}

function formatError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface AppStoreState {
  settings: ResolvedSettings;
  settingsLoaded: boolean;
  rosHealth: RosHealthStatus | null;
  pingResult: PingResponse | null;
  settingsOpen: boolean;
  bootstrapping: boolean;
  pinging: boolean;
  checkingHealth: boolean;
  savingSettings: boolean;
  statusMessage: string;
  errorMessage: string | null;

  bootstrap: () => Promise<void>;
  runPing: (message?: string) => Promise<void>;
  refreshRosHealth: () => Promise<void>;
  saveSettings: (next: ResolvedSettings) => Promise<boolean>;
  toggleTheme: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  clearError: () => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  rosHealth: null,
  pingResult: null,
  settingsOpen: false,
  bootstrapping: false,
  pinging: false,
  checkingHealth: false,
  savingSettings: false,
  statusMessage: "Initializing RosForge…",
  errorMessage: null,

  bootstrap: async () => {
    set({
      bootstrapping: true,
      errorMessage: null,
      statusMessage: "Loading settings & checking ROS 2 environment…",
    });

    try {
      const [rawSettings, pingResult] = await Promise.all([
        commands.getSettings(),
        commands.ping("startup"),
      ]);

      const settings = resolveSettings(rawSettings);
      applyThemeToDocument(settings.theme);

      set({
        settings,
        settingsLoaded: true,
        pingResult,
        statusMessage: "Checking ROS 2 installation…",
      });

      const rosHealth = await commands.checkRosHealth();
      set({
        rosHealth,
        bootstrapping: false,
        statusMessage: rosHealth.available
          ? rosHealth.message
          : "Ready (ROS 2 not detected)",
      });
    } catch (err) {
      set({
        bootstrapping: false,
        errorMessage: formatError(err),
        statusMessage: "Backend unavailable — run via `pnpm tauri dev`",
      });
    }
  },

  runPing: async (message?: string) => {
    set({ pinging: true, errorMessage: null, statusMessage: "Pinging Rust backend…" });
    try {
      const pingResult = await commands.ping(message?.trim() ? message : null);
      set({
        pingResult,
        pinging: false,
        statusMessage: `Backend responded: ${pingResult.reply}`,
      });
    } catch (err) {
      set({
        pinging: false,
        errorMessage: formatError(err),
        statusMessage: "Ping failed",
      });
    }
  },

  refreshRosHealth: async () => {
    set({
      checkingHealth: true,
      errorMessage: null,
      statusMessage: "Checking ROS 2 environment…",
    });
    try {
      const rosHealth = await commands.checkRosHealth();
      set({
        rosHealth,
        checkingHealth: false,
        statusMessage: rosHealth.available
          ? rosHealth.message
          : "ROS 2 not detected",
      });
    } catch (err) {
      set({
        checkingHealth: false,
        errorMessage: formatError(err),
        statusMessage: "ROS 2 health check failed",
      });
    }
  },

  saveSettings: async (next: ResolvedSettings) => {
    const prev = get().settings;
    set({ savingSettings: true, errorMessage: null, statusMessage: "Saving settings…" });
    try {
      const savedRaw = await commands.saveSettings(next);
      const saved = resolveSettings(savedRaw);
      applyThemeToDocument(saved.theme);

      set({
        settings: saved,
        settingsLoaded: true,
        savingSettings: false,
        statusMessage: "Settings saved",
      });

      const rosConfigChanged =
        prev.rosSetupPath !== saved.rosSetupPath ||
        prev.rosDomainId !== saved.rosDomainId;
      if (rosConfigChanged) {
        await get().refreshRosHealth();
      }
      return true;
    } catch (err) {
      set({
        savingSettings: false,
        errorMessage: formatError(err),
        statusMessage: "Failed to save settings",
      });
      return false;
    }
  },

  toggleTheme: async () => {
    const current = get().settings;
    const nextTheme: ThemeMode = current.theme === "dark" ? "light" : "dark";
    applyThemeToDocument(nextTheme);
    const nextSettings: ResolvedSettings = { ...current, theme: nextTheme };
    set({ settings: nextSettings });

    if (get().settingsLoaded) {
      await get().saveSettings(nextSettings);
    }
  },

  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
  clearError: () => set({ errorMessage: null }),
}));
