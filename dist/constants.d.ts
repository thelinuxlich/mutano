/**
 * Constants and default headers for code generation
 */
export declare const defaultKyselyHeader = "import { Generated, Insertable, Selectable, Updateable, ColumnType } from 'kysely';\n\n";
export declare const defaultZodHeader: (version: 3 | 4) => string;
export declare const kyselyJsonTypes = "// JSON type definitions\nexport type Json = ColumnType<JsonValue, string, string>;\n\nexport type JsonArray = JsonValue[];\n\nexport type JsonObject = {\n  [x: string]: JsonValue | undefined;\n};\n\nexport type JsonPrimitive = boolean | number | string | null;\n\nexport type JsonValue = JsonArray | JsonObject | JsonPrimitive;\n\nexport type Generated<T> = T extends ColumnType<infer S, infer I, infer U>\n  ? ColumnType<S, I | undefined, U>\n  : ColumnType<T, T | undefined, T>\n\nexport type Decimal = ColumnType<string, number | string, number | string>\n\nexport type BigInt = ColumnType<string, number | string, number | string>\n\n";
