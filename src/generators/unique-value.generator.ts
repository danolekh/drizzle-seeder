import { BaseGenerator, type ExtendedGeneratorContext } from "./base.generator";

export class UniqueValueGenerator extends BaseGenerator {
  constructor(readonly maxTries: number = 5000) {
    super();
  }

  generate(ctx: ExtendedGeneratorContext): unknown {
    if (!ctx.duplicateChecker) {
      return ctx.super();
    }

    let value: unknown;
    let tries = 0;

    do {
      value = ctx.super();
      tries++;
      if (tries >= this.maxTries) {
        throw new Error(
          `Failed to generate unique value for ${ctx.columnDef.name} column after ${tries} tries | it was ${ctx.index + 1} value of ${ctx.count}`,
        );
      }
    } while (!ctx.duplicateChecker.add(value));

    return value;
  }
}

export const DefaultUniqueValueGenerator = new UniqueValueGenerator();
