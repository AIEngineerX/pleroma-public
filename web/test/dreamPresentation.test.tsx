import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dream, * as dreamModule from "../src/dream/Dream";
import type { BodyCommand } from "../src/experience/types";
import * as dreamsClientModule from "../src/canon/dreamsClient";
import type { DreamArchiveEntry, DreamView } from "../src/state/types";

type SeraphPhase = "gather" | "hold" | "dissolve" | "five";
type DreamPlatePresentation = "ordinary" | "concealed" | "revealed";

interface RepairDreamApi {
  dreamPlatePresentation?(
    dream: DreamView | null,
    command: BodyCommand | null,
    phase: SeraphPhase,
    identityConfirmed: boolean,
  ): DreamPlatePresentation;
  dreamPlatePhaseForCommand?(
    command: BodyCommand | null,
    tracked: { commandId: string | null; phase: SeraphPhase },
  ): SeraphPhase;
  dreamPlatePhaseForPresentation?(
    activeCommand: BodyCommand | null,
    presentationCommand: BodyCommand | null,
    tracked: { commandId: string | null; phase: SeraphPhase },
  ): SeraphPhase;
}

interface DreamPage {
  entries: DreamArchiveEntry[];
  next: string | null;
}

interface RepairDreamsClientApi {
  archiveConfirmsDreamPlate?(
    dream: DreamView | null,
    command: BodyCommand | null,
    entries: readonly DreamArchiveEntry[],
  ): boolean;
  dreamPlateIdentityKey?(dream: DreamView | null, command: BodyCommand | null): string | null;
  resolveDreamPlateIdentity?(
    dream: DreamView | null,
    command: BodyCommand | null,
    page: Promise<DreamPage>,
  ): Promise<boolean>;
  DreamPlateIdentityCache?: new (
    load?: (apiBase: string, cursor: null) => Promise<DreamPage>,
  ) => {
    confirm(apiBase: string, dream: DreamView | null, command: BodyCommand | null): Promise<boolean>;
  };
}

const repairApi = dreamModule as unknown as RepairDreamApi;
const identityApi = dreamsClientModule as unknown as RepairDreamsClientApi;
const RepairDream = Dream as ComponentType<{
  dream: DreamView | null;
  apiBase?: string;
  presentation?: DreamPlatePresentation;
}>;

const plate: DreamView = {
  narrative: "The available Plate and the live verse are one record.",
  video_key: null,
  wakers: [],
  created_at: Date.UTC(2030, 0, 2, 3, 4, 5),
};

function convergence(
  source: "live" | "replay",
  narrative = plate.narrative,
  id = `${source}-dream`,
  riteDate = "2030-01-02",
): BodyCommand {
  return {
    id: `converge:${id}`,
    kind: "converge",
    dream: {
      id,
      riteDate,
      narrative,
      createdAt: plate.created_at,
      source,
    },
  };
}

function archiveEntry(overrides: Partial<DreamArchiveEntry> = {}): DreamArchiveEntry {
  return {
    id: "01JH0000000000000000000001",
    rite_date: "2030-01-02",
    narrative: plate.narrative,
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: plate.created_at,
    ...overrides,
  };
}

describe("Temple Dream Plate convergence linkage", () => {
  it("conceals only an exact real live Plate until the semantic dissolve transition", () => {
    expect(typeof repairApi.dreamPlatePresentation).toBe("function");
    if (repairApi.dreamPlatePresentation === undefined) return;

    const live = convergence("live");
    expect(repairApi.dreamPlatePresentation(plate, live, "gather", true)).toBe("concealed");
    expect(repairApi.dreamPlatePresentation(plate, live, "hold", true)).toBe("concealed");
    expect(repairApi.dreamPlatePresentation(plate, live, "dissolve", true)).toBe("revealed");
    expect(repairApi.dreamPlatePresentation(plate, live, "five", true)).toBe("revealed");
    expect(repairApi.dreamPlatePresentation(plate, live, "hold", false)).toBe("ordinary");

    expect(repairApi.dreamPlatePresentation(
      plate,
      convergence("live", "A different latest dream must stay visible."),
      "hold",
      true,
    )).toBe("ordinary");
    expect(repairApi.dreamPlatePresentation(null, live, "hold", true)).toBe("ordinary");
    expect(repairApi.dreamPlatePresentation(plate, convergence("replay"), "hold", true)).toBe("ordinary");
    expect(repairApi.dreamPlatePresentation(plate, null, "five", true)).toBe("ordinary");
  });

  it("keys the semantic phase to each live convergence before that command can paint", () => {
    expect(typeof repairApi.dreamPlatePhaseForCommand).toBe("function");
    expect(typeof repairApi.dreamPlatePresentation).toBe("function");
    const phaseForCommand = repairApi.dreamPlatePhaseForCommand;
    const presentation = repairApi.dreamPlatePresentation;
    if (phaseForCommand === undefined || presentation === undefined) return;

    const first = convergence("live", plate.narrative, "first-live");
    const second = convergence("live", plate.narrative, "second-live");
    const completedFirst = { commandId: first.id, phase: "five" as const };

    expect(phaseForCommand(first, completedFirst)).toBe("five");
    const secondInitial = phaseForCommand(second, completedFirst);
    expect(secondInitial).toBe("gather");
    expect(presentation(plate, second, secondInitial, true)).toBe("concealed");
  });

  it("keeps witnessed Plate A revealed after same-text wrong-rite convergence B completes", () => {
    expect(typeof repairApi.dreamPlatePhaseForPresentation).toBe("function");
    expect(typeof repairApi.dreamPlatePresentation).toBe("function");
    expect(typeof identityApi.archiveConfirmsDreamPlate).toBe("function");
    const phaseForPresentation = repairApi.dreamPlatePhaseForPresentation;
    const presentation = repairApi.dreamPlatePresentation;
    const confirmsPlate = identityApi.archiveConfirmsDreamPlate;
    if (
      phaseForPresentation === undefined
      || presentation === undefined
      || confirmsPlate === undefined
    ) return;

    const witnessedA = convergence("live", plate.narrative, "witnessed-a");
    const rejectedB = convergence("live", plate.narrative, "rejected-b", "2030-01-03");
    expect(confirmsPlate(plate, witnessedA, [archiveEntry()])).toBe(true);
    expect(confirmsPlate(plate, rejectedB, [archiveEntry()])).toBe(false);

    const completedA = { commandId: witnessedA.id, phase: "five" as const };
    expect(phaseForPresentation(null, witnessedA, completedA)).toBe("five");
    expect(presentation(plate, witnessedA, "five", true)).toBe("revealed");

    expect(phaseForPresentation(rejectedB, rejectedB, completedA)).toBe("gather");
    expect(presentation(plate, rejectedB, "gather", false)).toBe("ordinary");

    const completedB = { commandId: rejectedB.id, phase: "five" as const };
    const retainedPhase = phaseForPresentation(null, witnessedA, completedB);
    expect(retainedPhase).toBe("five");
    expect(presentation(plate, witnessedA, retainedPhase, true)).toBe("revealed");
  });

  it("removes a concealed Plate from layout and accessibility, then restores the real Plate", () => {
    const render = (presentation: DreamPlatePresentation) => renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RepairDream, {
        dream: plate,
        presentation,
      })),
    );
    const concealed = render("concealed");
    const revealed = render("revealed");

    expect(concealed).toContain('data-dream-presentation="concealed"');
    expect(concealed).toContain(" hidden=\"\"");
    expect(revealed).toContain('data-dream-presentation="revealed"');
    expect(revealed).not.toContain(" hidden=\"\"");
    expect(revealed).toContain(plate.narrative);
  });
});

