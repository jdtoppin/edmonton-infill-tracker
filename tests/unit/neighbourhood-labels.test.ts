import { describe, expect, it } from "vitest";
import {
  isSpecificNeighbourhoodName,
  parseCurrentNeighbourhoodRows,
} from "../../components/maps/neighbourhood-labels";

describe("current Edmonton neighbourhood map labels", () => {
  it("keeps current constituent names and rejects Greater-area aggregates", () => {
    expect(isSpecificNeighbourhoodName("Capilano")).toBe(true);
    expect(isSpecificNeighbourhoodName("Fulton Place")).toBe(true);
    expect(isSpecificNeighbourhoodName("Greater Hardisty")).toBe(false);
  });

  it("validates City centroid rows before they become map labels", () => {
    expect(
      parseCurrentNeighbourhoodRows(
        [
          {
            number: "6060",
            name_mixed: "Capilano",
            latitude: "53.545",
            longitude: "-113.421",
          },
          {
            number: "6070",
            name_mixed: "Greater Hardisty",
            latitude: "53.55",
            longitude: "-113.43",
          },
        ],
        { minimumRows: 1 },
      ),
    ).toEqual([
      {
        cityId: "6060",
        name: "Capilano",
        latitude: 53.545,
        longitude: -113.421,
      },
    ]);
  });

  it("rejects unsafe coordinates", () => {
    expect(() =>
      parseCurrentNeighbourhoodRows(
        [
          {
            number: "6060",
            name_mixed: "Capilano",
            latitude: "-113.421",
            longitude: "53.545",
          },
        ],
        { minimumRows: 1 },
      ),
    ).toThrow("invalid data");
  });
});
