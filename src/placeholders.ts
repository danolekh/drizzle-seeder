export type GeneratedAsPlaceholder = {
  readonly _tag: "GeneratedAsPlaceholder";
};

export const generatedAsPlaceholder = (): GeneratedAsPlaceholder => {
  return {
    _tag: "GeneratedAsPlaceholder",
  };
};

export const isGeneratedAsPlaceholder = (
  placeholder: unknown,
): placeholder is GeneratedAsPlaceholder =>
  typeof placeholder === "object" &&
  placeholder !== null &&
  "_tag" in placeholder &&
  placeholder._tag === "GeneratedAsPlaceholder";

export type ColumnValueReference<returnType> = {
  _tag: "ColumnValueReference";
  refColumnName: string;
  refTableName: string;
  refRowIndex: number;
  transformFn: (value: any) => returnType;
};

export const columnValueReference = <returnType extends any = any>({
  refColumnName,
  refRowIndex,
  refTableName,
  transformFn,
}: Omit<ColumnValueReference<returnType>, "_tag">): ColumnValueReference<returnType> => ({
  _tag: "ColumnValueReference",
  refColumnName,
  refRowIndex,
  refTableName,
  transformFn,
});

export const isColumnValueReference = <T>(ref: unknown): ref is ColumnValueReference<T> =>
  typeof ref === "object" && ref !== null && "_tag" in ref && ref._tag === "ColumnValueReference";
