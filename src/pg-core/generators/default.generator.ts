import { DefaultDataTypeGenerator } from "../../generators";
import { DefaultRuntimeConfigAwareGenerator } from "./runtime-config-aware.generator";
import { DefaultUniqueValueGenerator } from "../../generators";

export const DefaultGenerator = DefaultDataTypeGenerator.extend(
  DefaultRuntimeConfigAwareGenerator,
).extend(DefaultUniqueValueGenerator);
