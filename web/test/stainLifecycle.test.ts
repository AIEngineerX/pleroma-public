import { describe, expect, it } from "vitest";
import * as stainModule from "../src/stain/Stain";

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
});