describe("exact live Dream Plate identity", () => {
  it("requires the archive rite, cue narrative, and state Plate timestamp to identify one Plate", () => {
    expect(typeof identityApi.archiveConfirmsDreamPlate).toBe("function");
    if (identityApi.archiveConfirmsDreamPlate === undefined) return;

    const live = convergence("live");
    expect(identityApi.archiveConfirmsDreamPlate(plate, live, [archiveEntry()])).toBe(true);
    expect(identityApi.archiveConfirmsDreamPlate(plate, live, [
      archiveEntry({ rite_date: "2030-01-01" }),
    ])).toBe(false);
    expect(identityApi.archiveConfirmsDreamPlate(plate, live, [
      archiveEntry({ created_at: plate.created_at + 1 }),
    ])).toBe(false);
    expect(identityApi.archiveConfirmsDreamPlate(plate, live, [
      archiveEntry({ narrative: "Another Plate with the same date." }),
    ])).toBe(false);
    expect(identityApi.archiveConfirmsDreamPlate(plate, convergence("replay"), [archiveEntry()])).toBe(false);
    expect(identityApi.archiveConfirmsDreamPlate(null, live, [archiveEntry()])).toBe(false);
    expect(identityApi.archiveConfirmsDreamPlate(plate, live, [])).toBe(false);
  });

  it("keeps pending and failed identity lookups ordinary and caches one lookup per command + Plate tuple", async () => {
    expect(typeof identityApi.resolveDreamPlateIdentity).toBe("function");
    expect(typeof identityApi.DreamPlateIdentityCache).toBe("function");
    expect(typeof identityApi.dreamPlateIdentityKey).toBe("function");
    if (
      identityApi.resolveDreamPlateIdentity === undefined
      || identityApi.DreamPlateIdentityCache === undefined
      || identityApi.dreamPlateIdentityKey === undefined
    ) return;

    const live = convergence("live");
    let releasePage: (page: DreamPage) => void = () => undefined;
    const pendingPage = new Promise<DreamPage>((resolve) => { releasePage = resolve; });
    const pending = identityApi.resolveDreamPlateIdentity(plate, live, pendingPage);
    expect(repairApi.dreamPlatePresentation?.(plate, live, "hold", false)).toBe("ordinary");
    releasePage({ entries: [archiveEntry()], next: null });
    expect(await pending).toBe(true);
    expect(await identityApi.resolveDreamPlateIdentity(
      plate,
      live,
      Promise.reject(new Error("archive unavailable")),
    )).toBe(false);

    let loadCount = 0;
    const identities = new identityApi.DreamPlateIdentityCache(async () => {
      loadCount += 1;
      return { entries: [archiveEntry()], next: null };
    });
    const first = identities.confirm("", plate, live);
    const duplicate = identities.confirm("", plate, live);
    expect(duplicate).toBe(first);
    expect(await first).toBe(true);
    expect(loadCount).toBe(1);

    const nextCommand = convergence("live", plate.narrative, "next-command");
    expect(identityApi.dreamPlateIdentityKey(plate, nextCommand))
      .not.toBe(identityApi.dreamPlateIdentityKey(plate, live));
    expect(await identities.confirm("", plate, nextCommand)).toBe(true);
    expect(loadCount).toBe(2);
  });
});
