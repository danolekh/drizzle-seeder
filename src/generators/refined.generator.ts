import type { getRefineConfig } from "../pg-core";
import type { getPossibleRefs, getTablesFromSchemaExport, SchemaExport } from "../shared";
import { BaseGenerator, type ExtendedGeneratorContext } from "./base.generator";

export class RefinedGenerator<
  schema extends SchemaExport,
  tableOrder extends readonly getTablesFromSchemaExport<schema>[],
> extends BaseGenerator {
  constructor(
    private readonly refineConfig: getRefineConfig<
      schema,
      tableOrder,
      Array<getPossibleRefs<schema, tableOrder>>
    > | null,
  ) {
    super();
  }

  generate(ctx: ExtendedGeneratorContext): unknown {
    if (!this.refineConfig) {
      return ctx.super();
    }

    const tableConfig =
      this.refineConfig.tables[ctx.tableKey as keyof typeof this.refineConfig.tables];
    const refined = tableConfig?.columns?.[ctx.columnKey as keyof typeof tableConfig.columns];

    if (refined) {
      return (refined as any)(ctx);
    }

    return ctx.super();
  }
}
