import { describe, expect, it } from "vitest";
import * as stainModule from "../src/stain/Stain";
import type { BodyCommand } from "../src/experience/types";
import {
  BodyDispatchOwnership,
  SettledBodyRendererAdapter,
  type BodyRendererAdapter,
} from "../src/stain/bodyRenderer";

interface RendererInstallLifecycle {
  disposed: boolean;
  lostContext: boolean;
}

interface RepairStainApi {
  runSeraphTargetInstall?<T>(
    pending: Promise<T>,
    lifecycle: RendererInstallLifecycle,
    onReady: (value: T) => void,
    onFallback: () => void,
  ): Promise<void>;
  runOwnedBodyDispatch?(
    ownership: BodyDispatchOwnership,
    adapter: BodyRendererAdapter,
    command: BodyCommand,
    presentationStartedAt: number,
    onClaimed: (generation: number) => void,
    onAcknowledged: (id: string, generation: number) => void,
  ): number | null;
}

const repairApi = stainModule as unknown as RepairStainApi;

describe("asynchronous Seraph renderer installation", () => {
  it("ignores a target-build rejection after the owning Stain has unmounted", async () => {
    expect(typeof repairApi.runSeraphTargetInstall).toBe("function");
    if (repairApi.runSeraphTargetInstall === undefined) return;

    const lifecycle: RendererInstallLifecycle = { disposed: false, lostContext: false };
    let rejectBuild: (reason: Error) => void = () => undefined;
    const pending = new Promise<string>((_resolve, reject) => { rejectBuild = reject; });
    let readyCount = 0;
    let fallbackCount = 0;
    const install = repairApi.runSeraphTargetInstall(
      pending,
      lifecycle,
      () => { readyCount += 1; },
      () => { fallbackCount += 1; },
    );

    lifecycle.disposed = true;
    rejectBuild(new Error("late target decode failure"));
    await install;

    expect(readyCount).toBe(0);
    expect(fallbackCount).toBe(0);
  });

  it("routes one current target-build rejection to fallback and ignores a lost-context duplicate", async () => {
    expect(typeof repairApi.runSeraphTargetInstall).toBe("function");
    if (repairApi.runSeraphTargetInstall === undefined) return;

    let fallbackCount = 0;
    await repairApi.runSeraphTargetInstall(
      Promise.reject(new Error("current target decode failure")),
      { disposed: false, lostContext: false },
      () => undefined,
      () => { fallbackCount += 1; },
    );
    await repairApi.runSeraphTargetInstall(
      Promise.reject(new Error("context already fell back")),
      { disposed: false, lostContext: true },
      () => undefined,
      () => { fallbackCount += 1; },
    );

    expect(fallbackCount).toBe(1);
  });

  it("does not cancel the real quicken dwell when the duplicate active-command effect arrives", async () => {
    expect(typeof repairApi.runOwnedBodyDispatch).toBe("function");
    if (repairApi.runOwnedBodyDispatch === undefined) return;

    const ownership = new BodyDispatchOwnership();
    const adapter = new SettledBodyRendererAdapter(() => undefined, false);
    const command: BodyCommand = {
      id: "quicken:async-install-owner",
      kind: "quicken",
      organ: "EYE",
      intensity: 0.5,
      pipeline: "none",
    };
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let claimedCount = 0;
    let completionCount = 0;
    const dispatch = () => repairApi.runOwnedBodyDispatch?.(
      ownership,
      adapter,
      command,
      performance.now(),
      () => {
        claimedCount += 1;
        if (dwellTimer !== null) clearTimeout(dwellTimer);
        dwellTimer = null;
      },
      () => {
        dwellTimer = setTimeout(() => {
          dwellTimer = null;
          completionCount += 1;
        }, 1_200);
      },
    );

    try {
      expect(dispatch()).not.toBeNull(); // asynchronous renderer installation
      expect(dispatch()).toBeNull(); // React active-command effect for the same owner
      expect(claimedCount).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 1_250));
      expect(completionCount).toBe(1);
    } finally {
      if (dwellTimer !== null) clearTimeout(dwellTimer);
      adapter.dispose();
    }
  });
});
