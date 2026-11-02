import { describe, expect, test } from "bun:test";
import { filterUsed, parseUsedSources } from "./used-sources";

const sources = [
  { title: "Visto conformità", refs: [1, 2] },
  { title: "FAQ ISEE", refs: [3] },
];

describe("fonti usate", () => {
  test("se l'AI dice 'nessuna' non si mostra nessun PDF", () => {
    const { clean, used } = parseUsedSources("Risposta.\nRIEPILOGO: ok\nFONTI USATE: nessuna");
    expect(clean).toBe("Risposta.\nRIEPILOGO: ok");
    expect(filterUsed(sources, used)).toEqual([]);
  });

  test("si mostrano solo i PDF citati", () => {
    const { used } = parseUsedSources("Testo\n**FONTI USATE:** 3");
    expect(filterUsed(sources, used).map((s) => s.title)).toEqual(["FAQ ISEE"]);
  });

  test("la riga a metà scrittura non compare nel testo", () => {
    expect(parseUsedSources("Testo\nFONTI US").clean).toBe("Testo");
  });
});
