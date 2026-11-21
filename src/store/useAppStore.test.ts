import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, useAppStore } from "./useAppStore";

const mocks = vi.hoisted(() => ({
  ping: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  checkRosHealth: vi.fn(),
}));

vi.mock("../bindings", () => ({
  commands: mocks,
}));

describe("useAppStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      settings: DEFAULT_SETTINGS,
      settingsLoaded: false,
      rosHealth: null,
      pingResult: null,
      settingsOpen: false,
      bootstrapping: false,
      pinging: false,
      checkingHealth: false,
      savingSettings: false,
      statusMessage: "",
      errorMessage: null,
    });
  });

  it("bootstraps settings, pings backend, and checks ROS health", async () => {
    mocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      rosDomainId: 12,
      theme: "dark",
    });
    mocks.ping.mockResolvedValue({
      ok: true,
      reply: "pong: startup",
      appVersion: "0.1.0",
      platform: "linux",
    });
    mocks.checkRosHealth.mockResolvedValue({
      available: true,
      rosSetupPath: "/opt/ros/jazzy/setup.bash",
      rosDomainId: 12,
      rosDistro: "jazzy",
      message: "ROS 2 (jazzy) is ready.",
      detail: null,
    });

    await useAppStore.getState().bootstrap();

    const state = useAppStore.getState();
    expect(state.settingsLoaded).toBe(true);
    expect(state.settings.rosDomainId).toBe(12);
    expect(state.pingResult?.reply).toBe("pong: startup");
    expect(state.rosHealth?.available).toBe(true);
    expect(state.errorMessage).toBeNull();
  });

  it("re-checks ROS health when rosSetupPath changes on saveSettings", async () => {
    const updated = {
      ...DEFAULT_SETTINGS,
      rosSetupPath: "/opt/ros/kilted/setup.bash",
    };
    mocks.saveSettings.mockResolvedValue(updated);
    mocks.checkRosHealth.mockResolvedValue({
      available: false,
      rosSetupPath: updated.rosSetupPath,
      rosDomainId: 0,
      rosDistro: null,
      message: "ROS 2 setup file not found",
      detail: null,
    });

    const ok = await useAppStore.getState().saveSettings(updated);

    expect(ok).toBe(true);
    expect(mocks.saveSettings).toHaveBeenCalledWith(updated);
    expect(mocks.checkRosHealth).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().rosHealth?.available).toBe(false);
  });

  it("surfaces backend errors cleanly when ping fails", async () => {
    mocks.ping.mockRejectedValue(new Error("IPC unavailable"));

    await useAppStore.getState().runPing("hello");

    const state = useAppStore.getState();
    expect(state.pinging).toBe(false);
    expect(state.errorMessage).toBe("IPC unavailable");
  });
});
