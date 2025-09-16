import * as path from 'node:path';
import camelCase from 'camelcase';
import { writeFile } from 'node:fs/promises';
import { ensureDir } from 'fs-extra/esm';
import knex from 'knex';
import { readFileSync } from 'node:fs';
import { createPrismaSchemaBuilder } from '@mrleebo/prisma-ast';

function filterEntities(entities, included, ignored) {
  let filtered = [...entities];
  if (included?.length) {
    filtered = filtered.filter((entity) => included.includes(entity));
  }
  if (ignored?.length) {
    const ignoredRegex = ignored.filter((ignoreString) => {
      return ignoreString.startsWith("/") && ignoreString.endsWith("/");
    });
    const ignoredNames = ignored.filter(
      (entity) => !ignoredRegex.includes(entity)
    );
    if (ignoredNames.length) {
      filtered = filtered.filter((entity) => !ignoredNames.includes(entity));
    }
    if (ignoredRegex.length) {
      filtered = filtered.filter((entity) => {
        let useEntity = true;
        for (const text of ignoredRegex) {
          const pattern = text.substring(1, text.length - 1);
          if (entity.match(pattern) !== null) useEntity = false;
        }
        return useEntity;
      });
    }
  }
  return filtered;
}
function filterTables(tables, includedTables, ignoredTables) {
  return filterEntities(tables, includedTables, ignoredTables);
}
function filterViews(views, includedViews, ignoredViews) {
  return filterEntities(views, includedViews, ignoredViews);
}
function createEntityList(tables, views) {
  const allEntities = [
    ...tables.map((name) => ({ name, type: "table" })),
    ...views.map((name) => ({ name, type: "view" }))
  ];
  return allEntities.sort((a, b) => a.name.localeCompare(b.name));
}

const dateTypes = {
  mysql: ["date", "datetime", "timestamp"],
  postgres: [
    "timestamp",
    "timestamp with time zone",
    "timestamp without time zone",
    "date"
  ],
  sqlite: ["date", "datetime"],
  prisma: ["DateTime"]
};
const stringTypes = {
  mysql: [
    "tinytext",
    "text",
    "mediumtext",
    "longtext",
    "json",
    "time",
    "year",
    "char",
    "varchar"
  ],
  postgres: [
    "text",
    "character varying",
    "varchar",
    "char",
    "character",
    "json",
    "jsonb",
    "uuid",
    "time",
    "timetz",
    "interval",
    "name",
    "citext"
  ],
  sqlite: [
    "text",
    "character",
    "varchar",
    "varying character",
    "nchar",
    "native character",
    "nvarchar",
    "clob",
    "json"
  ],
  prisma: ["String", "Bytes", "Json"]
};
const bigIntTypes = {
  mysql: ["bigint"],
  postgres: ["bigint"],
  sqlite: ["bigint", "unsigned big int", "int8"],
  prisma: ["BigInt"]
};
const numberTypes = {
  mysql: [
    "tinyint",
    "smallint",
    "mediumint",
    "int",
    "float",
    "double",
    "bit",
    "year"
  ],
  postgres: [
    "smallint",
    "integer",
    "real",
    "double precision",
    "smallserial",
    "serial",
    "bigserial",
    "bit",
    "bit varying"
  ],
  sqlite: [
    "integer",
    "real",
    "numeric",
    "double",
    "double precision",
    "float",
    "int",
    "int2",
    "mediumint",
    "tinyint",
    "smallint"
  ],
  prisma: ["Int", "Float"]
};
const decimalTypes = {
  mysql: ["decimal"],
  postgres: ["decimal", "numeric", "money"],
  sqlite: ["decimal"],
  prisma: ["Decimal"]
};
const booleanTypes = {
  mysql: ["boolean"],
  postgres: ["boolean"],
  sqlite: ["boolean"],
  prisma: ["Boolean"]
};
const enumTypes = {
  mysql: ["enum"],
  postgres: ["enum", "USER-DEFINED"],
  sqlite: [],
  prisma: []
};
const enumRegex = /enum\(([^)]+)\)/;
function getTypeMappings(dbType) {
  return {
    dateTypes: dateTypes[dbType],
    stringTypes: stringTypes[dbType],
    bigIntTypes: bigIntTypes[dbType],
    numberTypes: numberTypes[dbType],
    decimalTypes: decimalTypes[dbType],
    booleanTypes: booleanTypes[dbType],
    enumTypes: enumTypes[dbType]
  };
}
function isJsonType(type) {
  return type.toLowerCase().includes("json");
}

