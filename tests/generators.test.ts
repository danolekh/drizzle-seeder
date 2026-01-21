import { expect, test, describe } from "vitest";
import { createGenerator } from "../src";

describe("generators logic", () => {
  test("should properly call generator chain", () => {
    let i = 0;

    const generator = createGenerator({
      generate: (ctx) => {
        i++;
        ctx.super();
      },
    })
      .extend(
        createGenerator({
          generate: (ctx) => {
            i++;
            ctx.super();
          },
        }),
      )
      .extend(
        createGenerator({
          generate: (ctx) => {
            i++;
            ctx.super();
          },
        }),
      );

    expect(() =>
      generator.generate({
        super: () => {
          throw new Error("Generator chain ended");
        },
      } as any),
    ).toThrow("Generator chain ended");

    expect(i).toEqual(3);
  });
});
