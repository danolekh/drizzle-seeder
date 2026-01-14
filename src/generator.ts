import type {
  ColumnGeneratorContext,
  RootGeneratorContext,
} from "./column-generator";

type RootGeneratorFn = (ctx: RootGeneratorContext) => unknown;
type ExtendedGeneratorFn = (ctx: ColumnGeneratorContext) => unknown;

export class Generator {
  private chain: Array<RootGeneratorFn | ExtendedGeneratorFn>;

  private constructor(chain: Array<RootGeneratorFn | ExtendedGeneratorFn>) {
    this.chain = chain;
  }

  static create(rootFn: RootGeneratorFn): Generator {
    return new Generator([rootFn]);
  }

  extend(fn: ExtendedGeneratorFn): Generator {
    return new Generator([...this.chain, fn]);
  }

  resolve(baseCtx: RootGeneratorContext): unknown {
    let superFn: (() => unknown) | undefined;

    for (let i = 0; i < this.chain.length; i++) {
      const fn = this.chain[i]!;
      const prevSuper = superFn;

      if (i === 0) {
        superFn = () => fn(baseCtx as any);
      } else {
        superFn = () => fn({ ...baseCtx, super: prevSuper! } as any);
      }
    }

    return superFn!();
  }
}