const extractTypeExpression = (comment, prefix) => {
  const start = comment.indexOf(prefix);
  if (start === -1) return null;
  const typeLen = prefix.length;
  let position = start + typeLen;
  let depth = 1;
  while (position < comment.length && depth > 0) {
    const char = comment[position];
    if (char === "(" || char === "{" || char === "<" || char === "[") {
      depth++;
    } else if (char === ")" || char === "}" || char === ">" || char === "]") {
      depth--;
      if (depth === 0) {
        const extracted = comment.substring(start + typeLen, position);
        return extracted;
      }
    }
    position++;
  }
  return null;
};
const extractTSExpression = (comment) => extractTypeExpression(comment, "@ts(");
const extractKyselyExpression = (comment) => extractTypeExpression(comment, "@kysely(");
const extractZodExpression = (comment) => extractTypeExpression(comment, "@zod(");

function getType(op, desc, config, destination) {
  const { Default, Extra, Null, Type, Comment, EnumOptions } = desc;
  const schemaType = config.origin.type;
  const type = schemaType === "prisma" ? Type : Type.toLowerCase();
  const isNull = Null === "YES";
  const hasDefaultValue = Default !== null;
  const isGenerated = Extra.toLowerCase().includes("auto_increment") || Extra.toLowerCase().includes("default_generated");
  const isTsDestination = destination.type === "ts";
  const isKyselyDestination = destination.type === "kysely";
  const isZodDestination = destination.type === "zod";
  const typeMappings = getTypeMappings(schemaType);
  if (isTsDestination || isKyselyDestination) {
    const isJsonField = isJsonType(type);
    if (isKyselyDestination && isJsonField) {
      if (config.magicComments) {
        const kyselyOverrideType = extractKyselyExpression(Comment);
        if (kyselyOverrideType) {
          const shouldBeNullable2 = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
          return shouldBeNullable2 ? kyselyOverrideType.includes("| null") ? kyselyOverrideType : `${kyselyOverrideType} | null` : kyselyOverrideType;
        }
      }
      const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
      return shouldBeNullable ? "Json | null" : "Json";
    }
    if (isKyselyDestination && config.magicComments) {
      const kyselyOverrideType = extractKyselyExpression(Comment);
      if (kyselyOverrideType) {
        const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
        return shouldBeNullable ? kyselyOverrideType.includes("| null") ? kyselyOverrideType : `${kyselyOverrideType} | null` : kyselyOverrideType;
      }
    }
    if ((isTsDestination || isKyselyDestination) && config.magicComments) {
      const tsOverrideType = extractTSExpression(Comment);
      if (tsOverrideType) {
        const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
        return shouldBeNullable ? tsOverrideType.includes("| null") ? tsOverrideType : `${tsOverrideType} | null` : tsOverrideType;
      }
    }
  }
  if (isZodDestination && config.magicComments) {
    const zodOverrideType = extractZodExpression(Comment);
    if (zodOverrideType) {
      const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
      const nullishOption = destination.nullish;
      const nullableMethod = nullishOption ? "nullish" : "nullable";
      let finalType = zodOverrideType;
      if (shouldBeNullable) {
        if (!zodOverrideType.includes(`.${nullableMethod}()`) && !zodOverrideType.includes(".optional()")) {
          finalType = `${zodOverrideType}.${nullableMethod}()`;
        }
      }
      if ((op === "table" || op === "insertable") && hasDefaultValue && Default !== null && !isGenerated) {
        let defaultValueFormatted = Default;
        if (typeMappings.stringTypes.includes(type) || typeMappings.dateTypes.includes(type)) {
          defaultValueFormatted = `'${Default}'`;
        } else if (typeMappings.booleanTypes.includes(type)) {
          defaultValueFormatted = Default.toLowerCase() === "true" ? "true" : "false";
        } else if (typeMappings.numberTypes.includes(type)) {
          defaultValueFormatted = Default;
        } else {
          defaultValueFormatted = `'${Default}'`;
        }
        finalType = `${finalType}.default(${defaultValueFormatted})`;
      }
      return finalType;
    }
  }
  const overrideTypes = config.origin.overrideTypes;
  if (overrideTypes && overrideTypes[Type]) {
    const overrideType = overrideTypes[Type];
    const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
    if (isZodDestination) {
      const nullishOption = destination.nullish;
      const nullableMethod = nullishOption ? "nullish" : "nullable";
      return shouldBeNullable ? `${overrideType}.${nullableMethod}()` : overrideType;
    } else {
      return shouldBeNullable ? `${overrideType} | null` : overrideType;
    }
  }
  const enumTypesForSchema = typeMappings.enumTypes[schemaType] || [];
  const isEnum = enumTypesForSchema.includes(type);
  const isPrismaEnum = schemaType === "prisma" && config.enumDeclarations && config.enumDeclarations[type];
  if (isEnum || isPrismaEnum) {
    let enumValues = [];
    if (schemaType === "mysql" && type === "enum") {
      const match = Type.match(enumRegex);
      if (match) {
        enumValues = match[1].split(",").map((v) => v.trim().replace(/'/g, ""));
      }
    } else if (schemaType === "postgres" && EnumOptions) {
      enumValues = EnumOptions;
    } else if (isPrismaEnum && config.enumDeclarations) {
      enumValues = config.enumDeclarations[type];
    }
    if (enumValues.length > 0) {
      const shouldBeNullable = isNull;
      const shouldBeOptional = op === "insertable" && (hasDefaultValue || isGenerated) || op === "updateable";
      if (isZodDestination) {
        const enumString = `z.enum([${enumValues.map((v) => `'${v}'`).join(",")}])`;
        const nullishOption = destination.nullish;
        if ((op === "table" || op === "insertable") && hasDefaultValue && Default !== null && !isGenerated) {
          if (shouldBeNullable) {
            const nullableMethod = nullishOption ? "nullish" : "nullable";
            return `${enumString}.${nullableMethod}().default('${Default}')`;
          } else {
            return `${enumString}.default('${Default}')`;
          }
        }
        if (shouldBeNullable && shouldBeOptional) {
          const nullableMethod = nullishOption ? "nullish" : "nullable";
          return `${enumString}.${nullableMethod}()`;
        } else if (shouldBeNullable) {
          const nullableMethod = nullishOption ? "nullish" : "nullable";
          return `${enumString}.${nullableMethod}()`;
        } else if (shouldBeOptional) {
          return `${enumString}.optional()`;
        } else {
          return enumString;
        }
      } else if (isTsDestination) {
        const enumString = enumValues.map((v) => `'${v}'`).join(" | ");
        if (shouldBeNullable) {
          return `${enumString} | null`;
        } else {
          return enumString;
        }
      } else if (isKyselyDestination) {
        const enumString = enumValues.map((v) => `'${v}'`).join(" | ");
        if (shouldBeNullable) {
          return `${enumString} | null`;
        } else {
          return enumString;
        }
      }
    }
  }
  return generateStandardType(op, desc, config, destination, typeMappings);
}
function generateStandardType(op, desc, config, destination, typeMappings) {
  const { Default, Extra, Null, Type } = desc;
  const schemaType = config.origin.type;
  const type = schemaType === "prisma" ? Type : Type.toLowerCase();
  const isNull = Null === "YES";
  const hasDefaultValue = Default !== null;
  const isGenerated = Extra.toLowerCase().includes("auto_increment") || Extra.toLowerCase().includes("default_generated");
  const isZodDestination = destination.type === "zod";
  const isKyselyDestination = destination.type === "kysely";
  const shouldBeNullable = isNull;
  const shouldBeOptional = op === "insertable" && (hasDefaultValue || isGenerated) || op === "updateable";
  let baseType;
  if (typeMappings.dateTypes.includes(type)) {
    if (isZodDestination) {
      const useDateType = destination.useDateType;
      if (useDateType) {
        baseType = "z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())";
      } else {
        baseType = "z.date()";
      }
    } else {
      baseType = "Date";
    }
  } else if (typeMappings.bigIntTypes.includes(type)) {
    if (isZodDestination) {
      baseType = "z.string()";
    } else if (isKyselyDestination) {
      baseType = "BigInt";
    } else {
      baseType = "string";
    }
  } else if (typeMappings.decimalTypes.includes(type)) {
    if (isZodDestination) {
      baseType = "z.string()";
    } else if (isKyselyDestination) {
      baseType = "Decimal";
    } else {
      baseType = "string";
    }
  } else if (typeMappings.numberTypes.includes(type)) {
    if (isZodDestination) {
      baseType = "z.number()";
      if (!shouldBeNullable && !hasDefaultValue) {
        baseType += ".nonnegative()";
      }
    } else {
      baseType = "number";
    }
  } else if (typeMappings.booleanTypes.includes(type)) {
    baseType = isZodDestination ? "z.boolean()" : "boolean";
  } else if (typeMappings.stringTypes.includes(type)) {
    if (isZodDestination) {
      const useTrim = destination.useTrim;
      const requiredString = destination.requiredString;
      baseType = "z.string()";
      if (useTrim) baseType += ".trim()";
      if (requiredString && !shouldBeNullable) baseType += ".min(1)";
    } else {
      baseType = "string";
    }
  } else {
    baseType = isZodDestination ? "z.string()" : "string";
  }
  if (isZodDestination) {
    if ((op === "table" || op === "insertable") && hasDefaultValue && Default !== null && !isGenerated) {
      let defaultValueFormatted = Default;
      if (typeMappings.stringTypes.includes(type) || typeMappings.dateTypes.includes(type)) {
        defaultValueFormatted = `'${Default}'`;
      } else if (typeMappings.booleanTypes.includes(type)) {
        defaultValueFormatted = Default.toLowerCase() === "true" ? "true" : "false";
      } else if (typeMappings.numberTypes.includes(type)) {
        defaultValueFormatted = Default;
      } else {
        defaultValueFormatted = `'${Default}'`;
      }
      if (shouldBeNullable) {
        const nullishOption = destination.nullish;
        const nullableMethod = nullishOption ? "nullish" : "nullable";
        return `${baseType}.${nullableMethod}().default(${defaultValueFormatted})`;
      } else {
        return `${baseType}.default(${defaultValueFormatted})`;
      }
    }
    if (shouldBeNullable && shouldBeOptional) {
      const nullishOption = destination.nullish;
      const nullableMethod = nullishOption ? "nullish" : "nullable";
      return `${baseType}.${nullableMethod}()`;
    } else if (shouldBeNullable) {
      const nullishOption = destination.nullish;
      const nullableMethod = nullishOption ? "nullish" : "nullable";
      return `${baseType}.${nullableMethod}()`;
    } else if (shouldBeOptional) {
      return `${baseType}.optional()`;
    } else {
      return baseType;
    }
  } else {
    if (shouldBeNullable) {
      return `${baseType} | null`;
    } else {
      return baseType;
    }
  }
}

function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}
function generateViewContent({
  view,
  describes,
  config,
  destination,
  isCamelCase,
  enumDeclarations: _enumDeclarations,
  defaultZodHeader
}) {
  let content = "";
  if (destination.type === "kysely") {
    const pascalView = camelCase(view, { pascalCase: true });
    content += `// Kysely type definitions for ${view} (view)

`;
    content += `// This interface defines the structure of the '${view}' view (read-only)
`;
    content += `export interface ${pascalView}View {
`;
    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const fieldType = getType("selectable", desc, config, destination);
      content += `  ${fieldName}: ${fieldType};
`;
    }
    content += "}\n\n";
    content += `// Helper types for ${view} (view - read-only)
`;
    content += `export type Selectable${pascalView}View = Selectable<${pascalView}View>;
`;
  } else if (destination.type === "ts") {
    const pascalView = camelCase(view, { pascalCase: true });
    content += `// TypeScript interface for ${view} (view - read-only)
`;
    content += `export interface ${pascalView}View {
`;
    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const fieldType = getType("selectable", desc, config, destination);
      content += `  ${fieldName}: ${fieldType};
`;
    }
    content += "}\n";
  } else if (destination.type === "zod") {
    const version = destination.version || 3;
    const header = destination.header || defaultZodHeader(version);
    if (!content.includes(header)) {
      content += header;
    }
    content += `// View schema (read-only)
`;
    const snakeView = toSnakeCase(view);
    content += `export const ${snakeView}_view = z.object({
`;
    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const fieldType = getType("selectable", desc, config, destination);
      content += `  ${fieldName}: ${fieldType},
`;
    }
    content += "})\n\n";
    const pascalView = camelCase(view, { pascalCase: true });
    content += `export type ${camelCase(`${pascalView}ViewType`, {
      pascalCase: true
    })} = z.infer<typeof ${snakeView}_view>
`;
  }
  return content;
}
function generateContent({
  table,
  describes,
  config,
  destination,
  isCamelCase,
  enumDeclarations: _enumDeclarations,
  defaultZodHeader
}) {
  let content = "";
  if (destination.type === "ts") {
    return generateTypeScriptContent({
      table,
      describes,
      config,
      destination,
      isCamelCase
    });
  } else if (destination.type === "kysely") {
    return generateKyselyContent({
      table,
      describes,
      config,
      destination,
      isCamelCase
    });
  } else if (destination.type === "zod") {
    return generateZodContent({
      table,
      describes,
      config,
      destination,
      isCamelCase,
      defaultZodHeader
    });
  }
  return content;
}
function generateTypeScriptContent({
  table,
  describes,
  config,
  destination,
  isCamelCase
}) {
  let content = "";
  const pascalTable = camelCase(table, { pascalCase: true });
  content += `// TypeScript interfaces for ${table}

`;
  content += `export interface ${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("table", desc, config, destination);
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n\n";
  content += `export interface Insertable${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("insertable", desc, config, destination);
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n\n";
  content += `export interface Updateable${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("updateable", desc, config, destination);
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n\n";
  content += `export interface Selectable${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("selectable", desc, config, destination);
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n";
  return content;
}
function generateKyselyContent({
  table,
  describes,
  config,
  destination,
  isCamelCase
}) {
  let content = "";
  const pascalTable = camelCase(table, { pascalCase: true });
  content += `// Kysely type definitions for ${table}

`;
  content += `// This interface defines the structure of the '${table}' table
`;
  content += `export interface ${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    let fieldType = getType("table", desc, config, destination);
    const hasMagicComment = config.magicComments && (desc.Comment.includes("@kysely(") || desc.Comment.includes("@ts("));
    if (!hasMagicComment) {
      const isAutoIncrement = desc.Extra.toLowerCase().includes("auto_increment");
      const isDefaultGenerated = desc.Extra.toLowerCase().includes("default_generated");
      const hasExplicitDefault = desc.Default !== null && !isAutoIncrement && !isDefaultGenerated;
      if (isAutoIncrement || isDefaultGenerated || hasExplicitDefault) {
        fieldType = `Generated<${fieldType.replace(" | null", "")}>${fieldType.includes(" | null") ? " | null" : ""}`;
      }
    }
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n\n";
  content += `// Use these types for inserting, selecting and updating the table
`;
  content += `export type Selectable${pascalTable} = Selectable<${pascalTable}>;
`;
  content += `export type Insertable${pascalTable} = Insertable<${pascalTable}>;
`;
  content += `export type Updateable${pascalTable} = Updateable<${pascalTable}>;
`;
  return content;
}
function generateZodContent({
  table,
  describes,
  config,
  destination,
  isCamelCase,
  defaultZodHeader
}) {
  let content = "";
  const version = destination.version || 3;
  const header = destination.header || defaultZodHeader(version);
  if (!content.includes(header)) {
    content += header;
  }
  const snakeTable = toSnakeCase(table);
  content += `export const ${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("table", desc, config, destination);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  content += `export const insertable_${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("insertable", desc, config, destination);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  content += `export const updateable_${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("updateable", desc, config, destination);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  content += `export const selectable_${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("selectable", desc, config, destination);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  content += `export type ${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof ${snakeTable}>
`;
  content += `export type Insertable${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof insertable_${snakeTable}>
`;
  content += `export type Updateable${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof updateable_${snakeTable}>
`;
  content += `export type Selectable${camelCase(`${table}Type`, { pascalCase: true })} = z.infer<typeof selectable_${snakeTable}>
`;
  return content;
}

function createDatabaseConnection(config) {
  const { origin } = config;
  switch (origin.type) {
    case "mysql":
      return knex({
        client: "mysql2",
        connection: {
          host: origin.host,
          port: origin.port,
          user: origin.user,
          password: origin.password,
          database: origin.database,
          ssl: origin.ssl
        }
      });
    case "postgres":
      return knex({
        client: "pg",
        connection: {
          host: origin.host,
          port: origin.port,
          user: origin.user,
          password: origin.password,
          database: origin.database,
          ssl: origin.ssl
        },
        searchPath: origin.schema ? [origin.schema] : ["public"]
      });
    case "sqlite":
      return knex({
        client: "sqlite3",
        connection: {
          filename: origin.path
        },
        useNullAsDefault: true
      });
    default:
      throw new Error(`Unsupported database type: ${origin.type}`);
  }
}
async function extractTables(db, config) {
  const { origin } = config;
  switch (origin.type) {
    case "mysql":
      const mysqlTables = await db.raw(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
      `, [origin.database]);
      return mysqlTables[0].map((row) => row.table_name);
    case "postgres":
      const schema = origin.schema || "public";
      const postgresTables = await db.raw(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
      `, [schema]);
      return postgresTables.rows.map((row) => row.table_name);
    case "sqlite":
      const sqliteTables = await db.raw(`
        SELECT name 
        FROM sqlite_master 
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `);
      return sqliteTables.map((row) => row.name);
    default:
      return [];
  }
}
async function extractViews(db, config) {
  const { origin } = config;
  switch (origin.type) {
    case "mysql":
      const mysqlViews = await db.raw(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'VIEW'
      `, [origin.database]);
      return mysqlViews[0].map((row) => row.table_name);
    case "postgres":
      const schema = origin.schema || "public";
      const postgresViews = await db.raw(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'VIEW'
      `, [schema]);
      return postgresViews.rows.map((row) => row.table_name);
    case "sqlite":
      const sqliteViews = await db.raw(`
        SELECT name 
        FROM sqlite_master 
        WHERE type = 'view'
      `);
      return sqliteViews.map((row) => row.name);
    default:
      return [];
  }
}
async function extractColumnDescriptions(db, config, tableName) {
  const { origin } = config;
  switch (origin.type) {
    case "mysql":
      const mysqlColumns = await db.raw(`
        SELECT 
          column_name as \`Field\`,
          column_default as \`Default\`,
          extra as \`Extra\`,
          is_nullable as \`Null\`,
          column_type as \`Type\`,
          column_comment as \`Comment\`
        FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `, [origin.database, tableName]);
      return mysqlColumns[0].map((row) => ({
        Field: row.Field,
        Default: row.Default,
        Extra: row.Extra || "",
        Null: row.Null,
        Type: row.Type,
        Comment: row.Comment || ""
      }));
    case "postgres":
      const schema = origin.schema || "public";
      const postgresColumns = await db.raw(`
        SELECT 
          column_name as "Field",
          column_default as "Default",
          '' as "Extra",
          is_nullable as "Null",
          data_type as "Type",
          '' as "Comment"
        FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `, [schema, tableName]);
      return postgresColumns.rows.map((row) => ({
        Field: row.Field,
        Default: row.Default,
        Extra: row.Extra || "",
        Null: row.Null,
        Type: row.Type,
        Comment: row.Comment || ""
      }));
    case "sqlite":
      const sqliteColumns = await db.raw(`PRAGMA table_info(${tableName})`);
      return sqliteColumns.map((row) => ({
        Field: row.name,
        Default: row.dflt_value,
        Extra: row.pk ? "PRIMARY KEY" : "",
        Null: row.notnull ? "NO" : "YES",
        Type: row.type,
        Comment: ""
      }));
    default:
      return [];
  }
}

function extractPrismaEntities(config) {
  if (config.origin.type !== "prisma") {
    return { tables: [], views: [], enumDeclarations: {} };
  }
  const schemaContent = readFileSync(config.origin.path, "utf-8");
  const schema = createPrismaSchemaBuilder(schemaContent);
  const prismaModels = schema.findAllByType("model", {});
  const tables = prismaModels.filter((m) => m !== null).map((model) => model.name);
  const prismaViews = schema.findAllByType("view", {});
  const views = prismaViews.filter((v) => v !== null).map((view) => view.name);
  const enumDeclarations = {};
  const prismaEnums = schema.findAllByType("enum", {});
  for (const prismaEnum of prismaEnums) {
    if (prismaEnum && "name" in prismaEnum && "enumerators" in prismaEnum) {
      const enumName = prismaEnum.name;
      const enumerators = prismaEnum.enumerators;
      enumDeclarations[enumName] = enumerators.map((e) => e.name);
    }
  }
  return { tables, views, enumDeclarations };
}
function extractPrismaColumnDescriptions(config, entityName, enumDeclarations) {
  if (config.origin.type !== "prisma") {
    return [];
  }
  const schemaContent = readFileSync(config.origin.path, "utf-8");
  const schema = createPrismaSchemaBuilder(schemaContent);
  let entity = schema.findByType("model", { name: entityName });
  if (!entity) {
    entity = schema.findByType("view", { name: entityName });
  }
  if (!entity || !("properties" in entity)) {
    return [];
  }
  const fields = entity.properties.filter(
    (p) => p.type === "field" && p.array !== true && !p.attributes?.find((a) => a.name === "relation")
  );
  return fields.map((field) => {
    let defaultGenerated = false;
    let defaultValue = null;
    if (field.attributes) {
      for (const attr of field.attributes) {
        if (attr.name === "updatedAt") {
          defaultGenerated = true;
        } else if (attr.name === "default") {
          if (attr.args && attr.args.length > 0) {
            const arg = attr.args[0];
            if (typeof arg === "object" && "value" in arg) {
              if (typeof arg.value === "object" && arg.value.type === "function") {
                const functionName = arg.value.name;
                if (functionName === "autoincrement" || functionName === "cuid" || functionName === "uuid" || functionName === "now") {
                  defaultGenerated = true;
                }
              } else if (typeof arg.value === "string") {
                let cleanValue = arg.value;
                if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
                  cleanValue = cleanValue.slice(1, -1);
                }
                defaultValue = cleanValue;
              } else {
                defaultValue = String(arg.value);
              }
            } else if (typeof arg === "string") {
              defaultValue = arg;
            }
          }
        }
      }
    }
    const isOptional = field.optional === true;
    let enumOptions;
    const fieldType = String(field.fieldType);
    if (enumDeclarations[fieldType]) {
      enumOptions = enumDeclarations[fieldType];
    }
    return {
      Field: field.name,
      Default: defaultValue,
      Extra: defaultGenerated ? "auto_increment" : "",
      Null: isOptional ? "YES" : "NO",
      Type: fieldType,
      Comment: "",
      // Prisma doesn't have column comments in the same way
      EnumOptions: enumOptions
    };
  });
}

const defaultKyselyHeader = "import { Insertable, Selectable, Updateable, ColumnType } from 'kysely';\n\n";
const defaultZodHeader = (version) => "import { z } from 'zod" + (version === 3 ? "" : "/v4") + "';\n\n";
const kyselyJsonTypes = `// JSON type definitions
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

`;

async function generate(config) {
  let tables = [];
  let views = [];
  let enumDeclarations = {};
  let db = null;
  try {
    if (config.origin.type === "prisma") {
      const prismaEntities = extractPrismaEntities(config);
      tables = prismaEntities.tables;
      views = prismaEntities.views;
      enumDeclarations = prismaEntities.enumDeclarations;
      config.enumDeclarations = enumDeclarations;
    } else {
      db = createDatabaseConnection(config);
      tables = await extractTables(db, config);
      views = await extractViews(db, config);
    }
    tables = filterTables(tables, config.tables, config.ignore);
    if (!config.includeViews) {
      views = [];
    } else {
      views = filterViews(views, config.views, config.ignoreViews);
    }
    const allEntities = createEntityList(tables, views);
    const results = {};
    const isCamelCase = config.camelCase === true;
    const nonKyselyDestinations = config.destinations.filter((d) => d.type !== "kysely");
    for (const entity of allEntities) {
      const { name: entityName, type: entityType } = entity;
      let describes;
      if (config.origin.type === "prisma") {
        describes = extractPrismaColumnDescriptions(config, entityName, enumDeclarations);
      } else {
        describes = await extractColumnDescriptions(db, config, entityName);
      }
      if (describes.length === 0) continue;
      for (const destination of nonKyselyDestinations) {
        const content = entityType === "view" ? generateViewContent({
          view: entityName,
          describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
          config,
          destination,
          isCamelCase,
          enumDeclarations,
          defaultZodHeader
        }) : generateContent({
          table: entityName,
          describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
          config,
          destination,
          isCamelCase,
          enumDeclarations,
          defaultZodHeader
        });
        const suffix = destination.suffix === void 0 ? destination.type : destination.suffix;
        const folder = destination.folder || ".";
        const fileName = `${entityName}${suffix ? `.${suffix}` : ""}.ts`;
        const filePath = path.join(folder, fileName);
        results[filePath] = (destination.header || "") + content;
      }
    }
    const kyselyDestinations = config.destinations.filter((d) => d.type === "kysely");
    for (const kyselyDestination of kyselyDestinations) {
      const header = kyselyDestination.header || defaultKyselyHeader;
      const schemaName = kyselyDestination.schemaName || "DB";
      let consolidatedContent = `${header}
${kyselyJsonTypes}`;
      const tableContents = [];
      for (const entity of allEntities) {
        const { name: entityName, type: entityType } = entity;
        let describes;
        if (config.origin.type === "prisma") {
          describes = extractPrismaColumnDescriptions(config, entityName, enumDeclarations);
        } else {
          describes = await extractColumnDescriptions(db, config, entityName);
        }
        if (describes.length === 0) continue;
        const content = entityType === "view" ? generateViewContent({
          view: entityName,
          describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
          config,
          destination: kyselyDestination,
          isCamelCase,
          enumDeclarations,
          defaultZodHeader
        }) : generateContent({
          table: entityName,
          describes: describes.sort((a, b) => a.Field.localeCompare(b.Field)),
          config,
          destination: kyselyDestination,
          isCamelCase,
          enumDeclarations,
          defaultZodHeader
        });
        tableContents.push({ table: entityName, content });
        consolidatedContent += content + "\n";
      }
      consolidatedContent += `
// Database Interface
export interface ${schemaName} {
`;
      const sortedTableEntries = tableContents.map(({ table, content }) => {
        const isView = content.includes("(view");
        const pascalTable = camelCase(table, { pascalCase: true }) + (isView ? "View" : "");
        const tableKey = isCamelCase ? camelCase(table) : table;
        return { tableKey, pascalTable, isView };
      }).sort((a, b) => a.tableKey.localeCompare(b.tableKey));
      for (const { tableKey, pascalTable } of sortedTableEntries) {
        consolidatedContent += `  ${tableKey}: ${pascalTable};
`;
      }
      consolidatedContent += "}\n";
      const outputFile = kyselyDestination.outFile || path.join(kyselyDestination.folder || ".", "db.ts");
      results[outputFile] = consolidatedContent;
    }
    if (config.dryRun) {
      return results;
    }
    for (const [filePath, content] of Object.entries(results)) {
      const fullPath = path.resolve(filePath);
      await ensureDir(path.dirname(fullPath));
      await writeFile(fullPath, content);
      if (!config.silent) {
        console.log(`Created: ${filePath}`);
      }
    }
    return results;
  } finally {
    if (db) {
      await db.destroy();
    }
  }
}

export { defaultKyselyHeader, defaultZodHeader, extractKyselyExpression, extractTSExpression, extractTypeExpression, extractZodExpression, generate, generateContent, generateViewContent, getType };
