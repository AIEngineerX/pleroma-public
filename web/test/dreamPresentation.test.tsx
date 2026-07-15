import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dream, * as dreamModule from "../src/dream/Dream";
import type { BodyCommand } from "../src/experience/types";
import type { DreamView } from "../src/state/types";

type SeraphPhase = "gather" | "hold" | "dissolve" | "five";
type DreamPlatePresentation = "ordinary" | "concealed" | "revealed";

interface RepairDreamApi {
  dreamPlatePresentation?(
    dream: DreamView | null,
    command: BodyCommand | null,
    phase: SeraphPhase,
  ): DreamPlatePresentation;
}

const repairApi = dreamModule as unknown as RepairDreamApi;
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

function convergence(source: "live" | "replay", narrative = plate.narrative): BodyCommand {
  return {
    id: `converge:${source}`,
    kind: "converge",
    dream: {
      id: `${source}-dream`,
      riteDate: "2030-01-02",
      narrative,
      createdAt: plate.created_at,
      source,
    },
  };
}

describe("Temple Dream Plate convergence linkage", () => {
  it("conceals only an exact real live Plate until the semantic dissolve transition", () => {
    expect(typeof repairApi.dreamPlatePresentation).toBe("function");
    if (repairApi.dreamPlatePresentation === undefined) return;

    const live = convergence("live");
    expect(repairApi.dreamPlatePresentation(plate, live, "gather")).toBe("concealed");
    expect(repairApi.dreamPlatePresentation(plate, live, "hold")).toBe("concealed");
    expect(repairApi.dreamPlatePresentation(plate, live, "dissolve")).toBe("revealed");
    expect(repairApi.dreamPlatePresentation(plate, live, "five")).toBe("revealed");

    expect(repairApi.dreamPlatePresentation(
      plate,
      convergence("live", "A different latest dream must stay visible."),
      "hold",
    )).toBe("ordinary");
    expect(repairApi.dreamPlatePresentation(null, live, "hold")).toBe("ordinary");
    expect(repairApi.dreamPlatePresentation(plate, convergence("replay"), "hold")).toBe("ordinary");
    expect(repairApi.dreamPlatePresentation(plate, null, "five")).toBe("ordinary");
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
