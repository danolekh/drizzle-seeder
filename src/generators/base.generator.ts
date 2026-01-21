import type { getColumnGeneratorContext, SchemaExport } from "../shared";

export type ExtendedGeneratorContext = getColumnGeneratorContext<SchemaExport>;
export type GeneratorContext = Omit<ExtendedGeneratorContext, "super">;

export abstract class BaseGenerator {
  abstract generate(ctx: ExtendedGeneratorContext): unknown;

  /**
   * Creates a new chained generator where `next` runs first.
   * When `next` calls ctx.super(), it delegates to this generator.
   */
  extend(next: BaseGenerator): BaseGenerator {
    return new ChainedGenerator(this, next);
  }
}

export class ChainedGenerator extends BaseGenerator {
  constructor(
    private readonly base: BaseGenerator,
    private readonly next: BaseGenerator,
  ) {
    super();
  }

  generate(ctx: ExtendedGeneratorContext): unknown {
    // next runs first, ctx.super() calls base
    const superFn = () => this.base.generate(ctx);
    return this.next.generate({ ...ctx, super: superFn });
  }
}

export type GeneratorConfig = {
  generate: (ctx: ExtendedGeneratorContext) => unknown;
};

class FunctionalGenerator extends BaseGenerator {
  constructor(private readonly config: GeneratorConfig) {
    super();
  }

  generate(ctx: ExtendedGeneratorContext): unknown {
    return this.config.generate(ctx);
  }
}

export function createGenerator(config: GeneratorConfig): BaseGenerator {
  return new FunctionalGenerator(config);
}
