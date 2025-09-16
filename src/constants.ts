/**
 * Constants and default headers for code generation
 */

export const defaultKyselyHeader =
  "import { Generated, Insertable, Selectable, Updateable, ColumnType } from 'kysely';\n\n"

export const defaultZodHeader = (version: 3 | 4) => 
  "import { z } from 'zod" + (version === 3 ? '' : '/v4') + "';\n\n"

export const kyselyJsonTypes = `// JSON type definitions
export type Json = ColumnType<JsonValue, string, string>;

export type JsonArray = JsonValue[];

export type JsonObject = {
  [x: string]: JsonValue | undefined;
};

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>

export type Decimal = ColumnType<string, number | string, number | string>

export type BigInt = ColumnType<string, number | string, number | string>

`
