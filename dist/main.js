import{createRequire as _pkgrollCR}from"node:module";const require=_pkgrollCR(import.meta.url);import * as path from 'node:path';
import camelCase from 'camelcase';
import { writeFile } from 'node:fs/promises';
import { ensureDir } from 'fs-extra/esm';
import pluralize from 'pluralize';
import knex from 'knex';
import { readFileSync } from 'node:fs';
import require$$0 from 'path';
import require$$1 from 'fs';
import require$$2, { EOL } from 'os';

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
    ...tables.filter((name) => typeof name === "string" && name.length > 0).map((name) => ({ name, type: "table" })),
    ...views.filter((name) => typeof name === "string" && name.length > 0).map((name) => ({ name, type: "view" }))
  ];
  return allEntities.sort((a, b) => a.name.localeCompare(b.name));
}

function applyInflection(name, inflection) {
  if (inflection === "singular") {
    return pluralize.singular(name);
  }
  if (inflection === "plural") {
    return pluralize.plural(name);
  }
  return name;
}

const dateTypes = {
  mysql: ["date", "datetime", "datetime(3)", "timestamp", "timestamp(3)"],
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
function getTypeMappings(dbType, dialect) {
  const effectiveType = dbType === "sql" ? dialect || "mysql" : dbType;
  return {
    dateTypes: dateTypes[effectiveType],
    stringTypes: stringTypes[effectiveType],
    bigIntTypes: bigIntTypes[effectiveType],
    numberTypes: numberTypes[effectiveType],
    decimalTypes: decimalTypes[effectiveType],
    booleanTypes: booleanTypes[effectiveType],
    enumTypes: enumTypes[effectiveType]
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
const hasIgnoreDirective = (comment) => {
  return comment.includes("@ignore");
};
const hasTableIgnoreDirective = (comment) => {
  return comment.includes("@@ignore");
};

function getType(op, desc, config, destination, entityName) {
  const { Default, Extra, Null, Type, DataType, Comment, EnumOptions } = desc;
  const schemaType = config.origin.type;
  const type = schemaType === "prisma" ? Type : Type.toLowerCase();
  let dataType = DataType ? schemaType === "prisma" ? DataType : DataType.toLowerCase() : type;
  const isMySQL = schemaType === "mysql" || schemaType === "sql" && config.origin.dialect === "mysql";
  const tinyIntAsBoolean = isMySQL && config.origin.tinyIntAsBoolean !== false;
  const isTinyInt1 = isMySQL && dataType === "tinyint" && Type.toLowerCase().includes("(1)");
  if (tinyIntAsBoolean && isTinyInt1) {
    dataType = "boolean";
  }
  const isNull = Null === "YES";
  const hasDefaultValue = Default !== null;
  const isGenerated = Extra.toLowerCase().includes("auto_increment") || Extra.toLowerCase().includes("default_generated");
  const isTsDestination = destination.type === "ts";
  const isKyselyDestination = destination.type === "kysely";
  const isZodDestination = destination.type === "zod";
  const dialect = schemaType === "sql" ? config.origin.dialect : void 0;
  const typeMappings = getTypeMappings(schemaType, dialect);
  const destKey = isZodDestination ? "zod" : isTsDestination ? "ts" : "kysely";
  if (entityName && config.overrideColumns) {
    const destOverrides = config.overrideColumns[destKey];
    if (destOverrides && destOverrides[entityName] && destOverrides[entityName][desc.Field]) {
      const columnOverride = destOverrides[entityName][desc.Field];
      const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
      if (isZodDestination) {
        const nullishOption = destination.nullish;
        const nullableMethod = nullishOption && op !== "selectable" ? "nullish" : "nullable";
        return shouldBeNullable ? `${columnOverride}.${nullableMethod}()` : columnOverride;
      } else {
        return shouldBeNullable ? `${columnOverride} | null` : columnOverride;
      }
    }
  }
  if (isZodDestination && config.magicComments) {
    const zodOverrideType = extractZodExpression(Comment);
    if (zodOverrideType) {
      return zodOverrideType;
    }
  }
  if (isTsDestination && config.magicComments) {
    const tsOverrideType = extractTSExpression(Comment);
    if (tsOverrideType) {
      return tsOverrideType;
    }
  }
  if (isKyselyDestination && config.magicComments) {
    const kyselyOverrideType = extractKyselyExpression(Comment);
    if (kyselyOverrideType) {
      return kyselyOverrideType;
    }
    const tsOverrideType = extractTSExpression(Comment);
    if (tsOverrideType) {
      return tsOverrideType;
    }
  }
  const overrideType = config.overrideTypes?.[destKey]?.[Type];
  if (overrideType) {
    const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
    if (isZodDestination) {
      const nullishOption = destination.nullish;
      const nullableMethod = nullishOption && op !== "selectable" ? "nullish" : "nullable";
      return shouldBeNullable ? `${overrideType}.${nullableMethod}()` : overrideType;
    } else {
      return shouldBeNullable ? `${overrideType} | null` : overrideType;
    }
  }
  if (isTsDestination || isKyselyDestination) {
    const isJsonField = isJsonType(dataType);
    if (isKyselyDestination && isJsonField) {
      const shouldBeNullable = isNull || ["insertable", "updateable"].includes(op) && (hasDefaultValue || isGenerated) || op === "updateable" && !isNull && !hasDefaultValue;
      return shouldBeNullable ? "Json | null" : "Json";
    }
  }
  const enumTypesForSchema = typeMappings.enumTypes || [];
  const isEnum = enumTypesForSchema.includes(dataType);
  const isPrismaEnum = schemaType === "prisma" && config.enumDeclarations && config.enumDeclarations[type];
  if (isEnum || isPrismaEnum) {
    let enumValues = [];
    const isMySQLEnum = (schemaType === "mysql" || schemaType === "sql" && dialect === "mysql") && dataType === "enum";
    if (isMySQLEnum) {
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
        const nullableMethod = nullishOption && op !== "selectable" ? "nullish" : "nullable";
        if ((op === "table" || op === "insertable" || op === "updateable") && hasDefaultValue && Default !== null && !isGenerated) {
          if (shouldBeNullable && shouldBeOptional) {
            return `${enumString}.${nullableMethod}().default('${Default}')`;
          } else if (shouldBeNullable) {
            return `${enumString}.${nullableMethod}().default('${Default}')`;
          } else if (shouldBeOptional) {
            return `${enumString}.optional().default('${Default}')`;
          } else {
            return `${enumString}.default('${Default}')`;
          }
        }
        if (shouldBeNullable && shouldBeOptional) {
          return `${enumString}.${nullableMethod}()`;
        } else if (shouldBeNullable) {
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
  return generateStandardType(op, desc, config, destination, typeMappings, dataType);
}
function generateStandardType(op, desc, config, destination, typeMappings, dataType) {
  const { Default, Extra, Null, Type } = desc;
  const schemaType = config.origin.type;
  schemaType === "prisma" ? Type : Type.toLowerCase();
  const isNull = Null === "YES";
  const hasDefaultValue = Default !== null;
  const isGenerated = Extra.toLowerCase().includes("auto_increment") || Extra.toLowerCase().includes("default_generated");
  const isZodDestination = destination.type === "zod";
  const isKyselyDestination = destination.type === "kysely";
  const shouldBeNullable = isNull;
  const shouldBeOptional = op === "insertable" && (hasDefaultValue || isGenerated) || op === "updateable";
  let baseType;
  if (typeMappings.dateTypes.includes(dataType)) {
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
  } else if (typeMappings.bigIntTypes.includes(dataType)) {
    if (isZodDestination) {
      baseType = "z.string()";
    } else if (isKyselyDestination) {
      baseType = "BigInt";
    } else {
      baseType = "string";
    }
  } else if (typeMappings.decimalTypes.includes(dataType)) {
    if (isZodDestination) {
      baseType = "z.string()";
      if (op !== "selectable") {
        baseType += ".trim()";
        if (!hasDefaultValue && !shouldBeNullable) {
          baseType += ".min(1)";
        }
      }
    } else if (isKyselyDestination) {
      baseType = "Decimal";
    } else {
      baseType = "string";
    }
  } else if (typeMappings.numberTypes.includes(dataType)) {
    if (isZodDestination) {
      baseType = "z.number()";
    } else {
      baseType = "number";
    }
  } else if (typeMappings.booleanTypes.includes(dataType)) {
    if (isZodDestination) {
      const useBooleanType = destination.useBooleanType;
      if (useBooleanType) {
        baseType = "z.union([z.number(), z.string(), z.boolean()]).pipe(z.coerce.boolean())";
      } else {
        baseType = "z.boolean()";
      }
    } else {
      baseType = "boolean";
    }
  } else if (typeMappings.stringTypes.includes(dataType)) {
    if (isZodDestination) {
      const useTrim = destination.useTrim;
      const requiredString = destination.requiredString;
      baseType = "z.string()";
      if (useTrim && op !== "selectable") baseType += ".trim()";
      if (requiredString && !shouldBeNullable && op !== "selectable" && !hasDefaultValue) baseType += ".min(1)";
    } else {
      baseType = "string";
    }
  } else {
    baseType = isZodDestination ? "z.string()" : "string";
  }
  if (isZodDestination) {
    const nullishOption = destination.nullish;
    const nullableMethod = nullishOption && op !== "selectable" ? "nullish" : "nullable";
    if ((op === "table" || op === "insertable" || op === "updateable") && hasDefaultValue && Default !== null && !isGenerated) {
      let defaultValueFormatted = Default;
      if (typeMappings.stringTypes.includes(dataType) || typeMappings.dateTypes.includes(dataType)) {
        defaultValueFormatted = `'${Default}'`;
      } else if (typeMappings.booleanTypes.includes(dataType)) {
        defaultValueFormatted = Default.toLowerCase() === "true" ? "true" : "false";
      } else if (typeMappings.numberTypes.includes(dataType)) {
        defaultValueFormatted = Default;
      } else {
        defaultValueFormatted = `'${Default}'`;
      }
      if (shouldBeNullable && shouldBeOptional) {
        return `${baseType}.${nullableMethod}().default(${defaultValueFormatted})`;
      } else if (shouldBeNullable) {
        return `${baseType}.${nullableMethod}().default(${defaultValueFormatted})`;
      } else if (shouldBeOptional) {
        return `${baseType}.optional().default(${defaultValueFormatted})`;
      } else {
        return `${baseType}.default(${defaultValueFormatted})`;
      }
    }
    const isDateField = typeMappings.dateTypes.includes(dataType);
    const shouldDateBeOptional = isDateField && (hasDefaultValue || isGenerated) && (op === "table" || op === "selectable");
    const isIdField = typeMappings.numberTypes.includes(dataType) || typeMappings.bigIntTypes.includes(dataType) || typeMappings.stringTypes.includes(dataType);
    const shouldIdBeOptional = isIdField && isGenerated && (op === "table" || op === "selectable");
    if (shouldBeNullable && shouldBeOptional) {
      return `${baseType}.${nullableMethod}()`;
    } else if (shouldBeNullable) {
      if (shouldDateBeOptional || shouldIdBeOptional) {
        return `${baseType}.${nullableMethod}().optional()`;
      }
      return `${baseType}.${nullableMethod}()`;
    } else if (shouldBeOptional) {
      return `${baseType}.optional()`;
    } else if (shouldDateBeOptional || shouldIdBeOptional) {
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

function isAutoGeneratedDateTimeField(desc, schemaType) {
  const { Type, Extra } = desc;
  const type = schemaType === "prisma" ? Type : Type.toLowerCase();
  const typeMappings = getTypeMappings(schemaType);
  const isDateField = typeMappings.dateTypes.includes(type);
  if (!isDateField) {
    return false;
  }
  const isGenerated = Extra.toLowerCase().includes("auto_increment") || Extra.toLowerCase().includes("default_generated");
  return isGenerated;
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
  const inflectedView = applyInflection(view, config.inflection);
  if (destination.type === "kysely") {
    const pascalView = camelCase(inflectedView, { pascalCase: true });
    content += `// Kysely type definitions for ${view} (view)

`;
    content += `// This interface defines the structure of the '${view}' view (read-only)
`;
    content += `export interface ${pascalView}View {
`;
    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const fieldType = getType("selectable", desc, config, destination, view);
      content += `  ${fieldName}: ${fieldType};
`;
    }
    content += "}\n\n";
    content += `// Helper types for ${view} (view - read-only)
`;
    content += `export type Selectable${pascalView}View = Selectable<${pascalView}View>;
`;
  } else if (destination.type === "ts") {
    const pascalView = camelCase(inflectedView, { pascalCase: true });
    content += `// TypeScript interface for ${view} (view - read-only)
`;
    content += `export interface ${pascalView}View {
`;
    for (const desc of describes) {
      const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const fieldType = getType("selectable", desc, config, destination, view);
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
      const fieldType = getType("selectable", desc, config, destination, view);
      content += `  ${fieldName}: ${fieldType},
`;
    }
    content += "})\n\n";
    const pascalView = camelCase(inflectedView, { pascalCase: true });
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
  const inflectedTable = applyInflection(table, config.inflection);
  const pascalTable = camelCase(inflectedTable, { pascalCase: true });
  content += `// TypeScript interfaces for ${table}

`;
  content += `export interface ${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("table", desc, config, destination, table);
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n\n";
  content += `export interface Insertable${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("insertable", desc, config, destination, table);
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n\n";
  content += `export interface Updateable${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("updateable", desc, config, destination, table);
    content += `  ${fieldName}: ${fieldType};
`;
  }
  content += "}\n\n";
  content += `export interface Selectable${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("selectable", desc, config, destination, table);
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
  const inflectedTable = applyInflection(table, config.inflection);
  const pascalTable = camelCase(inflectedTable, { pascalCase: true });
  content += `// Kysely type definitions for ${table}

`;
  content += `// This interface defines the structure of the '${table}' table
`;
  content += `export interface ${pascalTable} {
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    let fieldType = getType("table", desc, config, destination, table);
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
  const inflectedTable = applyInflection(table, config.inflection);
  content += `export const ${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("table", desc, config, destination, table);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  content += `export const insertable_${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const isAutoGeneratedDatetime = isAutoGeneratedDateTimeField(desc, config.origin.type);
    if (isAutoGeneratedDatetime) {
      continue;
    }
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("insertable", desc, config, destination, table);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  content += `export const updateable_${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const isAutoGeneratedDatetime = isAutoGeneratedDateTimeField(desc, config.origin.type);
    if (isAutoGeneratedDatetime) {
      continue;
    }
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("updateable", desc, config, destination, table);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  content += `export const selectable_${snakeTable} = z.object({
`;
  for (const desc of describes) {
    const fieldName = isCamelCase ? camelCase(desc.Field) : desc.Field;
    const fieldType = getType("selectable", desc, config, destination, table);
    content += `  ${fieldName}: ${fieldType},
`;
  }
  content += "})\n\n";
  const pascalInflectedTableType = camelCase(`${inflectedTable}Type`, { pascalCase: true });
  content += `export type ${pascalInflectedTableType} = z.infer<typeof ${snakeTable}>
`;
  content += `export type Insertable${pascalInflectedTableType} = z.infer<typeof insertable_${snakeTable}>
`;
  content += `export type Updateable${pascalInflectedTableType} = z.infer<typeof updateable_${snakeTable}>
`;
  content += `export type Selectable${pascalInflectedTableType} = z.infer<typeof selectable_${snakeTable}>
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
        SELECT table_name, table_comment
        FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'BASE TABLE'
      `, [origin.database]);
      return mysqlTables[0].filter((row) => !hasTableIgnoreDirective(row.TABLE_COMMENT || row.table_comment || "")).map((row) => row.TABLE_NAME || row.table_name).filter((name) => typeof name === "string" && name.length > 0);
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
        SELECT table_name, table_comment
        FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'VIEW'
      `, [origin.database]);
      return mysqlViews[0].filter((row) => !hasTableIgnoreDirective(row.TABLE_COMMENT || row.table_comment || "")).map((row) => row.TABLE_NAME || row.table_name).filter((name) => typeof name === "string" && name.length > 0);
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
          data_type as \`DataType\`,
          column_type as \`Type\`,
          column_comment as \`Comment\`
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `, [origin.database, tableName]);
      return mysqlColumns[0].filter((row) => !hasIgnoreDirective(row.Comment || "")).map((row) => ({
        Field: row.Field,
        Default: row.Default,
        Extra: row.Extra || "",
        Null: row.Null,
        DataType: row.DataType,
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
      return postgresColumns.rows.filter((row) => !hasIgnoreDirective(row.Comment || "")).map((row) => ({
        Field: row.Field,
        Default: row.Default,
        Extra: row.Extra || "",
        Null: row.Null,
        Type: row.Type,
        Comment: row.Comment || ""
      }));
    case "sqlite":
      const sqliteColumns = await db.raw(`PRAGMA table_info(${tableName})`);
      return sqliteColumns.filter((row) => !hasIgnoreDirective(row.Comment || "")).map((row) => ({
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

var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}

var api$3 = {};

var version = {};

var hasRequiredVersion;

function requireVersion () {
	if (hasRequiredVersion) return version;
	hasRequiredVersion = 1;
	Object.defineProperty(version, "__esModule", { value: true });
	version.VERSION = void 0;
	version.VERSION = "10.5.0";
	return version;
}

var parser = {};

var _isPrototype;
var hasRequired_isPrototype;

function require_isPrototype () {
	if (hasRequired_isPrototype) return _isPrototype;
	hasRequired_isPrototype = 1;
	var objectProto = Object.prototype;
	function isPrototype(value) {
	  var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto;
	  return value === proto;
	}
	_isPrototype = isPrototype;
	return _isPrototype;
}

var _overArg;
var hasRequired_overArg;

function require_overArg () {
	if (hasRequired_overArg) return _overArg;
	hasRequired_overArg = 1;
	function overArg(func, transform) {
	  return function(arg) {
	    return func(transform(arg));
	  };
	}
	_overArg = overArg;
	return _overArg;
}

var _nativeKeys;
var hasRequired_nativeKeys;

function require_nativeKeys () {
	if (hasRequired_nativeKeys) return _nativeKeys;
	hasRequired_nativeKeys = 1;
	var overArg = require_overArg();
	var nativeKeys = overArg(Object.keys, Object);
	_nativeKeys = nativeKeys;
	return _nativeKeys;
}

var _baseKeys;
var hasRequired_baseKeys;

function require_baseKeys () {
	if (hasRequired_baseKeys) return _baseKeys;
	hasRequired_baseKeys = 1;
	var isPrototype = require_isPrototype(), nativeKeys = require_nativeKeys();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function baseKeys(object) {
	  if (!isPrototype(object)) {
	    return nativeKeys(object);
	  }
	  var result = [];
	  for (var key in Object(object)) {
	    if (hasOwnProperty.call(object, key) && key != "constructor") {
	      result.push(key);
	    }
	  }
	  return result;
	}
	_baseKeys = baseKeys;
	return _baseKeys;
}

var _freeGlobal;
var hasRequired_freeGlobal;

function require_freeGlobal () {
	if (hasRequired_freeGlobal) return _freeGlobal;
	hasRequired_freeGlobal = 1;
	var freeGlobal = typeof commonjsGlobal == "object" && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;
	_freeGlobal = freeGlobal;
	return _freeGlobal;
}

var _root;
var hasRequired_root;

function require_root () {
	if (hasRequired_root) return _root;
	hasRequired_root = 1;
	var freeGlobal = require_freeGlobal();
	var freeSelf = typeof self == "object" && self && self.Object === Object && self;
	var root = freeGlobal || freeSelf || Function("return this")();
	_root = root;
	return _root;
}

var _Symbol;
var hasRequired_Symbol;

function require_Symbol () {
	if (hasRequired_Symbol) return _Symbol;
	hasRequired_Symbol = 1;
	var root = require_root();
	var Symbol = root.Symbol;
	_Symbol = Symbol;
	return _Symbol;
}

var _getRawTag;
var hasRequired_getRawTag;

function require_getRawTag () {
	if (hasRequired_getRawTag) return _getRawTag;
	hasRequired_getRawTag = 1;
	var Symbol = require_Symbol();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	var nativeObjectToString = objectProto.toString;
	var symToStringTag = Symbol ? Symbol.toStringTag : void 0;
	function getRawTag(value) {
	  var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
	  try {
	    value[symToStringTag] = void 0;
	    var unmasked = true;
	  } catch (e) {
	  }
	  var result = nativeObjectToString.call(value);
	  if (unmasked) {
	    if (isOwn) {
	      value[symToStringTag] = tag;
	    } else {
	      delete value[symToStringTag];
	    }
	  }
	  return result;
	}
	_getRawTag = getRawTag;
	return _getRawTag;
}

var _objectToString;
var hasRequired_objectToString;

function require_objectToString () {
	if (hasRequired_objectToString) return _objectToString;
	hasRequired_objectToString = 1;
	var objectProto = Object.prototype;
	var nativeObjectToString = objectProto.toString;
	function objectToString(value) {
	  return nativeObjectToString.call(value);
	}
	_objectToString = objectToString;
	return _objectToString;
}

var _baseGetTag;
var hasRequired_baseGetTag;

function require_baseGetTag () {
	if (hasRequired_baseGetTag) return _baseGetTag;
	hasRequired_baseGetTag = 1;
	var Symbol = require_Symbol(), getRawTag = require_getRawTag(), objectToString = require_objectToString();
	var nullTag = "[object Null]", undefinedTag = "[object Undefined]";
	var symToStringTag = Symbol ? Symbol.toStringTag : void 0;
	function baseGetTag(value) {
	  if (value == null) {
	    return value === void 0 ? undefinedTag : nullTag;
	  }
	  return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
	}
	_baseGetTag = baseGetTag;
	return _baseGetTag;
}

var isObject_1;
var hasRequiredIsObject;

function requireIsObject () {
	if (hasRequiredIsObject) return isObject_1;
	hasRequiredIsObject = 1;
	function isObject(value) {
	  var type = typeof value;
	  return value != null && (type == "object" || type == "function");
	}
	isObject_1 = isObject;
	return isObject_1;
}

var isFunction_1;
var hasRequiredIsFunction;

function requireIsFunction () {
	if (hasRequiredIsFunction) return isFunction_1;
	hasRequiredIsFunction = 1;
	var baseGetTag = require_baseGetTag(), isObject = requireIsObject();
	var asyncTag = "[object AsyncFunction]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", proxyTag = "[object Proxy]";
	function isFunction(value) {
	  if (!isObject(value)) {
	    return false;
	  }
	  var tag = baseGetTag(value);
	  return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
	}
	isFunction_1 = isFunction;
	return isFunction_1;
}

var _coreJsData;
var hasRequired_coreJsData;

function require_coreJsData () {
	if (hasRequired_coreJsData) return _coreJsData;
	hasRequired_coreJsData = 1;
	var root = require_root();
	var coreJsData = root["__core-js_shared__"];
	_coreJsData = coreJsData;
	return _coreJsData;
}

var _isMasked;
var hasRequired_isMasked;

function require_isMasked () {
	if (hasRequired_isMasked) return _isMasked;
	hasRequired_isMasked = 1;
	var coreJsData = require_coreJsData();
	var maskSrcKey = (function() {
	  var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
	  return uid ? "Symbol(src)_1." + uid : "";
	})();
	function isMasked(func) {
	  return !!maskSrcKey && maskSrcKey in func;
	}
	_isMasked = isMasked;
	return _isMasked;
}

var _toSource;
var hasRequired_toSource;

function require_toSource () {
	if (hasRequired_toSource) return _toSource;
	hasRequired_toSource = 1;
	var funcProto = Function.prototype;
	var funcToString = funcProto.toString;
	function toSource(func) {
	  if (func != null) {
	    try {
	      return funcToString.call(func);
	    } catch (e) {
	    }
	    try {
	      return func + "";
	    } catch (e) {
	    }
	  }
	  return "";
	}
	_toSource = toSource;
	return _toSource;
}

var _baseIsNative;
var hasRequired_baseIsNative;

function require_baseIsNative () {
	if (hasRequired_baseIsNative) return _baseIsNative;
	hasRequired_baseIsNative = 1;
	var isFunction = requireIsFunction(), isMasked = require_isMasked(), isObject = requireIsObject(), toSource = require_toSource();
	var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
	var reIsHostCtor = /^\[object .+?Constructor\]$/;
	var funcProto = Function.prototype, objectProto = Object.prototype;
	var funcToString = funcProto.toString;
	var hasOwnProperty = objectProto.hasOwnProperty;
	var reIsNative = RegExp(
	  "^" + funcToString.call(hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
	);
	function baseIsNative(value) {
	  if (!isObject(value) || isMasked(value)) {
	    return false;
	  }
	  var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
	  return pattern.test(toSource(value));
	}
	_baseIsNative = baseIsNative;
	return _baseIsNative;
}

var _getValue;
var hasRequired_getValue;

function require_getValue () {
	if (hasRequired_getValue) return _getValue;
	hasRequired_getValue = 1;
	function getValue(object, key) {
	  return object == null ? void 0 : object[key];
	}
	_getValue = getValue;
	return _getValue;
}

var _getNative;
var hasRequired_getNative;

function require_getNative () {
	if (hasRequired_getNative) return _getNative;
	hasRequired_getNative = 1;
	var baseIsNative = require_baseIsNative(), getValue = require_getValue();
	function getNative(object, key) {
	  var value = getValue(object, key);
	  return baseIsNative(value) ? value : void 0;
	}
	_getNative = getNative;
	return _getNative;
}

var _DataView;
var hasRequired_DataView;

function require_DataView () {
	if (hasRequired_DataView) return _DataView;
	hasRequired_DataView = 1;
	var getNative = require_getNative(), root = require_root();
	var DataView = getNative(root, "DataView");
	_DataView = DataView;
	return _DataView;
}

var _Map;
var hasRequired_Map;

function require_Map () {
	if (hasRequired_Map) return _Map;
	hasRequired_Map = 1;
	var getNative = require_getNative(), root = require_root();
	var Map = getNative(root, "Map");
	_Map = Map;
	return _Map;
}

var _Promise;
var hasRequired_Promise;

function require_Promise () {
	if (hasRequired_Promise) return _Promise;
	hasRequired_Promise = 1;
	var getNative = require_getNative(), root = require_root();
	var Promise = getNative(root, "Promise");
	_Promise = Promise;
	return _Promise;
}

var _Set;
var hasRequired_Set;

function require_Set () {
	if (hasRequired_Set) return _Set;
	hasRequired_Set = 1;
	var getNative = require_getNative(), root = require_root();
	var Set = getNative(root, "Set");
	_Set = Set;
	return _Set;
}

var _WeakMap;
var hasRequired_WeakMap;

function require_WeakMap () {
	if (hasRequired_WeakMap) return _WeakMap;
	hasRequired_WeakMap = 1;
	var getNative = require_getNative(), root = require_root();
	var WeakMap = getNative(root, "WeakMap");
	_WeakMap = WeakMap;
	return _WeakMap;
}

var _getTag;
var hasRequired_getTag;

function require_getTag () {
	if (hasRequired_getTag) return _getTag;
	hasRequired_getTag = 1;
	var DataView = require_DataView(), Map = require_Map(), Promise = require_Promise(), Set = require_Set(), WeakMap = require_WeakMap(), baseGetTag = require_baseGetTag(), toSource = require_toSource();
	var mapTag = "[object Map]", objectTag = "[object Object]", promiseTag = "[object Promise]", setTag = "[object Set]", weakMapTag = "[object WeakMap]";
	var dataViewTag = "[object DataView]";
	var dataViewCtorString = toSource(DataView), mapCtorString = toSource(Map), promiseCtorString = toSource(Promise), setCtorString = toSource(Set), weakMapCtorString = toSource(WeakMap);
	var getTag = baseGetTag;
	if (DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag || Map && getTag(new Map()) != mapTag || Promise && getTag(Promise.resolve()) != promiseTag || Set && getTag(new Set()) != setTag || WeakMap && getTag(new WeakMap()) != weakMapTag) {
	  getTag = function(value) {
	    var result = baseGetTag(value), Ctor = result == objectTag ? value.constructor : void 0, ctorString = Ctor ? toSource(Ctor) : "";
	    if (ctorString) {
	      switch (ctorString) {
	        case dataViewCtorString:
	          return dataViewTag;
	        case mapCtorString:
	          return mapTag;
	        case promiseCtorString:
	          return promiseTag;
	        case setCtorString:
	          return setTag;
	        case weakMapCtorString:
	          return weakMapTag;
	      }
	    }
	    return result;
	  };
	}
	_getTag = getTag;
	return _getTag;
}

var isObjectLike_1;
var hasRequiredIsObjectLike;

function requireIsObjectLike () {
	if (hasRequiredIsObjectLike) return isObjectLike_1;
	hasRequiredIsObjectLike = 1;
	function isObjectLike(value) {
	  return value != null && typeof value == "object";
	}
	isObjectLike_1 = isObjectLike;
	return isObjectLike_1;
}

var _baseIsArguments;
var hasRequired_baseIsArguments;

function require_baseIsArguments () {
	if (hasRequired_baseIsArguments) return _baseIsArguments;
	hasRequired_baseIsArguments = 1;
	var baseGetTag = require_baseGetTag(), isObjectLike = requireIsObjectLike();
	var argsTag = "[object Arguments]";
	function baseIsArguments(value) {
	  return isObjectLike(value) && baseGetTag(value) == argsTag;
	}
	_baseIsArguments = baseIsArguments;
	return _baseIsArguments;
}

var isArguments_1;
var hasRequiredIsArguments;

function requireIsArguments () {
	if (hasRequiredIsArguments) return isArguments_1;
	hasRequiredIsArguments = 1;
	var baseIsArguments = require_baseIsArguments(), isObjectLike = requireIsObjectLike();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	var propertyIsEnumerable = objectProto.propertyIsEnumerable;
	var isArguments = baseIsArguments(/* @__PURE__ */ (function() {
	  return arguments;
	})()) ? baseIsArguments : function(value) {
	  return isObjectLike(value) && hasOwnProperty.call(value, "callee") && !propertyIsEnumerable.call(value, "callee");
	};
	isArguments_1 = isArguments;
	return isArguments_1;
}

var isArray_1;
var hasRequiredIsArray;

function requireIsArray () {
	if (hasRequiredIsArray) return isArray_1;
	hasRequiredIsArray = 1;
	var isArray = Array.isArray;
	isArray_1 = isArray;
	return isArray_1;
}

var isLength_1;
var hasRequiredIsLength;

function requireIsLength () {
	if (hasRequiredIsLength) return isLength_1;
	hasRequiredIsLength = 1;
	var MAX_SAFE_INTEGER = 9007199254740991;
	function isLength(value) {
	  return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
	}
	isLength_1 = isLength;
	return isLength_1;
}

var isArrayLike_1;
var hasRequiredIsArrayLike;

function requireIsArrayLike () {
	if (hasRequiredIsArrayLike) return isArrayLike_1;
	hasRequiredIsArrayLike = 1;
	var isFunction = requireIsFunction(), isLength = requireIsLength();
	function isArrayLike(value) {
	  return value != null && isLength(value.length) && !isFunction(value);
	}
	isArrayLike_1 = isArrayLike;
	return isArrayLike_1;
}

var isBuffer = {exports: {}};

var stubFalse_1;
var hasRequiredStubFalse;

function requireStubFalse () {
	if (hasRequiredStubFalse) return stubFalse_1;
	hasRequiredStubFalse = 1;
	function stubFalse() {
	  return false;
	}
	stubFalse_1 = stubFalse;
	return stubFalse_1;
}

isBuffer.exports;

var hasRequiredIsBuffer;

function requireIsBuffer () {
	if (hasRequiredIsBuffer) return isBuffer.exports;
	hasRequiredIsBuffer = 1;
	(function (module, exports$1) {
		var root = require_root(), stubFalse = requireStubFalse();
		var freeExports = exports$1 && !exports$1.nodeType && exports$1;
		var freeModule = freeExports && 'object' == "object" && module && !module.nodeType && module;
		var moduleExports = freeModule && freeModule.exports === freeExports;
		var Buffer = moduleExports ? root.Buffer : void 0;
		var nativeIsBuffer = Buffer ? Buffer.isBuffer : void 0;
		var isBuffer = nativeIsBuffer || stubFalse;
		module.exports = isBuffer; 
	} (isBuffer, isBuffer.exports));
	return isBuffer.exports;
}

var _baseIsTypedArray;
var hasRequired_baseIsTypedArray;

function require_baseIsTypedArray () {
	if (hasRequired_baseIsTypedArray) return _baseIsTypedArray;
	hasRequired_baseIsTypedArray = 1;
	var baseGetTag = require_baseGetTag(), isLength = requireIsLength(), isObjectLike = requireIsObjectLike();
	var argsTag = "[object Arguments]", arrayTag = "[object Array]", boolTag = "[object Boolean]", dateTag = "[object Date]", errorTag = "[object Error]", funcTag = "[object Function]", mapTag = "[object Map]", numberTag = "[object Number]", objectTag = "[object Object]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", weakMapTag = "[object WeakMap]";
	var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
	var typedArrayTags = {};
	typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
	typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
	function baseIsTypedArray(value) {
	  return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
	}
	_baseIsTypedArray = baseIsTypedArray;
	return _baseIsTypedArray;
}

var _baseUnary;
var hasRequired_baseUnary;

function require_baseUnary () {
	if (hasRequired_baseUnary) return _baseUnary;
	hasRequired_baseUnary = 1;
	function baseUnary(func) {
	  return function(value) {
	    return func(value);
	  };
	}
	_baseUnary = baseUnary;
	return _baseUnary;
}

var _nodeUtil = {exports: {}};

_nodeUtil.exports;

var hasRequired_nodeUtil;

function require_nodeUtil () {
	if (hasRequired_nodeUtil) return _nodeUtil.exports;
	hasRequired_nodeUtil = 1;
	(function (module, exports$1) {
		var freeGlobal = require_freeGlobal();
		var freeExports = exports$1 && !exports$1.nodeType && exports$1;
		var freeModule = freeExports && 'object' == "object" && module && !module.nodeType && module;
		var moduleExports = freeModule && freeModule.exports === freeExports;
		var freeProcess = moduleExports && freeGlobal.process;
		var nodeUtil = (function() {
		  try {
		    var types = freeModule && freeModule.require && freeModule.require("util").types;
		    if (types) {
		      return types;
		    }
		    return freeProcess && freeProcess.binding && freeProcess.binding("util");
		  } catch (e) {
		  }
		})();
		module.exports = nodeUtil; 
	} (_nodeUtil, _nodeUtil.exports));
	return _nodeUtil.exports;
}

var isTypedArray_1;
var hasRequiredIsTypedArray;

function requireIsTypedArray () {
	if (hasRequiredIsTypedArray) return isTypedArray_1;
	hasRequiredIsTypedArray = 1;
	var baseIsTypedArray = require_baseIsTypedArray(), baseUnary = require_baseUnary(), nodeUtil = require_nodeUtil();
	var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
	var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
	isTypedArray_1 = isTypedArray;
	return isTypedArray_1;
}

var isEmpty_1;
var hasRequiredIsEmpty;

function requireIsEmpty () {
	if (hasRequiredIsEmpty) return isEmpty_1;
	hasRequiredIsEmpty = 1;
	var baseKeys = require_baseKeys(), getTag = require_getTag(), isArguments = requireIsArguments(), isArray = requireIsArray(), isArrayLike = requireIsArrayLike(), isBuffer = requireIsBuffer(), isPrototype = require_isPrototype(), isTypedArray = requireIsTypedArray();
	var mapTag = "[object Map]", setTag = "[object Set]";
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function isEmpty(value) {
	  if (value == null) {
	    return true;
	  }
	  if (isArrayLike(value) && (isArray(value) || typeof value == "string" || typeof value.splice == "function" || isBuffer(value) || isTypedArray(value) || isArguments(value))) {
	    return !value.length;
	  }
	  var tag = getTag(value);
	  if (tag == mapTag || tag == setTag) {
	    return !value.size;
	  }
	  if (isPrototype(value)) {
	    return !baseKeys(value).length;
	  }
	  for (var key in value) {
	    if (hasOwnProperty.call(value, key)) {
	      return false;
	    }
	  }
	  return true;
	}
	isEmpty_1 = isEmpty;
	return isEmpty_1;
}

var _arrayMap;
var hasRequired_arrayMap;

function require_arrayMap () {
	if (hasRequired_arrayMap) return _arrayMap;
	hasRequired_arrayMap = 1;
	function arrayMap(array, iteratee) {
	  var index = -1, length = array == null ? 0 : array.length, result = Array(length);
	  while (++index < length) {
	    result[index] = iteratee(array[index], index, array);
	  }
	  return result;
	}
	_arrayMap = arrayMap;
	return _arrayMap;
}

var _listCacheClear;
var hasRequired_listCacheClear;

function require_listCacheClear () {
	if (hasRequired_listCacheClear) return _listCacheClear;
	hasRequired_listCacheClear = 1;
	function listCacheClear() {
	  this.__data__ = [];
	  this.size = 0;
	}
	_listCacheClear = listCacheClear;
	return _listCacheClear;
}

var eq_1;
var hasRequiredEq;

function requireEq () {
	if (hasRequiredEq) return eq_1;
	hasRequiredEq = 1;
	function eq(value, other) {
	  return value === other || value !== value && other !== other;
	}
	eq_1 = eq;
	return eq_1;
}

var _assocIndexOf;
var hasRequired_assocIndexOf;

function require_assocIndexOf () {
	if (hasRequired_assocIndexOf) return _assocIndexOf;
	hasRequired_assocIndexOf = 1;
	var eq = requireEq();
	function assocIndexOf(array, key) {
	  var length = array.length;
	  while (length--) {
	    if (eq(array[length][0], key)) {
	      return length;
	    }
	  }
	  return -1;
	}
	_assocIndexOf = assocIndexOf;
	return _assocIndexOf;
}

var _listCacheDelete;
var hasRequired_listCacheDelete;

function require_listCacheDelete () {
	if (hasRequired_listCacheDelete) return _listCacheDelete;
	hasRequired_listCacheDelete = 1;
	var assocIndexOf = require_assocIndexOf();
	var arrayProto = Array.prototype;
	var splice = arrayProto.splice;
	function listCacheDelete(key) {
	  var data = this.__data__, index = assocIndexOf(data, key);
	  if (index < 0) {
	    return false;
	  }
	  var lastIndex = data.length - 1;
	  if (index == lastIndex) {
	    data.pop();
	  } else {
	    splice.call(data, index, 1);
	  }
	  --this.size;
	  return true;
	}
	_listCacheDelete = listCacheDelete;
	return _listCacheDelete;
}

var _listCacheGet;
var hasRequired_listCacheGet;

function require_listCacheGet () {
	if (hasRequired_listCacheGet) return _listCacheGet;
	hasRequired_listCacheGet = 1;
	var assocIndexOf = require_assocIndexOf();
	function listCacheGet(key) {
	  var data = this.__data__, index = assocIndexOf(data, key);
	  return index < 0 ? void 0 : data[index][1];
	}
	_listCacheGet = listCacheGet;
	return _listCacheGet;
}

var _listCacheHas;
var hasRequired_listCacheHas;

function require_listCacheHas () {
	if (hasRequired_listCacheHas) return _listCacheHas;
	hasRequired_listCacheHas = 1;
	var assocIndexOf = require_assocIndexOf();
	function listCacheHas(key) {
	  return assocIndexOf(this.__data__, key) > -1;
	}
	_listCacheHas = listCacheHas;
	return _listCacheHas;
}

var _listCacheSet;
var hasRequired_listCacheSet;

function require_listCacheSet () {
	if (hasRequired_listCacheSet) return _listCacheSet;
	hasRequired_listCacheSet = 1;
	var assocIndexOf = require_assocIndexOf();
	function listCacheSet(key, value) {
	  var data = this.__data__, index = assocIndexOf(data, key);
	  if (index < 0) {
	    ++this.size;
	    data.push([key, value]);
	  } else {
	    data[index][1] = value;
	  }
	  return this;
	}
	_listCacheSet = listCacheSet;
	return _listCacheSet;
}

var _ListCache;
var hasRequired_ListCache;

function require_ListCache () {
	if (hasRequired_ListCache) return _ListCache;
	hasRequired_ListCache = 1;
	var listCacheClear = require_listCacheClear(), listCacheDelete = require_listCacheDelete(), listCacheGet = require_listCacheGet(), listCacheHas = require_listCacheHas(), listCacheSet = require_listCacheSet();
	function ListCache(entries) {
	  var index = -1, length = entries == null ? 0 : entries.length;
	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}
	ListCache.prototype.clear = listCacheClear;
	ListCache.prototype["delete"] = listCacheDelete;
	ListCache.prototype.get = listCacheGet;
	ListCache.prototype.has = listCacheHas;
	ListCache.prototype.set = listCacheSet;
	_ListCache = ListCache;
	return _ListCache;
}

var _stackClear;
var hasRequired_stackClear;

function require_stackClear () {
	if (hasRequired_stackClear) return _stackClear;
	hasRequired_stackClear = 1;
	var ListCache = require_ListCache();
	function stackClear() {
	  this.__data__ = new ListCache();
	  this.size = 0;
	}
	_stackClear = stackClear;
	return _stackClear;
}

var _stackDelete;
var hasRequired_stackDelete;

function require_stackDelete () {
	if (hasRequired_stackDelete) return _stackDelete;
	hasRequired_stackDelete = 1;
	function stackDelete(key) {
	  var data = this.__data__, result = data["delete"](key);
	  this.size = data.size;
	  return result;
	}
	_stackDelete = stackDelete;
	return _stackDelete;
}

var _stackGet;
var hasRequired_stackGet;

function require_stackGet () {
	if (hasRequired_stackGet) return _stackGet;
	hasRequired_stackGet = 1;
	function stackGet(key) {
	  return this.__data__.get(key);
	}
	_stackGet = stackGet;
	return _stackGet;
}

var _stackHas;
var hasRequired_stackHas;

function require_stackHas () {
	if (hasRequired_stackHas) return _stackHas;
	hasRequired_stackHas = 1;
	function stackHas(key) {
	  return this.__data__.has(key);
	}
	_stackHas = stackHas;
	return _stackHas;
}

var _nativeCreate;
var hasRequired_nativeCreate;

function require_nativeCreate () {
	if (hasRequired_nativeCreate) return _nativeCreate;
	hasRequired_nativeCreate = 1;
	var getNative = require_getNative();
	var nativeCreate = getNative(Object, "create");
	_nativeCreate = nativeCreate;
	return _nativeCreate;
}

var _hashClear;
var hasRequired_hashClear;

function require_hashClear () {
	if (hasRequired_hashClear) return _hashClear;
	hasRequired_hashClear = 1;
	var nativeCreate = require_nativeCreate();
	function hashClear() {
	  this.__data__ = nativeCreate ? nativeCreate(null) : {};
	  this.size = 0;
	}
	_hashClear = hashClear;
	return _hashClear;
}

var _hashDelete;
var hasRequired_hashDelete;

function require_hashDelete () {
	if (hasRequired_hashDelete) return _hashDelete;
	hasRequired_hashDelete = 1;
	function hashDelete(key) {
	  var result = this.has(key) && delete this.__data__[key];
	  this.size -= result ? 1 : 0;
	  return result;
	}
	_hashDelete = hashDelete;
	return _hashDelete;
}

var _hashGet;
var hasRequired_hashGet;

function require_hashGet () {
	if (hasRequired_hashGet) return _hashGet;
	hasRequired_hashGet = 1;
	var nativeCreate = require_nativeCreate();
	var HASH_UNDEFINED = "__lodash_hash_undefined__";
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function hashGet(key) {
	  var data = this.__data__;
	  if (nativeCreate) {
	    var result = data[key];
	    return result === HASH_UNDEFINED ? void 0 : result;
	  }
	  return hasOwnProperty.call(data, key) ? data[key] : void 0;
	}
	_hashGet = hashGet;
	return _hashGet;
}

var _hashHas;
var hasRequired_hashHas;

function require_hashHas () {
	if (hasRequired_hashHas) return _hashHas;
	hasRequired_hashHas = 1;
	var nativeCreate = require_nativeCreate();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function hashHas(key) {
	  var data = this.__data__;
	  return nativeCreate ? data[key] !== void 0 : hasOwnProperty.call(data, key);
	}
	_hashHas = hashHas;
	return _hashHas;
}

var _hashSet;
var hasRequired_hashSet;

function require_hashSet () {
	if (hasRequired_hashSet) return _hashSet;
	hasRequired_hashSet = 1;
	var nativeCreate = require_nativeCreate();
	var HASH_UNDEFINED = "__lodash_hash_undefined__";
	function hashSet(key, value) {
	  var data = this.__data__;
	  this.size += this.has(key) ? 0 : 1;
	  data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
	  return this;
	}
	_hashSet = hashSet;
	return _hashSet;
}

var _Hash;
var hasRequired_Hash;

function require_Hash () {
	if (hasRequired_Hash) return _Hash;
	hasRequired_Hash = 1;
	var hashClear = require_hashClear(), hashDelete = require_hashDelete(), hashGet = require_hashGet(), hashHas = require_hashHas(), hashSet = require_hashSet();
	function Hash(entries) {
	  var index = -1, length = entries == null ? 0 : entries.length;
	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}
	Hash.prototype.clear = hashClear;
	Hash.prototype["delete"] = hashDelete;
	Hash.prototype.get = hashGet;
	Hash.prototype.has = hashHas;
	Hash.prototype.set = hashSet;
	_Hash = Hash;
	return _Hash;
}

var _mapCacheClear;
var hasRequired_mapCacheClear;

function require_mapCacheClear () {
	if (hasRequired_mapCacheClear) return _mapCacheClear;
	hasRequired_mapCacheClear = 1;
	var Hash = require_Hash(), ListCache = require_ListCache(), Map = require_Map();
	function mapCacheClear() {
	  this.size = 0;
	  this.__data__ = {
	    "hash": new Hash(),
	    "map": new (Map || ListCache)(),
	    "string": new Hash()
	  };
	}
	_mapCacheClear = mapCacheClear;
	return _mapCacheClear;
}

var _isKeyable;
var hasRequired_isKeyable;

function require_isKeyable () {
	if (hasRequired_isKeyable) return _isKeyable;
	hasRequired_isKeyable = 1;
	function isKeyable(value) {
	  var type = typeof value;
	  return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
	}
	_isKeyable = isKeyable;
	return _isKeyable;
}

var _getMapData;
var hasRequired_getMapData;

function require_getMapData () {
	if (hasRequired_getMapData) return _getMapData;
	hasRequired_getMapData = 1;
	var isKeyable = require_isKeyable();
	function getMapData(map, key) {
	  var data = map.__data__;
	  return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
	}
	_getMapData = getMapData;
	return _getMapData;
}

var _mapCacheDelete;
var hasRequired_mapCacheDelete;

function require_mapCacheDelete () {
	if (hasRequired_mapCacheDelete) return _mapCacheDelete;
	hasRequired_mapCacheDelete = 1;
	var getMapData = require_getMapData();
	function mapCacheDelete(key) {
	  var result = getMapData(this, key)["delete"](key);
	  this.size -= result ? 1 : 0;
	  return result;
	}
	_mapCacheDelete = mapCacheDelete;
	return _mapCacheDelete;
}

var _mapCacheGet;
var hasRequired_mapCacheGet;

function require_mapCacheGet () {
	if (hasRequired_mapCacheGet) return _mapCacheGet;
	hasRequired_mapCacheGet = 1;
	var getMapData = require_getMapData();
	function mapCacheGet(key) {
	  return getMapData(this, key).get(key);
	}
	_mapCacheGet = mapCacheGet;
	return _mapCacheGet;
}

var _mapCacheHas;
var hasRequired_mapCacheHas;

function require_mapCacheHas () {
	if (hasRequired_mapCacheHas) return _mapCacheHas;
	hasRequired_mapCacheHas = 1;
	var getMapData = require_getMapData();
	function mapCacheHas(key) {
	  return getMapData(this, key).has(key);
	}
	_mapCacheHas = mapCacheHas;
	return _mapCacheHas;
}

var _mapCacheSet;
var hasRequired_mapCacheSet;

function require_mapCacheSet () {
	if (hasRequired_mapCacheSet) return _mapCacheSet;
	hasRequired_mapCacheSet = 1;
	var getMapData = require_getMapData();
	function mapCacheSet(key, value) {
	  var data = getMapData(this, key), size = data.size;
	  data.set(key, value);
	  this.size += data.size == size ? 0 : 1;
	  return this;
	}
	_mapCacheSet = mapCacheSet;
	return _mapCacheSet;
}

var _MapCache;
var hasRequired_MapCache;

function require_MapCache () {
	if (hasRequired_MapCache) return _MapCache;
	hasRequired_MapCache = 1;
	var mapCacheClear = require_mapCacheClear(), mapCacheDelete = require_mapCacheDelete(), mapCacheGet = require_mapCacheGet(), mapCacheHas = require_mapCacheHas(), mapCacheSet = require_mapCacheSet();
	function MapCache(entries) {
	  var index = -1, length = entries == null ? 0 : entries.length;
	  this.clear();
	  while (++index < length) {
	    var entry = entries[index];
	    this.set(entry[0], entry[1]);
	  }
	}
	MapCache.prototype.clear = mapCacheClear;
	MapCache.prototype["delete"] = mapCacheDelete;
	MapCache.prototype.get = mapCacheGet;
	MapCache.prototype.has = mapCacheHas;
	MapCache.prototype.set = mapCacheSet;
	_MapCache = MapCache;
	return _MapCache;
}

var _stackSet;
var hasRequired_stackSet;

function require_stackSet () {
	if (hasRequired_stackSet) return _stackSet;
	hasRequired_stackSet = 1;
	var ListCache = require_ListCache(), Map = require_Map(), MapCache = require_MapCache();
	var LARGE_ARRAY_SIZE = 200;
	function stackSet(key, value) {
	  var data = this.__data__;
	  if (data instanceof ListCache) {
	    var pairs = data.__data__;
	    if (!Map || pairs.length < LARGE_ARRAY_SIZE - 1) {
	      pairs.push([key, value]);
	      this.size = ++data.size;
	      return this;
	    }
	    data = this.__data__ = new MapCache(pairs);
	  }
	  data.set(key, value);
	  this.size = data.size;
	  return this;
	}
	_stackSet = stackSet;
	return _stackSet;
}

var _Stack;
var hasRequired_Stack;

function require_Stack () {
	if (hasRequired_Stack) return _Stack;
	hasRequired_Stack = 1;
	var ListCache = require_ListCache(), stackClear = require_stackClear(), stackDelete = require_stackDelete(), stackGet = require_stackGet(), stackHas = require_stackHas(), stackSet = require_stackSet();
	function Stack(entries) {
	  var data = this.__data__ = new ListCache(entries);
	  this.size = data.size;
	}
	Stack.prototype.clear = stackClear;
	Stack.prototype["delete"] = stackDelete;
	Stack.prototype.get = stackGet;
	Stack.prototype.has = stackHas;
	Stack.prototype.set = stackSet;
	_Stack = Stack;
	return _Stack;
}

var _setCacheAdd;
var hasRequired_setCacheAdd;

function require_setCacheAdd () {
	if (hasRequired_setCacheAdd) return _setCacheAdd;
	hasRequired_setCacheAdd = 1;
	var HASH_UNDEFINED = "__lodash_hash_undefined__";
	function setCacheAdd(value) {
	  this.__data__.set(value, HASH_UNDEFINED);
	  return this;
	}
	_setCacheAdd = setCacheAdd;
	return _setCacheAdd;
}

var _setCacheHas;
var hasRequired_setCacheHas;

function require_setCacheHas () {
	if (hasRequired_setCacheHas) return _setCacheHas;
	hasRequired_setCacheHas = 1;
	function setCacheHas(value) {
	  return this.__data__.has(value);
	}
	_setCacheHas = setCacheHas;
	return _setCacheHas;
}

var _SetCache;
var hasRequired_SetCache;

function require_SetCache () {
	if (hasRequired_SetCache) return _SetCache;
	hasRequired_SetCache = 1;
	var MapCache = require_MapCache(), setCacheAdd = require_setCacheAdd(), setCacheHas = require_setCacheHas();
	function SetCache(values) {
	  var index = -1, length = values == null ? 0 : values.length;
	  this.__data__ = new MapCache();
	  while (++index < length) {
	    this.add(values[index]);
	  }
	}
	SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
	SetCache.prototype.has = setCacheHas;
	_SetCache = SetCache;
	return _SetCache;
}

var _arraySome;
var hasRequired_arraySome;

function require_arraySome () {
	if (hasRequired_arraySome) return _arraySome;
	hasRequired_arraySome = 1;
	function arraySome(array, predicate) {
	  var index = -1, length = array == null ? 0 : array.length;
	  while (++index < length) {
	    if (predicate(array[index], index, array)) {
	      return true;
	    }
	  }
	  return false;
	}
	_arraySome = arraySome;
	return _arraySome;
}

var _cacheHas;
var hasRequired_cacheHas;

function require_cacheHas () {
	if (hasRequired_cacheHas) return _cacheHas;
	hasRequired_cacheHas = 1;
	function cacheHas(cache, key) {
	  return cache.has(key);
	}
	_cacheHas = cacheHas;
	return _cacheHas;
}

var _equalArrays;
var hasRequired_equalArrays;

function require_equalArrays () {
	if (hasRequired_equalArrays) return _equalArrays;
	hasRequired_equalArrays = 1;
	var SetCache = require_SetCache(), arraySome = require_arraySome(), cacheHas = require_cacheHas();
	var COMPARE_PARTIAL_FLAG = 1, COMPARE_UNORDERED_FLAG = 2;
	function equalArrays(array, other, bitmask, customizer, equalFunc, stack) {
	  var isPartial = bitmask & COMPARE_PARTIAL_FLAG, arrLength = array.length, othLength = other.length;
	  if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
	    return false;
	  }
	  var arrStacked = stack.get(array);
	  var othStacked = stack.get(other);
	  if (arrStacked && othStacked) {
	    return arrStacked == other && othStacked == array;
	  }
	  var index = -1, result = true, seen = bitmask & COMPARE_UNORDERED_FLAG ? new SetCache() : void 0;
	  stack.set(array, other);
	  stack.set(other, array);
	  while (++index < arrLength) {
	    var arrValue = array[index], othValue = other[index];
	    if (customizer) {
	      var compared = isPartial ? customizer(othValue, arrValue, index, other, array, stack) : customizer(arrValue, othValue, index, array, other, stack);
	    }
	    if (compared !== void 0) {
	      if (compared) {
	        continue;
	      }
	      result = false;
	      break;
	    }
	    if (seen) {
	      if (!arraySome(other, function(othValue2, othIndex) {
	        if (!cacheHas(seen, othIndex) && (arrValue === othValue2 || equalFunc(arrValue, othValue2, bitmask, customizer, stack))) {
	          return seen.push(othIndex);
	        }
	      })) {
	        result = false;
	        break;
	      }
	    } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
	      result = false;
	      break;
	    }
	  }
	  stack["delete"](array);
	  stack["delete"](other);
	  return result;
	}
	_equalArrays = equalArrays;
	return _equalArrays;
}

var _Uint8Array;
var hasRequired_Uint8Array;

function require_Uint8Array () {
	if (hasRequired_Uint8Array) return _Uint8Array;
	hasRequired_Uint8Array = 1;
	var root = require_root();
	var Uint8Array = root.Uint8Array;
	_Uint8Array = Uint8Array;
	return _Uint8Array;
}

var _mapToArray;
var hasRequired_mapToArray;

function require_mapToArray () {
	if (hasRequired_mapToArray) return _mapToArray;
	hasRequired_mapToArray = 1;
	function mapToArray(map) {
	  var index = -1, result = Array(map.size);
	  map.forEach(function(value, key) {
	    result[++index] = [key, value];
	  });
	  return result;
	}
	_mapToArray = mapToArray;
	return _mapToArray;
}

var _setToArray;
var hasRequired_setToArray;

function require_setToArray () {
	if (hasRequired_setToArray) return _setToArray;
	hasRequired_setToArray = 1;
	function setToArray(set) {
	  var index = -1, result = Array(set.size);
	  set.forEach(function(value) {
	    result[++index] = value;
	  });
	  return result;
	}
	_setToArray = setToArray;
	return _setToArray;
}

var _equalByTag;
var hasRequired_equalByTag;

function require_equalByTag () {
	if (hasRequired_equalByTag) return _equalByTag;
	hasRequired_equalByTag = 1;
	var Symbol = require_Symbol(), Uint8Array = require_Uint8Array(), eq = requireEq(), equalArrays = require_equalArrays(), mapToArray = require_mapToArray(), setToArray = require_setToArray();
	var COMPARE_PARTIAL_FLAG = 1, COMPARE_UNORDERED_FLAG = 2;
	var boolTag = "[object Boolean]", dateTag = "[object Date]", errorTag = "[object Error]", mapTag = "[object Map]", numberTag = "[object Number]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", symbolTag = "[object Symbol]";
	var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]";
	var symbolProto = Symbol ? Symbol.prototype : void 0, symbolValueOf = symbolProto ? symbolProto.valueOf : void 0;
	function equalByTag(object, other, tag, bitmask, customizer, equalFunc, stack) {
	  switch (tag) {
	    case dataViewTag:
	      if (object.byteLength != other.byteLength || object.byteOffset != other.byteOffset) {
	        return false;
	      }
	      object = object.buffer;
	      other = other.buffer;
	    case arrayBufferTag:
	      if (object.byteLength != other.byteLength || !equalFunc(new Uint8Array(object), new Uint8Array(other))) {
	        return false;
	      }
	      return true;
	    case boolTag:
	    case dateTag:
	    case numberTag:
	      return eq(+object, +other);
	    case errorTag:
	      return object.name == other.name && object.message == other.message;
	    case regexpTag:
	    case stringTag:
	      return object == other + "";
	    case mapTag:
	      var convert = mapToArray;
	    case setTag:
	      var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
	      convert || (convert = setToArray);
	      if (object.size != other.size && !isPartial) {
	        return false;
	      }
	      var stacked = stack.get(object);
	      if (stacked) {
	        return stacked == other;
	      }
	      bitmask |= COMPARE_UNORDERED_FLAG;
	      stack.set(object, other);
	      var result = equalArrays(convert(object), convert(other), bitmask, customizer, equalFunc, stack);
	      stack["delete"](object);
	      return result;
	    case symbolTag:
	      if (symbolValueOf) {
	        return symbolValueOf.call(object) == symbolValueOf.call(other);
	      }
	  }
	  return false;
	}
	_equalByTag = equalByTag;
	return _equalByTag;
}

var _arrayPush;
var hasRequired_arrayPush;

function require_arrayPush () {
	if (hasRequired_arrayPush) return _arrayPush;
	hasRequired_arrayPush = 1;
	function arrayPush(array, values) {
	  var index = -1, length = values.length, offset = array.length;
	  while (++index < length) {
	    array[offset + index] = values[index];
	  }
	  return array;
	}
	_arrayPush = arrayPush;
	return _arrayPush;
}

var _baseGetAllKeys;
var hasRequired_baseGetAllKeys;

function require_baseGetAllKeys () {
	if (hasRequired_baseGetAllKeys) return _baseGetAllKeys;
	hasRequired_baseGetAllKeys = 1;
	var arrayPush = require_arrayPush(), isArray = requireIsArray();
	function baseGetAllKeys(object, keysFunc, symbolsFunc) {
	  var result = keysFunc(object);
	  return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
	}
	_baseGetAllKeys = baseGetAllKeys;
	return _baseGetAllKeys;
}

var _arrayFilter;
var hasRequired_arrayFilter;

function require_arrayFilter () {
	if (hasRequired_arrayFilter) return _arrayFilter;
	hasRequired_arrayFilter = 1;
	function arrayFilter(array, predicate) {
	  var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result = [];
	  while (++index < length) {
	    var value = array[index];
	    if (predicate(value, index, array)) {
	      result[resIndex++] = value;
	    }
	  }
	  return result;
	}
	_arrayFilter = arrayFilter;
	return _arrayFilter;
}

var stubArray_1;
var hasRequiredStubArray;

function requireStubArray () {
	if (hasRequiredStubArray) return stubArray_1;
	hasRequiredStubArray = 1;
	function stubArray() {
	  return [];
	}
	stubArray_1 = stubArray;
	return stubArray_1;
}

var _getSymbols;
var hasRequired_getSymbols;

function require_getSymbols () {
	if (hasRequired_getSymbols) return _getSymbols;
	hasRequired_getSymbols = 1;
	var arrayFilter = require_arrayFilter(), stubArray = requireStubArray();
	var objectProto = Object.prototype;
	var propertyIsEnumerable = objectProto.propertyIsEnumerable;
	var nativeGetSymbols = Object.getOwnPropertySymbols;
	var getSymbols = !nativeGetSymbols ? stubArray : function(object) {
	  if (object == null) {
	    return [];
	  }
	  object = Object(object);
	  return arrayFilter(nativeGetSymbols(object), function(symbol) {
	    return propertyIsEnumerable.call(object, symbol);
	  });
	};
	_getSymbols = getSymbols;
	return _getSymbols;
}

var _baseTimes;
var hasRequired_baseTimes;

function require_baseTimes () {
	if (hasRequired_baseTimes) return _baseTimes;
	hasRequired_baseTimes = 1;
	function baseTimes(n, iteratee) {
	  var index = -1, result = Array(n);
	  while (++index < n) {
	    result[index] = iteratee(index);
	  }
	  return result;
	}
	_baseTimes = baseTimes;
	return _baseTimes;
}

var _isIndex;
var hasRequired_isIndex;

function require_isIndex () {
	if (hasRequired_isIndex) return _isIndex;
	hasRequired_isIndex = 1;
	var MAX_SAFE_INTEGER = 9007199254740991;
	var reIsUint = /^(?:0|[1-9]\d*)$/;
	function isIndex(value, length) {
	  var type = typeof value;
	  length = length == null ? MAX_SAFE_INTEGER : length;
	  return !!length && (type == "number" || type != "symbol" && reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length);
	}
	_isIndex = isIndex;
	return _isIndex;
}

var _arrayLikeKeys;
var hasRequired_arrayLikeKeys;

function require_arrayLikeKeys () {
	if (hasRequired_arrayLikeKeys) return _arrayLikeKeys;
	hasRequired_arrayLikeKeys = 1;
	var baseTimes = require_baseTimes(), isArguments = requireIsArguments(), isArray = requireIsArray(), isBuffer = requireIsBuffer(), isIndex = require_isIndex(), isTypedArray = requireIsTypedArray();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function arrayLikeKeys(value, inherited) {
	  var isArr = isArray(value), isArg = !isArr && isArguments(value), isBuff = !isArr && !isArg && isBuffer(value), isType = !isArr && !isArg && !isBuff && isTypedArray(value), skipIndexes = isArr || isArg || isBuff || isType, result = skipIndexes ? baseTimes(value.length, String) : [], length = result.length;
	  for (var key in value) {
	    if ((inherited || hasOwnProperty.call(value, key)) && !(skipIndexes && // Safari 9 has enumerable `arguments.length` in strict mode.
	    (key == "length" || // Node.js 0.10 has enumerable non-index properties on buffers.
	    isBuff && (key == "offset" || key == "parent") || // PhantomJS 2 has enumerable non-index properties on typed arrays.
	    isType && (key == "buffer" || key == "byteLength" || key == "byteOffset") || // Skip index properties.
	    isIndex(key, length)))) {
	      result.push(key);
	    }
	  }
	  return result;
	}
	_arrayLikeKeys = arrayLikeKeys;
	return _arrayLikeKeys;
}

var keys_1;
var hasRequiredKeys$1;

function requireKeys$1 () {
	if (hasRequiredKeys$1) return keys_1;
	hasRequiredKeys$1 = 1;
	var arrayLikeKeys = require_arrayLikeKeys(), baseKeys = require_baseKeys(), isArrayLike = requireIsArrayLike();
	function keys(object) {
	  return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
	}
	keys_1 = keys;
	return keys_1;
}

var _getAllKeys;
var hasRequired_getAllKeys;

function require_getAllKeys () {
	if (hasRequired_getAllKeys) return _getAllKeys;
	hasRequired_getAllKeys = 1;
	var baseGetAllKeys = require_baseGetAllKeys(), getSymbols = require_getSymbols(), keys = requireKeys$1();
	function getAllKeys(object) {
	  return baseGetAllKeys(object, keys, getSymbols);
	}
	_getAllKeys = getAllKeys;
	return _getAllKeys;
}

var _equalObjects;
var hasRequired_equalObjects;

function require_equalObjects () {
	if (hasRequired_equalObjects) return _equalObjects;
	hasRequired_equalObjects = 1;
	var getAllKeys = require_getAllKeys();
	var COMPARE_PARTIAL_FLAG = 1;
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function equalObjects(object, other, bitmask, customizer, equalFunc, stack) {
	  var isPartial = bitmask & COMPARE_PARTIAL_FLAG, objProps = getAllKeys(object), objLength = objProps.length, othProps = getAllKeys(other), othLength = othProps.length;
	  if (objLength != othLength && !isPartial) {
	    return false;
	  }
	  var index = objLength;
	  while (index--) {
	    var key = objProps[index];
	    if (!(isPartial ? key in other : hasOwnProperty.call(other, key))) {
	      return false;
	    }
	  }
	  var objStacked = stack.get(object);
	  var othStacked = stack.get(other);
	  if (objStacked && othStacked) {
	    return objStacked == other && othStacked == object;
	  }
	  var result = true;
	  stack.set(object, other);
	  stack.set(other, object);
	  var skipCtor = isPartial;
	  while (++index < objLength) {
	    key = objProps[index];
	    var objValue = object[key], othValue = other[key];
	    if (customizer) {
	      var compared = isPartial ? customizer(othValue, objValue, key, other, object, stack) : customizer(objValue, othValue, key, object, other, stack);
	    }
	    if (!(compared === void 0 ? objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack) : compared)) {
	      result = false;
	      break;
	    }
	    skipCtor || (skipCtor = key == "constructor");
	  }
	  if (result && !skipCtor) {
	    var objCtor = object.constructor, othCtor = other.constructor;
	    if (objCtor != othCtor && ("constructor" in object && "constructor" in other) && !(typeof objCtor == "function" && objCtor instanceof objCtor && typeof othCtor == "function" && othCtor instanceof othCtor)) {
	      result = false;
	    }
	  }
	  stack["delete"](object);
	  stack["delete"](other);
	  return result;
	}
	_equalObjects = equalObjects;
	return _equalObjects;
}

var _baseIsEqualDeep;
var hasRequired_baseIsEqualDeep;

function require_baseIsEqualDeep () {
	if (hasRequired_baseIsEqualDeep) return _baseIsEqualDeep;
	hasRequired_baseIsEqualDeep = 1;
	var Stack = require_Stack(), equalArrays = require_equalArrays(), equalByTag = require_equalByTag(), equalObjects = require_equalObjects(), getTag = require_getTag(), isArray = requireIsArray(), isBuffer = requireIsBuffer(), isTypedArray = requireIsTypedArray();
	var COMPARE_PARTIAL_FLAG = 1;
	var argsTag = "[object Arguments]", arrayTag = "[object Array]", objectTag = "[object Object]";
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function baseIsEqualDeep(object, other, bitmask, customizer, equalFunc, stack) {
	  var objIsArr = isArray(object), othIsArr = isArray(other), objTag = objIsArr ? arrayTag : getTag(object), othTag = othIsArr ? arrayTag : getTag(other);
	  objTag = objTag == argsTag ? objectTag : objTag;
	  othTag = othTag == argsTag ? objectTag : othTag;
	  var objIsObj = objTag == objectTag, othIsObj = othTag == objectTag, isSameTag = objTag == othTag;
	  if (isSameTag && isBuffer(object)) {
	    if (!isBuffer(other)) {
	      return false;
	    }
	    objIsArr = true;
	    objIsObj = false;
	  }
	  if (isSameTag && !objIsObj) {
	    stack || (stack = new Stack());
	    return objIsArr || isTypedArray(object) ? equalArrays(object, other, bitmask, customizer, equalFunc, stack) : equalByTag(object, other, objTag, bitmask, customizer, equalFunc, stack);
	  }
	  if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
	    var objIsWrapped = objIsObj && hasOwnProperty.call(object, "__wrapped__"), othIsWrapped = othIsObj && hasOwnProperty.call(other, "__wrapped__");
	    if (objIsWrapped || othIsWrapped) {
	      var objUnwrapped = objIsWrapped ? object.value() : object, othUnwrapped = othIsWrapped ? other.value() : other;
	      stack || (stack = new Stack());
	      return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
	    }
	  }
	  if (!isSameTag) {
	    return false;
	  }
	  stack || (stack = new Stack());
	  return equalObjects(object, other, bitmask, customizer, equalFunc, stack);
	}
	_baseIsEqualDeep = baseIsEqualDeep;
	return _baseIsEqualDeep;
}

var _baseIsEqual;
var hasRequired_baseIsEqual;

function require_baseIsEqual () {
	if (hasRequired_baseIsEqual) return _baseIsEqual;
	hasRequired_baseIsEqual = 1;
	var baseIsEqualDeep = require_baseIsEqualDeep(), isObjectLike = requireIsObjectLike();
	function baseIsEqual(value, other, bitmask, customizer, stack) {
	  if (value === other) {
	    return true;
	  }
	  if (value == null || other == null || !isObjectLike(value) && !isObjectLike(other)) {
	    return value !== value && other !== other;
	  }
	  return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
	}
	_baseIsEqual = baseIsEqual;
	return _baseIsEqual;
}

var _baseIsMatch;
var hasRequired_baseIsMatch;

function require_baseIsMatch () {
	if (hasRequired_baseIsMatch) return _baseIsMatch;
	hasRequired_baseIsMatch = 1;
	var Stack = require_Stack(), baseIsEqual = require_baseIsEqual();
	var COMPARE_PARTIAL_FLAG = 1, COMPARE_UNORDERED_FLAG = 2;
	function baseIsMatch(object, source, matchData, customizer) {
	  var index = matchData.length, length = index, noCustomizer = !customizer;
	  if (object == null) {
	    return !length;
	  }
	  object = Object(object);
	  while (index--) {
	    var data = matchData[index];
	    if (noCustomizer && data[2] ? data[1] !== object[data[0]] : !(data[0] in object)) {
	      return false;
	    }
	  }
	  while (++index < length) {
	    data = matchData[index];
	    var key = data[0], objValue = object[key], srcValue = data[1];
	    if (noCustomizer && data[2]) {
	      if (objValue === void 0 && !(key in object)) {
	        return false;
	      }
	    } else {
	      var stack = new Stack();
	      if (customizer) {
	        var result = customizer(objValue, srcValue, key, object, source, stack);
	      }
	      if (!(result === void 0 ? baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG, customizer, stack) : result)) {
	        return false;
	      }
	    }
	  }
	  return true;
	}
	_baseIsMatch = baseIsMatch;
	return _baseIsMatch;
}

var _isStrictComparable;
var hasRequired_isStrictComparable;

function require_isStrictComparable () {
	if (hasRequired_isStrictComparable) return _isStrictComparable;
	hasRequired_isStrictComparable = 1;
	var isObject = requireIsObject();
	function isStrictComparable(value) {
	  return value === value && !isObject(value);
	}
	_isStrictComparable = isStrictComparable;
	return _isStrictComparable;
}

var _getMatchData;
var hasRequired_getMatchData;

function require_getMatchData () {
	if (hasRequired_getMatchData) return _getMatchData;
	hasRequired_getMatchData = 1;
	var isStrictComparable = require_isStrictComparable(), keys = requireKeys$1();
	function getMatchData(object) {
	  var result = keys(object), length = result.length;
	  while (length--) {
	    var key = result[length], value = object[key];
	    result[length] = [key, value, isStrictComparable(value)];
	  }
	  return result;
	}
	_getMatchData = getMatchData;
	return _getMatchData;
}

var _matchesStrictComparable;
var hasRequired_matchesStrictComparable;

function require_matchesStrictComparable () {
	if (hasRequired_matchesStrictComparable) return _matchesStrictComparable;
	hasRequired_matchesStrictComparable = 1;
	function matchesStrictComparable(key, srcValue) {
	  return function(object) {
	    if (object == null) {
	      return false;
	    }
	    return object[key] === srcValue && (srcValue !== void 0 || key in Object(object));
	  };
	}
	_matchesStrictComparable = matchesStrictComparable;
	return _matchesStrictComparable;
}

var _baseMatches;
var hasRequired_baseMatches;

function require_baseMatches () {
	if (hasRequired_baseMatches) return _baseMatches;
	hasRequired_baseMatches = 1;
	var baseIsMatch = require_baseIsMatch(), getMatchData = require_getMatchData(), matchesStrictComparable = require_matchesStrictComparable();
	function baseMatches(source) {
	  var matchData = getMatchData(source);
	  if (matchData.length == 1 && matchData[0][2]) {
	    return matchesStrictComparable(matchData[0][0], matchData[0][1]);
	  }
	  return function(object) {
	    return object === source || baseIsMatch(object, source, matchData);
	  };
	}
	_baseMatches = baseMatches;
	return _baseMatches;
}

var isSymbol_1;
var hasRequiredIsSymbol;

function requireIsSymbol () {
	if (hasRequiredIsSymbol) return isSymbol_1;
	hasRequiredIsSymbol = 1;
	var baseGetTag = require_baseGetTag(), isObjectLike = requireIsObjectLike();
	var symbolTag = "[object Symbol]";
	function isSymbol(value) {
	  return typeof value == "symbol" || isObjectLike(value) && baseGetTag(value) == symbolTag;
	}
	isSymbol_1 = isSymbol;
	return isSymbol_1;
}

var _isKey;
var hasRequired_isKey;

function require_isKey () {
	if (hasRequired_isKey) return _isKey;
	hasRequired_isKey = 1;
	var isArray = requireIsArray(), isSymbol = requireIsSymbol();
	var reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/, reIsPlainProp = /^\w*$/;
	function isKey(value, object) {
	  if (isArray(value)) {
	    return false;
	  }
	  var type = typeof value;
	  if (type == "number" || type == "symbol" || type == "boolean" || value == null || isSymbol(value)) {
	    return true;
	  }
	  return reIsPlainProp.test(value) || !reIsDeepProp.test(value) || object != null && value in Object(object);
	}
	_isKey = isKey;
	return _isKey;
}

var memoize_1;
var hasRequiredMemoize;

function requireMemoize () {
	if (hasRequiredMemoize) return memoize_1;
	hasRequiredMemoize = 1;
	var MapCache = require_MapCache();
	var FUNC_ERROR_TEXT = "Expected a function";
	function memoize(func, resolver) {
	  if (typeof func != "function" || resolver != null && typeof resolver != "function") {
	    throw new TypeError(FUNC_ERROR_TEXT);
	  }
	  var memoized = function() {
	    var args = arguments, key = resolver ? resolver.apply(this, args) : args[0], cache = memoized.cache;
	    if (cache.has(key)) {
	      return cache.get(key);
	    }
	    var result = func.apply(this, args);
	    memoized.cache = cache.set(key, result) || cache;
	    return result;
	  };
	  memoized.cache = new (memoize.Cache || MapCache)();
	  return memoized;
	}
	memoize.Cache = MapCache;
	memoize_1 = memoize;
	return memoize_1;
}

var _memoizeCapped;
var hasRequired_memoizeCapped;

function require_memoizeCapped () {
	if (hasRequired_memoizeCapped) return _memoizeCapped;
	hasRequired_memoizeCapped = 1;
	var memoize = requireMemoize();
	var MAX_MEMOIZE_SIZE = 500;
	function memoizeCapped(func) {
	  var result = memoize(func, function(key) {
	    if (cache.size === MAX_MEMOIZE_SIZE) {
	      cache.clear();
	    }
	    return key;
	  });
	  var cache = result.cache;
	  return result;
	}
	_memoizeCapped = memoizeCapped;
	return _memoizeCapped;
}

var _stringToPath;
var hasRequired_stringToPath;

function require_stringToPath () {
	if (hasRequired_stringToPath) return _stringToPath;
	hasRequired_stringToPath = 1;
	var memoizeCapped = require_memoizeCapped();
	var rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;
	var reEscapeChar = /\\(\\)?/g;
	var stringToPath = memoizeCapped(function(string) {
	  var result = [];
	  if (string.charCodeAt(0) === 46) {
	    result.push("");
	  }
	  string.replace(rePropName, function(match, number, quote, subString) {
	    result.push(quote ? subString.replace(reEscapeChar, "$1") : number || match);
	  });
	  return result;
	});
	_stringToPath = stringToPath;
	return _stringToPath;
}

var _baseToString;
var hasRequired_baseToString;

function require_baseToString () {
	if (hasRequired_baseToString) return _baseToString;
	hasRequired_baseToString = 1;
	var Symbol = require_Symbol(), arrayMap = require_arrayMap(), isArray = requireIsArray(), isSymbol = requireIsSymbol();
	var symbolProto = Symbol ? Symbol.prototype : void 0, symbolToString = symbolProto ? symbolProto.toString : void 0;
	function baseToString(value) {
	  if (typeof value == "string") {
	    return value;
	  }
	  if (isArray(value)) {
	    return arrayMap(value, baseToString) + "";
	  }
	  if (isSymbol(value)) {
	    return symbolToString ? symbolToString.call(value) : "";
	  }
	  var result = value + "";
	  return result == "0" && 1 / value == -Infinity ? "-0" : result;
	}
	_baseToString = baseToString;
	return _baseToString;
}

var toString_1;
var hasRequiredToString;

function requireToString () {
	if (hasRequiredToString) return toString_1;
	hasRequiredToString = 1;
	var baseToString = require_baseToString();
	function toString(value) {
	  return value == null ? "" : baseToString(value);
	}
	toString_1 = toString;
	return toString_1;
}

var _castPath;
var hasRequired_castPath;

function require_castPath () {
	if (hasRequired_castPath) return _castPath;
	hasRequired_castPath = 1;
	var isArray = requireIsArray(), isKey = require_isKey(), stringToPath = require_stringToPath(), toString = requireToString();
	function castPath(value, object) {
	  if (isArray(value)) {
	    return value;
	  }
	  return isKey(value, object) ? [value] : stringToPath(toString(value));
	}
	_castPath = castPath;
	return _castPath;
}

var _toKey;
var hasRequired_toKey;

function require_toKey () {
	if (hasRequired_toKey) return _toKey;
	hasRequired_toKey = 1;
	var isSymbol = requireIsSymbol();
	function toKey(value) {
	  if (typeof value == "string" || isSymbol(value)) {
	    return value;
	  }
	  var result = value + "";
	  return result == "0" && 1 / value == -Infinity ? "-0" : result;
	}
	_toKey = toKey;
	return _toKey;
}

var _baseGet;
var hasRequired_baseGet;

function require_baseGet () {
	if (hasRequired_baseGet) return _baseGet;
	hasRequired_baseGet = 1;
	var castPath = require_castPath(), toKey = require_toKey();
	function baseGet(object, path) {
	  path = castPath(path, object);
	  var index = 0, length = path.length;
	  while (object != null && index < length) {
	    object = object[toKey(path[index++])];
	  }
	  return index && index == length ? object : void 0;
	}
	_baseGet = baseGet;
	return _baseGet;
}

var get_1;
var hasRequiredGet;

function requireGet () {
	if (hasRequiredGet) return get_1;
	hasRequiredGet = 1;
	var baseGet = require_baseGet();
	function get(object, path, defaultValue) {
	  var result = object == null ? void 0 : baseGet(object, path);
	  return result === void 0 ? defaultValue : result;
	}
	get_1 = get;
	return get_1;
}

var _baseHasIn;
var hasRequired_baseHasIn;

function require_baseHasIn () {
	if (hasRequired_baseHasIn) return _baseHasIn;
	hasRequired_baseHasIn = 1;
	function baseHasIn(object, key) {
	  return object != null && key in Object(object);
	}
	_baseHasIn = baseHasIn;
	return _baseHasIn;
}

var _hasPath;
var hasRequired_hasPath;

function require_hasPath () {
	if (hasRequired_hasPath) return _hasPath;
	hasRequired_hasPath = 1;
	var castPath = require_castPath(), isArguments = requireIsArguments(), isArray = requireIsArray(), isIndex = require_isIndex(), isLength = requireIsLength(), toKey = require_toKey();
	function hasPath(object, path, hasFunc) {
	  path = castPath(path, object);
	  var index = -1, length = path.length, result = false;
	  while (++index < length) {
	    var key = toKey(path[index]);
	    if (!(result = object != null && hasFunc(object, key))) {
	      break;
	    }
	    object = object[key];
	  }
	  if (result || ++index != length) {
	    return result;
	  }
	  length = object == null ? 0 : object.length;
	  return !!length && isLength(length) && isIndex(key, length) && (isArray(object) || isArguments(object));
	}
	_hasPath = hasPath;
	return _hasPath;
}

var hasIn_1;
var hasRequiredHasIn;

function requireHasIn () {
	if (hasRequiredHasIn) return hasIn_1;
	hasRequiredHasIn = 1;
	var baseHasIn = require_baseHasIn(), hasPath = require_hasPath();
	function hasIn(object, path) {
	  return object != null && hasPath(object, path, baseHasIn);
	}
	hasIn_1 = hasIn;
	return hasIn_1;
}

var _baseMatchesProperty;
var hasRequired_baseMatchesProperty;

function require_baseMatchesProperty () {
	if (hasRequired_baseMatchesProperty) return _baseMatchesProperty;
	hasRequired_baseMatchesProperty = 1;
	var baseIsEqual = require_baseIsEqual(), get = requireGet(), hasIn = requireHasIn(), isKey = require_isKey(), isStrictComparable = require_isStrictComparable(), matchesStrictComparable = require_matchesStrictComparable(), toKey = require_toKey();
	var COMPARE_PARTIAL_FLAG = 1, COMPARE_UNORDERED_FLAG = 2;
	function baseMatchesProperty(path, srcValue) {
	  if (isKey(path) && isStrictComparable(srcValue)) {
	    return matchesStrictComparable(toKey(path), srcValue);
	  }
	  return function(object) {
	    var objValue = get(object, path);
	    return objValue === void 0 && objValue === srcValue ? hasIn(object, path) : baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG);
	  };
	}
	_baseMatchesProperty = baseMatchesProperty;
	return _baseMatchesProperty;
}

var identity_1;
var hasRequiredIdentity;

function requireIdentity () {
	if (hasRequiredIdentity) return identity_1;
	hasRequiredIdentity = 1;
	function identity(value) {
	  return value;
	}
	identity_1 = identity;
	return identity_1;
}

var _baseProperty;
var hasRequired_baseProperty;

function require_baseProperty () {
	if (hasRequired_baseProperty) return _baseProperty;
	hasRequired_baseProperty = 1;
	function baseProperty(key) {
	  return function(object) {
	    return object == null ? void 0 : object[key];
	  };
	}
	_baseProperty = baseProperty;
	return _baseProperty;
}

var _basePropertyDeep;
var hasRequired_basePropertyDeep;

function require_basePropertyDeep () {
	if (hasRequired_basePropertyDeep) return _basePropertyDeep;
	hasRequired_basePropertyDeep = 1;
	var baseGet = require_baseGet();
	function basePropertyDeep(path) {
	  return function(object) {
	    return baseGet(object, path);
	  };
	}
	_basePropertyDeep = basePropertyDeep;
	return _basePropertyDeep;
}

var property_1;
var hasRequiredProperty;

function requireProperty () {
	if (hasRequiredProperty) return property_1;
	hasRequiredProperty = 1;
	var baseProperty = require_baseProperty(), basePropertyDeep = require_basePropertyDeep(), isKey = require_isKey(), toKey = require_toKey();
	function property(path) {
	  return isKey(path) ? baseProperty(toKey(path)) : basePropertyDeep(path);
	}
	property_1 = property;
	return property_1;
}

var _baseIteratee;
var hasRequired_baseIteratee;

function require_baseIteratee () {
	if (hasRequired_baseIteratee) return _baseIteratee;
	hasRequired_baseIteratee = 1;
	var baseMatches = require_baseMatches(), baseMatchesProperty = require_baseMatchesProperty(), identity = requireIdentity(), isArray = requireIsArray(), property = requireProperty();
	function baseIteratee(value) {
	  if (typeof value == "function") {
	    return value;
	  }
	  if (value == null) {
	    return identity;
	  }
	  if (typeof value == "object") {
	    return isArray(value) ? baseMatchesProperty(value[0], value[1]) : baseMatches(value);
	  }
	  return property(value);
	}
	_baseIteratee = baseIteratee;
	return _baseIteratee;
}

var _createBaseFor;
var hasRequired_createBaseFor;

function require_createBaseFor () {
	if (hasRequired_createBaseFor) return _createBaseFor;
	hasRequired_createBaseFor = 1;
	function createBaseFor(fromRight) {
	  return function(object, iteratee, keysFunc) {
	    var index = -1, iterable = Object(object), props = keysFunc(object), length = props.length;
	    while (length--) {
	      var key = props[fromRight ? length : ++index];
	      if (iteratee(iterable[key], key, iterable) === false) {
	        break;
	      }
	    }
	    return object;
	  };
	}
	_createBaseFor = createBaseFor;
	return _createBaseFor;
}

var _baseFor;
var hasRequired_baseFor;

function require_baseFor () {
	if (hasRequired_baseFor) return _baseFor;
	hasRequired_baseFor = 1;
	var createBaseFor = require_createBaseFor();
	var baseFor = createBaseFor();
	_baseFor = baseFor;
	return _baseFor;
}

var _baseForOwn;
var hasRequired_baseForOwn;

function require_baseForOwn () {
	if (hasRequired_baseForOwn) return _baseForOwn;
	hasRequired_baseForOwn = 1;
	var baseFor = require_baseFor(), keys = requireKeys$1();
	function baseForOwn(object, iteratee) {
	  return object && baseFor(object, iteratee, keys);
	}
	_baseForOwn = baseForOwn;
	return _baseForOwn;
}

var _createBaseEach;
var hasRequired_createBaseEach;

function require_createBaseEach () {
	if (hasRequired_createBaseEach) return _createBaseEach;
	hasRequired_createBaseEach = 1;
	var isArrayLike = requireIsArrayLike();
	function createBaseEach(eachFunc, fromRight) {
	  return function(collection, iteratee) {
	    if (collection == null) {
	      return collection;
	    }
	    if (!isArrayLike(collection)) {
	      return eachFunc(collection, iteratee);
	    }
	    var length = collection.length, index = fromRight ? length : -1, iterable = Object(collection);
	    while (fromRight ? index-- : ++index < length) {
	      if (iteratee(iterable[index], index, iterable) === false) {
	        break;
	      }
	    }
	    return collection;
	  };
	}
	_createBaseEach = createBaseEach;
	return _createBaseEach;
}

var _baseEach;
var hasRequired_baseEach;

function require_baseEach () {
	if (hasRequired_baseEach) return _baseEach;
	hasRequired_baseEach = 1;
	var baseForOwn = require_baseForOwn(), createBaseEach = require_createBaseEach();
	var baseEach = createBaseEach(baseForOwn);
	_baseEach = baseEach;
	return _baseEach;
}

var _baseMap;
var hasRequired_baseMap;

function require_baseMap () {
	if (hasRequired_baseMap) return _baseMap;
	hasRequired_baseMap = 1;
	var baseEach = require_baseEach(), isArrayLike = requireIsArrayLike();
	function baseMap(collection, iteratee) {
	  var index = -1, result = isArrayLike(collection) ? Array(collection.length) : [];
	  baseEach(collection, function(value, key, collection2) {
	    result[++index] = iteratee(value, key, collection2);
	  });
	  return result;
	}
	_baseMap = baseMap;
	return _baseMap;
}

var map_1;
var hasRequiredMap;

function requireMap () {
	if (hasRequiredMap) return map_1;
	hasRequiredMap = 1;
	var arrayMap = require_arrayMap(), baseIteratee = require_baseIteratee(), baseMap = require_baseMap(), isArray = requireIsArray();
	function map(collection, iteratee) {
	  var func = isArray(collection) ? arrayMap : baseMap;
	  return func(collection, baseIteratee(iteratee, 3));
	}
	map_1 = map;
	return map_1;
}

var _arrayEach;
var hasRequired_arrayEach;

function require_arrayEach () {
	if (hasRequired_arrayEach) return _arrayEach;
	hasRequired_arrayEach = 1;
	function arrayEach(array, iteratee) {
	  var index = -1, length = array == null ? 0 : array.length;
	  while (++index < length) {
	    if (iteratee(array[index], index, array) === false) {
	      break;
	    }
	  }
	  return array;
	}
	_arrayEach = arrayEach;
	return _arrayEach;
}

var _castFunction;
var hasRequired_castFunction;

function require_castFunction () {
	if (hasRequired_castFunction) return _castFunction;
	hasRequired_castFunction = 1;
	var identity = requireIdentity();
	function castFunction(value) {
	  return typeof value == "function" ? value : identity;
	}
	_castFunction = castFunction;
	return _castFunction;
}

var forEach_1;
var hasRequiredForEach;

function requireForEach () {
	if (hasRequiredForEach) return forEach_1;
	hasRequiredForEach = 1;
	var arrayEach = require_arrayEach(), baseEach = require_baseEach(), castFunction = require_castFunction(), isArray = requireIsArray();
	function forEach(collection, iteratee) {
	  var func = isArray(collection) ? arrayEach : baseEach;
	  return func(collection, castFunction(iteratee));
	}
	forEach_1 = forEach;
	return forEach_1;
}

var _baseValues;
var hasRequired_baseValues;

function require_baseValues () {
	if (hasRequired_baseValues) return _baseValues;
	hasRequired_baseValues = 1;
	var arrayMap = require_arrayMap();
	function baseValues(object, props) {
	  return arrayMap(props, function(key) {
	    return object[key];
	  });
	}
	_baseValues = baseValues;
	return _baseValues;
}

var values_1;
var hasRequiredValues;

function requireValues () {
	if (hasRequiredValues) return values_1;
	hasRequiredValues = 1;
	var baseValues = require_baseValues(), keys = requireKeys$1();
	function values(object) {
	  return object == null ? [] : baseValues(object, keys(object));
	}
	values_1 = values;
	return values_1;
}

var _baseHas;
var hasRequired_baseHas;

function require_baseHas () {
	if (hasRequired_baseHas) return _baseHas;
	hasRequired_baseHas = 1;
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function baseHas(object, key) {
	  return object != null && hasOwnProperty.call(object, key);
	}
	_baseHas = baseHas;
	return _baseHas;
}

var has_1;
var hasRequiredHas;

function requireHas () {
	if (hasRequiredHas) return has_1;
	hasRequiredHas = 1;
	var baseHas = require_baseHas(), hasPath = require_hasPath();
	function has(object, path) {
	  return object != null && hasPath(object, path, baseHas);
	}
	has_1 = has;
	return has_1;
}

var _defineProperty;
var hasRequired_defineProperty;

function require_defineProperty () {
	if (hasRequired_defineProperty) return _defineProperty;
	hasRequired_defineProperty = 1;
	var getNative = require_getNative();
	var defineProperty = (function() {
	  try {
	    var func = getNative(Object, "defineProperty");
	    func({}, "", {});
	    return func;
	  } catch (e) {
	  }
	})();
	_defineProperty = defineProperty;
	return _defineProperty;
}

var _baseAssignValue;
var hasRequired_baseAssignValue;

function require_baseAssignValue () {
	if (hasRequired_baseAssignValue) return _baseAssignValue;
	hasRequired_baseAssignValue = 1;
	var defineProperty = require_defineProperty();
	function baseAssignValue(object, key, value) {
	  if (key == "__proto__" && defineProperty) {
	    defineProperty(object, key, {
	      "configurable": true,
	      "enumerable": true,
	      "value": value,
	      "writable": true
	    });
	  } else {
	    object[key] = value;
	  }
	}
	_baseAssignValue = baseAssignValue;
	return _baseAssignValue;
}

var _assignValue;
var hasRequired_assignValue;

function require_assignValue () {
	if (hasRequired_assignValue) return _assignValue;
	hasRequired_assignValue = 1;
	var baseAssignValue = require_baseAssignValue(), eq = requireEq();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function assignValue(object, key, value) {
	  var objValue = object[key];
	  if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) || value === void 0 && !(key in object)) {
	    baseAssignValue(object, key, value);
	  }
	}
	_assignValue = assignValue;
	return _assignValue;
}

var _copyObject;
var hasRequired_copyObject;

function require_copyObject () {
	if (hasRequired_copyObject) return _copyObject;
	hasRequired_copyObject = 1;
	var assignValue = require_assignValue(), baseAssignValue = require_baseAssignValue();
	function copyObject(source, props, object, customizer) {
	  var isNew = !object;
	  object || (object = {});
	  var index = -1, length = props.length;
	  while (++index < length) {
	    var key = props[index];
	    var newValue = customizer ? customizer(object[key], source[key], key, object, source) : void 0;
	    if (newValue === void 0) {
	      newValue = source[key];
	    }
	    if (isNew) {
	      baseAssignValue(object, key, newValue);
	    } else {
	      assignValue(object, key, newValue);
	    }
	  }
	  return object;
	}
	_copyObject = copyObject;
	return _copyObject;
}

var _baseAssign;
var hasRequired_baseAssign;

function require_baseAssign () {
	if (hasRequired_baseAssign) return _baseAssign;
	hasRequired_baseAssign = 1;
	var copyObject = require_copyObject(), keys = requireKeys$1();
	function baseAssign(object, source) {
	  return object && copyObject(source, keys(source), object);
	}
	_baseAssign = baseAssign;
	return _baseAssign;
}

var _nativeKeysIn;
var hasRequired_nativeKeysIn;

function require_nativeKeysIn () {
	if (hasRequired_nativeKeysIn) return _nativeKeysIn;
	hasRequired_nativeKeysIn = 1;
	function nativeKeysIn(object) {
	  var result = [];
	  if (object != null) {
	    for (var key in Object(object)) {
	      result.push(key);
	    }
	  }
	  return result;
	}
	_nativeKeysIn = nativeKeysIn;
	return _nativeKeysIn;
}

var _baseKeysIn;
var hasRequired_baseKeysIn;

function require_baseKeysIn () {
	if (hasRequired_baseKeysIn) return _baseKeysIn;
	hasRequired_baseKeysIn = 1;
	var isObject = requireIsObject(), isPrototype = require_isPrototype(), nativeKeysIn = require_nativeKeysIn();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function baseKeysIn(object) {
	  if (!isObject(object)) {
	    return nativeKeysIn(object);
	  }
	  var isProto = isPrototype(object), result = [];
	  for (var key in object) {
	    if (!(key == "constructor" && (isProto || !hasOwnProperty.call(object, key)))) {
	      result.push(key);
	    }
	  }
	  return result;
	}
	_baseKeysIn = baseKeysIn;
	return _baseKeysIn;
}

var keysIn_1;
var hasRequiredKeysIn;

function requireKeysIn () {
	if (hasRequiredKeysIn) return keysIn_1;
	hasRequiredKeysIn = 1;
	var arrayLikeKeys = require_arrayLikeKeys(), baseKeysIn = require_baseKeysIn(), isArrayLike = requireIsArrayLike();
	function keysIn(object) {
	  return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
	}
	keysIn_1 = keysIn;
	return keysIn_1;
}

var _baseAssignIn;
var hasRequired_baseAssignIn;

function require_baseAssignIn () {
	if (hasRequired_baseAssignIn) return _baseAssignIn;
	hasRequired_baseAssignIn = 1;
	var copyObject = require_copyObject(), keysIn = requireKeysIn();
	function baseAssignIn(object, source) {
	  return object && copyObject(source, keysIn(source), object);
	}
	_baseAssignIn = baseAssignIn;
	return _baseAssignIn;
}

var _cloneBuffer = {exports: {}};

_cloneBuffer.exports;

var hasRequired_cloneBuffer;

function require_cloneBuffer () {
	if (hasRequired_cloneBuffer) return _cloneBuffer.exports;
	hasRequired_cloneBuffer = 1;
	(function (module, exports$1) {
		var root = require_root();
		var freeExports = exports$1 && !exports$1.nodeType && exports$1;
		var freeModule = freeExports && 'object' == "object" && module && !module.nodeType && module;
		var moduleExports = freeModule && freeModule.exports === freeExports;
		var Buffer = moduleExports ? root.Buffer : void 0, allocUnsafe = Buffer ? Buffer.allocUnsafe : void 0;
		function cloneBuffer(buffer, isDeep) {
		  if (isDeep) {
		    return buffer.slice();
		  }
		  var length = buffer.length, result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);
		  buffer.copy(result);
		  return result;
		}
		module.exports = cloneBuffer; 
	} (_cloneBuffer, _cloneBuffer.exports));
	return _cloneBuffer.exports;
}

var _copyArray;
var hasRequired_copyArray;

function require_copyArray () {
	if (hasRequired_copyArray) return _copyArray;
	hasRequired_copyArray = 1;
	function copyArray(source, array) {
	  var index = -1, length = source.length;
	  array || (array = Array(length));
	  while (++index < length) {
	    array[index] = source[index];
	  }
	  return array;
	}
	_copyArray = copyArray;
	return _copyArray;
}

var _copySymbols;
var hasRequired_copySymbols;

function require_copySymbols () {
	if (hasRequired_copySymbols) return _copySymbols;
	hasRequired_copySymbols = 1;
	var copyObject = require_copyObject(), getSymbols = require_getSymbols();
	function copySymbols(source, object) {
	  return copyObject(source, getSymbols(source), object);
	}
	_copySymbols = copySymbols;
	return _copySymbols;
}

var _getPrototype;
var hasRequired_getPrototype;

function require_getPrototype () {
	if (hasRequired_getPrototype) return _getPrototype;
	hasRequired_getPrototype = 1;
	var overArg = require_overArg();
	var getPrototype = overArg(Object.getPrototypeOf, Object);
	_getPrototype = getPrototype;
	return _getPrototype;
}

var _getSymbolsIn;
var hasRequired_getSymbolsIn;

function require_getSymbolsIn () {
	if (hasRequired_getSymbolsIn) return _getSymbolsIn;
	hasRequired_getSymbolsIn = 1;
	var arrayPush = require_arrayPush(), getPrototype = require_getPrototype(), getSymbols = require_getSymbols(), stubArray = requireStubArray();
	var nativeGetSymbols = Object.getOwnPropertySymbols;
	var getSymbolsIn = !nativeGetSymbols ? stubArray : function(object) {
	  var result = [];
	  while (object) {
	    arrayPush(result, getSymbols(object));
	    object = getPrototype(object);
	  }
	  return result;
	};
	_getSymbolsIn = getSymbolsIn;
	return _getSymbolsIn;
}

var _copySymbolsIn;
var hasRequired_copySymbolsIn;

function require_copySymbolsIn () {
	if (hasRequired_copySymbolsIn) return _copySymbolsIn;
	hasRequired_copySymbolsIn = 1;
	var copyObject = require_copyObject(), getSymbolsIn = require_getSymbolsIn();
	function copySymbolsIn(source, object) {
	  return copyObject(source, getSymbolsIn(source), object);
	}
	_copySymbolsIn = copySymbolsIn;
	return _copySymbolsIn;
}

var _getAllKeysIn;
var hasRequired_getAllKeysIn;

function require_getAllKeysIn () {
	if (hasRequired_getAllKeysIn) return _getAllKeysIn;
	hasRequired_getAllKeysIn = 1;
	var baseGetAllKeys = require_baseGetAllKeys(), getSymbolsIn = require_getSymbolsIn(), keysIn = requireKeysIn();
	function getAllKeysIn(object) {
	  return baseGetAllKeys(object, keysIn, getSymbolsIn);
	}
	_getAllKeysIn = getAllKeysIn;
	return _getAllKeysIn;
}

var _initCloneArray;
var hasRequired_initCloneArray;

function require_initCloneArray () {
	if (hasRequired_initCloneArray) return _initCloneArray;
	hasRequired_initCloneArray = 1;
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	function initCloneArray(array) {
	  var length = array.length, result = new array.constructor(length);
	  if (length && typeof array[0] == "string" && hasOwnProperty.call(array, "index")) {
	    result.index = array.index;
	    result.input = array.input;
	  }
	  return result;
	}
	_initCloneArray = initCloneArray;
	return _initCloneArray;
}

var _cloneArrayBuffer;
var hasRequired_cloneArrayBuffer;

function require_cloneArrayBuffer () {
	if (hasRequired_cloneArrayBuffer) return _cloneArrayBuffer;
	hasRequired_cloneArrayBuffer = 1;
	var Uint8Array = require_Uint8Array();
	function cloneArrayBuffer(arrayBuffer) {
	  var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
	  new Uint8Array(result).set(new Uint8Array(arrayBuffer));
	  return result;
	}
	_cloneArrayBuffer = cloneArrayBuffer;
	return _cloneArrayBuffer;
}

var _cloneDataView;
var hasRequired_cloneDataView;

function require_cloneDataView () {
	if (hasRequired_cloneDataView) return _cloneDataView;
	hasRequired_cloneDataView = 1;
	var cloneArrayBuffer = require_cloneArrayBuffer();
	function cloneDataView(dataView, isDeep) {
	  var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
	  return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
	}
	_cloneDataView = cloneDataView;
	return _cloneDataView;
}

var _cloneRegExp;
var hasRequired_cloneRegExp;

function require_cloneRegExp () {
	if (hasRequired_cloneRegExp) return _cloneRegExp;
	hasRequired_cloneRegExp = 1;
	var reFlags = /\w*$/;
	function cloneRegExp(regexp) {
	  var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
	  result.lastIndex = regexp.lastIndex;
	  return result;
	}
	_cloneRegExp = cloneRegExp;
	return _cloneRegExp;
}

var _cloneSymbol;
var hasRequired_cloneSymbol;

function require_cloneSymbol () {
	if (hasRequired_cloneSymbol) return _cloneSymbol;
	hasRequired_cloneSymbol = 1;
	var Symbol = require_Symbol();
	var symbolProto = Symbol ? Symbol.prototype : void 0, symbolValueOf = symbolProto ? symbolProto.valueOf : void 0;
	function cloneSymbol(symbol) {
	  return symbolValueOf ? Object(symbolValueOf.call(symbol)) : {};
	}
	_cloneSymbol = cloneSymbol;
	return _cloneSymbol;
}

var _cloneTypedArray;
var hasRequired_cloneTypedArray;

function require_cloneTypedArray () {
	if (hasRequired_cloneTypedArray) return _cloneTypedArray;
	hasRequired_cloneTypedArray = 1;
	var cloneArrayBuffer = require_cloneArrayBuffer();
	function cloneTypedArray(typedArray, isDeep) {
	  var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
	  return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
	}
	_cloneTypedArray = cloneTypedArray;
	return _cloneTypedArray;
}

var _initCloneByTag;
var hasRequired_initCloneByTag;

function require_initCloneByTag () {
	if (hasRequired_initCloneByTag) return _initCloneByTag;
	hasRequired_initCloneByTag = 1;
	var cloneArrayBuffer = require_cloneArrayBuffer(), cloneDataView = require_cloneDataView(), cloneRegExp = require_cloneRegExp(), cloneSymbol = require_cloneSymbol(), cloneTypedArray = require_cloneTypedArray();
	var boolTag = "[object Boolean]", dateTag = "[object Date]", mapTag = "[object Map]", numberTag = "[object Number]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", symbolTag = "[object Symbol]";
	var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
	function initCloneByTag(object, tag, isDeep) {
	  var Ctor = object.constructor;
	  switch (tag) {
	    case arrayBufferTag:
	      return cloneArrayBuffer(object);
	    case boolTag:
	    case dateTag:
	      return new Ctor(+object);
	    case dataViewTag:
	      return cloneDataView(object, isDeep);
	    case float32Tag:
	    case float64Tag:
	    case int8Tag:
	    case int16Tag:
	    case int32Tag:
	    case uint8Tag:
	    case uint8ClampedTag:
	    case uint16Tag:
	    case uint32Tag:
	      return cloneTypedArray(object, isDeep);
	    case mapTag:
	      return new Ctor();
	    case numberTag:
	    case stringTag:
	      return new Ctor(object);
	    case regexpTag:
	      return cloneRegExp(object);
	    case setTag:
	      return new Ctor();
	    case symbolTag:
	      return cloneSymbol(object);
	  }
	}
	_initCloneByTag = initCloneByTag;
	return _initCloneByTag;
}

var _baseCreate;
var hasRequired_baseCreate;

function require_baseCreate () {
	if (hasRequired_baseCreate) return _baseCreate;
	hasRequired_baseCreate = 1;
	var isObject = requireIsObject();
	var objectCreate = Object.create;
	var baseCreate = /* @__PURE__ */ (function() {
	  function object() {
	  }
	  return function(proto) {
	    if (!isObject(proto)) {
	      return {};
	    }
	    if (objectCreate) {
	      return objectCreate(proto);
	    }
	    object.prototype = proto;
	    var result = new object();
	    object.prototype = void 0;
	    return result;
	  };
	})();
	_baseCreate = baseCreate;
	return _baseCreate;
}

var _initCloneObject;
var hasRequired_initCloneObject;

function require_initCloneObject () {
	if (hasRequired_initCloneObject) return _initCloneObject;
	hasRequired_initCloneObject = 1;
	var baseCreate = require_baseCreate(), getPrototype = require_getPrototype(), isPrototype = require_isPrototype();
	function initCloneObject(object) {
	  return typeof object.constructor == "function" && !isPrototype(object) ? baseCreate(getPrototype(object)) : {};
	}
	_initCloneObject = initCloneObject;
	return _initCloneObject;
}

var _baseIsMap;
var hasRequired_baseIsMap;

function require_baseIsMap () {
	if (hasRequired_baseIsMap) return _baseIsMap;
	hasRequired_baseIsMap = 1;
	var getTag = require_getTag(), isObjectLike = requireIsObjectLike();
	var mapTag = "[object Map]";
	function baseIsMap(value) {
	  return isObjectLike(value) && getTag(value) == mapTag;
	}
	_baseIsMap = baseIsMap;
	return _baseIsMap;
}

var isMap_1;
var hasRequiredIsMap;

function requireIsMap () {
	if (hasRequiredIsMap) return isMap_1;
	hasRequiredIsMap = 1;
	var baseIsMap = require_baseIsMap(), baseUnary = require_baseUnary(), nodeUtil = require_nodeUtil();
	var nodeIsMap = nodeUtil && nodeUtil.isMap;
	var isMap = nodeIsMap ? baseUnary(nodeIsMap) : baseIsMap;
	isMap_1 = isMap;
	return isMap_1;
}

var _baseIsSet;
var hasRequired_baseIsSet;

function require_baseIsSet () {
	if (hasRequired_baseIsSet) return _baseIsSet;
	hasRequired_baseIsSet = 1;
	var getTag = require_getTag(), isObjectLike = requireIsObjectLike();
	var setTag = "[object Set]";
	function baseIsSet(value) {
	  return isObjectLike(value) && getTag(value) == setTag;
	}
	_baseIsSet = baseIsSet;
	return _baseIsSet;
}

var isSet_1;
var hasRequiredIsSet;

function requireIsSet () {
	if (hasRequiredIsSet) return isSet_1;
	hasRequiredIsSet = 1;
	var baseIsSet = require_baseIsSet(), baseUnary = require_baseUnary(), nodeUtil = require_nodeUtil();
	var nodeIsSet = nodeUtil && nodeUtil.isSet;
	var isSet = nodeIsSet ? baseUnary(nodeIsSet) : baseIsSet;
	isSet_1 = isSet;
	return isSet_1;
}

var _baseClone;
var hasRequired_baseClone;

function require_baseClone () {
	if (hasRequired_baseClone) return _baseClone;
	hasRequired_baseClone = 1;
	var Stack = require_Stack(), arrayEach = require_arrayEach(), assignValue = require_assignValue(), baseAssign = require_baseAssign(), baseAssignIn = require_baseAssignIn(), cloneBuffer = require_cloneBuffer(), copyArray = require_copyArray(), copySymbols = require_copySymbols(), copySymbolsIn = require_copySymbolsIn(), getAllKeys = require_getAllKeys(), getAllKeysIn = require_getAllKeysIn(), getTag = require_getTag(), initCloneArray = require_initCloneArray(), initCloneByTag = require_initCloneByTag(), initCloneObject = require_initCloneObject(), isArray = requireIsArray(), isBuffer = requireIsBuffer(), isMap = requireIsMap(), isObject = requireIsObject(), isSet = requireIsSet(), keys = requireKeys$1(), keysIn = requireKeysIn();
	var CLONE_DEEP_FLAG = 1, CLONE_FLAT_FLAG = 2, CLONE_SYMBOLS_FLAG = 4;
	var argsTag = "[object Arguments]", arrayTag = "[object Array]", boolTag = "[object Boolean]", dateTag = "[object Date]", errorTag = "[object Error]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", mapTag = "[object Map]", numberTag = "[object Number]", objectTag = "[object Object]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", symbolTag = "[object Symbol]", weakMapTag = "[object WeakMap]";
	var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
	var cloneableTags = {};
	cloneableTags[argsTag] = cloneableTags[arrayTag] = cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] = cloneableTags[boolTag] = cloneableTags[dateTag] = cloneableTags[float32Tag] = cloneableTags[float64Tag] = cloneableTags[int8Tag] = cloneableTags[int16Tag] = cloneableTags[int32Tag] = cloneableTags[mapTag] = cloneableTags[numberTag] = cloneableTags[objectTag] = cloneableTags[regexpTag] = cloneableTags[setTag] = cloneableTags[stringTag] = cloneableTags[symbolTag] = cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] = cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
	cloneableTags[errorTag] = cloneableTags[funcTag] = cloneableTags[weakMapTag] = false;
	function baseClone(value, bitmask, customizer, key, object, stack) {
	  var result, isDeep = bitmask & CLONE_DEEP_FLAG, isFlat = bitmask & CLONE_FLAT_FLAG, isFull = bitmask & CLONE_SYMBOLS_FLAG;
	  if (customizer) {
	    result = object ? customizer(value, key, object, stack) : customizer(value);
	  }
	  if (result !== void 0) {
	    return result;
	  }
	  if (!isObject(value)) {
	    return value;
	  }
	  var isArr = isArray(value);
	  if (isArr) {
	    result = initCloneArray(value);
	    if (!isDeep) {
	      return copyArray(value, result);
	    }
	  } else {
	    var tag = getTag(value), isFunc = tag == funcTag || tag == genTag;
	    if (isBuffer(value)) {
	      return cloneBuffer(value, isDeep);
	    }
	    if (tag == objectTag || tag == argsTag || isFunc && !object) {
	      result = isFlat || isFunc ? {} : initCloneObject(value);
	      if (!isDeep) {
	        return isFlat ? copySymbolsIn(value, baseAssignIn(result, value)) : copySymbols(value, baseAssign(result, value));
	      }
	    } else {
	      if (!cloneableTags[tag]) {
	        return object ? value : {};
	      }
	      result = initCloneByTag(value, tag, isDeep);
	    }
	  }
	  stack || (stack = new Stack());
	  var stacked = stack.get(value);
	  if (stacked) {
	    return stacked;
	  }
	  stack.set(value, result);
	  if (isSet(value)) {
	    value.forEach(function(subValue) {
	      result.add(baseClone(subValue, bitmask, customizer, subValue, value, stack));
	    });
	  } else if (isMap(value)) {
	    value.forEach(function(subValue, key2) {
	      result.set(key2, baseClone(subValue, bitmask, customizer, key2, value, stack));
	    });
	  }
	  var keysFunc = isFull ? isFlat ? getAllKeysIn : getAllKeys : isFlat ? keysIn : keys;
	  var props = isArr ? void 0 : keysFunc(value);
	  arrayEach(props || value, function(subValue, key2) {
	    if (props) {
	      key2 = subValue;
	      subValue = value[key2];
	    }
	    assignValue(result, key2, baseClone(subValue, bitmask, customizer, key2, value, stack));
	  });
	  return result;
	}
	_baseClone = baseClone;
	return _baseClone;
}

var clone_1;
var hasRequiredClone;

function requireClone () {
	if (hasRequiredClone) return clone_1;
	hasRequiredClone = 1;
	var baseClone = require_baseClone();
	var CLONE_SYMBOLS_FLAG = 4;
	function clone(value) {
	  return baseClone(value, CLONE_SYMBOLS_FLAG);
	}
	clone_1 = clone;
	return clone_1;
}

var api$2 = {};

var print = {};

var hasRequiredPrint;

function requirePrint () {
	if (hasRequiredPrint) return print;
	hasRequiredPrint = 1;
	Object.defineProperty(print, "__esModule", { value: true });
	print.PRINT_WARNING = print.PRINT_ERROR = void 0;
	function PRINT_ERROR(msg) {
	  if (console && console.error) {
	    console.error("Error: ".concat(msg));
	  }
	}
	print.PRINT_ERROR = PRINT_ERROR;
	function PRINT_WARNING(msg) {
	  if (console && console.warn) {
	    console.warn("Warning: ".concat(msg));
	  }
	}
	print.PRINT_WARNING = PRINT_WARNING;
	return print;
}

var timer = {};

var hasRequiredTimer;

function requireTimer () {
	if (hasRequiredTimer) return timer;
	hasRequiredTimer = 1;
	Object.defineProperty(timer, "__esModule", { value: true });
	timer.timer = void 0;
	function timer$1(func) {
	  var start = (/* @__PURE__ */ new Date()).getTime();
	  var val = func();
	  var end = (/* @__PURE__ */ new Date()).getTime();
	  var total = end - start;
	  return { time: total, value: val };
	}
	timer.timer = timer$1;
	return timer;
}

var toFastProperties = {};

var hasRequiredToFastProperties;

function requireToFastProperties () {
	if (hasRequiredToFastProperties) return toFastProperties;
	hasRequiredToFastProperties = 1;
	Object.defineProperty(toFastProperties, "__esModule", { value: true });
	toFastProperties.toFastProperties = void 0;
	function toFastProperties$1(toBecomeFast) {
	  function FakeConstructor() {
	  }
	  FakeConstructor.prototype = toBecomeFast;
	  var fakeInstance = new FakeConstructor();
	  function fakeAccess() {
	    return typeof fakeInstance.bar;
	  }
	  fakeAccess();
	  fakeAccess();
	  return toBecomeFast;
	}
	toFastProperties.toFastProperties = toFastProperties$1;
	return toFastProperties;
}

var hasRequiredApi$3;

function requireApi$3 () {
	if (hasRequiredApi$3) return api$2;
	hasRequiredApi$3 = 1;
	(function (exports$1) {
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.toFastProperties = exports$1.timer = exports$1.PRINT_ERROR = exports$1.PRINT_WARNING = void 0;
		var print_1 = requirePrint();
		Object.defineProperty(exports$1, "PRINT_WARNING", { enumerable: true, get: function() {
		  return print_1.PRINT_WARNING;
		} });
		Object.defineProperty(exports$1, "PRINT_ERROR", { enumerable: true, get: function() {
		  return print_1.PRINT_ERROR;
		} });
		var timer_1 = requireTimer();
		Object.defineProperty(exports$1, "timer", { enumerable: true, get: function() {
		  return timer_1.timer;
		} });
		var to_fast_properties_1 = requireToFastProperties();
		Object.defineProperty(exports$1, "toFastProperties", { enumerable: true, get: function() {
		  return to_fast_properties_1.toFastProperties;
		} }); 
	} (api$2));
	return api$2;
}

var follow = {};

var rest = {};

var _baseSlice;
var hasRequired_baseSlice;

function require_baseSlice () {
	if (hasRequired_baseSlice) return _baseSlice;
	hasRequired_baseSlice = 1;
	function baseSlice(array, start, end) {
	  var index = -1, length = array.length;
	  if (start < 0) {
	    start = -start > length ? 0 : length + start;
	  }
	  end = end > length ? length : end;
	  if (end < 0) {
	    end += length;
	  }
	  length = start > end ? 0 : end - start >>> 0;
	  start >>>= 0;
	  var result = Array(length);
	  while (++index < length) {
	    result[index] = array[index + start];
	  }
	  return result;
	}
	_baseSlice = baseSlice;
	return _baseSlice;
}

var _trimmedEndIndex;
var hasRequired_trimmedEndIndex;

function require_trimmedEndIndex () {
	if (hasRequired_trimmedEndIndex) return _trimmedEndIndex;
	hasRequired_trimmedEndIndex = 1;
	var reWhitespace = /\s/;
	function trimmedEndIndex(string) {
	  var index = string.length;
	  while (index-- && reWhitespace.test(string.charAt(index))) {
	  }
	  return index;
	}
	_trimmedEndIndex = trimmedEndIndex;
	return _trimmedEndIndex;
}

var _baseTrim;
var hasRequired_baseTrim;

function require_baseTrim () {
	if (hasRequired_baseTrim) return _baseTrim;
	hasRequired_baseTrim = 1;
	var trimmedEndIndex = require_trimmedEndIndex();
	var reTrimStart = /^\s+/;
	function baseTrim(string) {
	  return string ? string.slice(0, trimmedEndIndex(string) + 1).replace(reTrimStart, "") : string;
	}
	_baseTrim = baseTrim;
	return _baseTrim;
}

var toNumber_1;
var hasRequiredToNumber;

function requireToNumber () {
	if (hasRequiredToNumber) return toNumber_1;
	hasRequiredToNumber = 1;
	var baseTrim = require_baseTrim(), isObject = requireIsObject(), isSymbol = requireIsSymbol();
	var NAN = 0 / 0;
	var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
	var reIsBinary = /^0b[01]+$/i;
	var reIsOctal = /^0o[0-7]+$/i;
	var freeParseInt = parseInt;
	function toNumber(value) {
	  if (typeof value == "number") {
	    return value;
	  }
	  if (isSymbol(value)) {
	    return NAN;
	  }
	  if (isObject(value)) {
	    var other = typeof value.valueOf == "function" ? value.valueOf() : value;
	    value = isObject(other) ? other + "" : other;
	  }
	  if (typeof value != "string") {
	    return value === 0 ? value : +value;
	  }
	  value = baseTrim(value);
	  var isBinary = reIsBinary.test(value);
	  return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
	}
	toNumber_1 = toNumber;
	return toNumber_1;
}

var toFinite_1;
var hasRequiredToFinite;

function requireToFinite () {
	if (hasRequiredToFinite) return toFinite_1;
	hasRequiredToFinite = 1;
	var toNumber = requireToNumber();
	var INFINITY = 1 / 0, MAX_INTEGER = 17976931348623157e292;
	function toFinite(value) {
	  if (!value) {
	    return value === 0 ? value : 0;
	  }
	  value = toNumber(value);
	  if (value === INFINITY || value === -INFINITY) {
	    var sign = value < 0 ? -1 : 1;
	    return sign * MAX_INTEGER;
	  }
	  return value === value ? value : 0;
	}
	toFinite_1 = toFinite;
	return toFinite_1;
}

var toInteger_1;
var hasRequiredToInteger;

function requireToInteger () {
	if (hasRequiredToInteger) return toInteger_1;
	hasRequiredToInteger = 1;
	var toFinite = requireToFinite();
	function toInteger(value) {
	  var result = toFinite(value), remainder = result % 1;
	  return result === result ? remainder ? result - remainder : result : 0;
	}
	toInteger_1 = toInteger;
	return toInteger_1;
}

var drop_1;
var hasRequiredDrop;

function requireDrop () {
	if (hasRequiredDrop) return drop_1;
	hasRequiredDrop = 1;
	var baseSlice = require_baseSlice(), toInteger = requireToInteger();
	function drop(array, n, guard) {
	  var length = array == null ? 0 : array.length;
	  if (!length) {
	    return [];
	  }
	  n = guard || n === void 0 ? 1 : toInteger(n);
	  return baseSlice(array, n < 0 ? 0 : n, length);
	}
	drop_1 = drop;
	return drop_1;
}

var api$1 = {};

var model$1 = {};

var isString_1;
var hasRequiredIsString;

function requireIsString () {
	if (hasRequiredIsString) return isString_1;
	hasRequiredIsString = 1;
	var baseGetTag = require_baseGetTag(), isArray = requireIsArray(), isObjectLike = requireIsObjectLike();
	var stringTag = "[object String]";
	function isString(value) {
	  return typeof value == "string" || !isArray(value) && isObjectLike(value) && baseGetTag(value) == stringTag;
	}
	isString_1 = isString;
	return isString_1;
}

var _baseIsRegExp;
var hasRequired_baseIsRegExp;

function require_baseIsRegExp () {
	if (hasRequired_baseIsRegExp) return _baseIsRegExp;
	hasRequired_baseIsRegExp = 1;
	var baseGetTag = require_baseGetTag(), isObjectLike = requireIsObjectLike();
	var regexpTag = "[object RegExp]";
	function baseIsRegExp(value) {
	  return isObjectLike(value) && baseGetTag(value) == regexpTag;
	}
	_baseIsRegExp = baseIsRegExp;
	return _baseIsRegExp;
}

var isRegExp_1;
var hasRequiredIsRegExp;

function requireIsRegExp () {
	if (hasRequiredIsRegExp) return isRegExp_1;
	hasRequiredIsRegExp = 1;
	var baseIsRegExp = require_baseIsRegExp(), baseUnary = require_baseUnary(), nodeUtil = require_nodeUtil();
	var nodeIsRegExp = nodeUtil && nodeUtil.isRegExp;
	var isRegExp = nodeIsRegExp ? baseUnary(nodeIsRegExp) : baseIsRegExp;
	isRegExp_1 = isRegExp;
	return isRegExp_1;
}

var _baseSet;
var hasRequired_baseSet;

function require_baseSet () {
	if (hasRequired_baseSet) return _baseSet;
	hasRequired_baseSet = 1;
	var assignValue = require_assignValue(), castPath = require_castPath(), isIndex = require_isIndex(), isObject = requireIsObject(), toKey = require_toKey();
	function baseSet(object, path, value, customizer) {
	  if (!isObject(object)) {
	    return object;
	  }
	  path = castPath(path, object);
	  var index = -1, length = path.length, lastIndex = length - 1, nested = object;
	  while (nested != null && ++index < length) {
	    var key = toKey(path[index]), newValue = value;
	    if (key === "__proto__" || key === "constructor" || key === "prototype") {
	      return object;
	    }
	    if (index != lastIndex) {
	      var objValue = nested[key];
	      newValue = customizer ? customizer(objValue, key, nested) : void 0;
	      if (newValue === void 0) {
	        newValue = isObject(objValue) ? objValue : isIndex(path[index + 1]) ? [] : {};
	      }
	    }
	    assignValue(nested, key, newValue);
	    nested = nested[key];
	  }
	  return object;
	}
	_baseSet = baseSet;
	return _baseSet;
}

var _basePickBy;
var hasRequired_basePickBy;

function require_basePickBy () {
	if (hasRequired_basePickBy) return _basePickBy;
	hasRequired_basePickBy = 1;
	var baseGet = require_baseGet(), baseSet = require_baseSet(), castPath = require_castPath();
	function basePickBy(object, paths, predicate) {
	  var index = -1, length = paths.length, result = {};
	  while (++index < length) {
	    var path = paths[index], value = baseGet(object, path);
	    if (predicate(value, path)) {
	      baseSet(result, castPath(path, object), value);
	    }
	  }
	  return result;
	}
	_basePickBy = basePickBy;
	return _basePickBy;
}

var pickBy_1;
var hasRequiredPickBy;

function requirePickBy () {
	if (hasRequiredPickBy) return pickBy_1;
	hasRequiredPickBy = 1;
	var arrayMap = require_arrayMap(), baseIteratee = require_baseIteratee(), basePickBy = require_basePickBy(), getAllKeysIn = require_getAllKeysIn();
	function pickBy(object, predicate) {
	  if (object == null) {
	    return {};
	  }
	  var props = arrayMap(getAllKeysIn(object), function(prop) {
	    return [prop];
	  });
	  predicate = baseIteratee(predicate);
	  return basePickBy(object, props, function(value, path) {
	    return predicate(value, path[0]);
	  });
	}
	pickBy_1 = pickBy;
	return pickBy_1;
}

var _apply;
var hasRequired_apply;

function require_apply () {
	if (hasRequired_apply) return _apply;
	hasRequired_apply = 1;
	function apply(func, thisArg, args) {
	  switch (args.length) {
	    case 0:
	      return func.call(thisArg);
	    case 1:
	      return func.call(thisArg, args[0]);
	    case 2:
	      return func.call(thisArg, args[0], args[1]);
	    case 3:
	      return func.call(thisArg, args[0], args[1], args[2]);
	  }
	  return func.apply(thisArg, args);
	}
	_apply = apply;
	return _apply;
}

var _overRest;
var hasRequired_overRest;

function require_overRest () {
	if (hasRequired_overRest) return _overRest;
	hasRequired_overRest = 1;
	var apply = require_apply();
	var nativeMax = Math.max;
	function overRest(func, start, transform) {
	  start = nativeMax(start === void 0 ? func.length - 1 : start, 0);
	  return function() {
	    var args = arguments, index = -1, length = nativeMax(args.length - start, 0), array = Array(length);
	    while (++index < length) {
	      array[index] = args[start + index];
	    }
	    index = -1;
	    var otherArgs = Array(start + 1);
	    while (++index < start) {
	      otherArgs[index] = args[index];
	    }
	    otherArgs[start] = transform(array);
	    return apply(func, this, otherArgs);
	  };
	}
	_overRest = overRest;
	return _overRest;
}

var constant_1;
var hasRequiredConstant;

function requireConstant () {
	if (hasRequiredConstant) return constant_1;
	hasRequiredConstant = 1;
	function constant(value) {
	  return function() {
	    return value;
	  };
	}
	constant_1 = constant;
	return constant_1;
}

var _baseSetToString;
var hasRequired_baseSetToString;

function require_baseSetToString () {
	if (hasRequired_baseSetToString) return _baseSetToString;
	hasRequired_baseSetToString = 1;
	var constant = requireConstant(), defineProperty = require_defineProperty(), identity = requireIdentity();
	var baseSetToString = !defineProperty ? identity : function(func, string) {
	  return defineProperty(func, "toString", {
	    "configurable": true,
	    "enumerable": false,
	    "value": constant(string),
	    "writable": true
	  });
	};
	_baseSetToString = baseSetToString;
	return _baseSetToString;
}

var _shortOut;
var hasRequired_shortOut;

function require_shortOut () {
	if (hasRequired_shortOut) return _shortOut;
	hasRequired_shortOut = 1;
	var HOT_COUNT = 800, HOT_SPAN = 16;
	var nativeNow = Date.now;
	function shortOut(func) {
	  var count = 0, lastCalled = 0;
	  return function() {
	    var stamp = nativeNow(), remaining = HOT_SPAN - (stamp - lastCalled);
	    lastCalled = stamp;
	    if (remaining > 0) {
	      if (++count >= HOT_COUNT) {
	        return arguments[0];
	      }
	    } else {
	      count = 0;
	    }
	    return func.apply(void 0, arguments);
	  };
	}
	_shortOut = shortOut;
	return _shortOut;
}

var _setToString;
var hasRequired_setToString;

function require_setToString () {
	if (hasRequired_setToString) return _setToString;
	hasRequired_setToString = 1;
	var baseSetToString = require_baseSetToString(), shortOut = require_shortOut();
	var setToString = shortOut(baseSetToString);
	_setToString = setToString;
	return _setToString;
}

var _baseRest;
var hasRequired_baseRest;

function require_baseRest () {
	if (hasRequired_baseRest) return _baseRest;
	hasRequired_baseRest = 1;
	var identity = requireIdentity(), overRest = require_overRest(), setToString = require_setToString();
	function baseRest(func, start) {
	  return setToString(overRest(func, start, identity), func + "");
	}
	_baseRest = baseRest;
	return _baseRest;
}

var _isIterateeCall;
var hasRequired_isIterateeCall;

function require_isIterateeCall () {
	if (hasRequired_isIterateeCall) return _isIterateeCall;
	hasRequired_isIterateeCall = 1;
	var eq = requireEq(), isArrayLike = requireIsArrayLike(), isIndex = require_isIndex(), isObject = requireIsObject();
	function isIterateeCall(value, index, object) {
	  if (!isObject(object)) {
	    return false;
	  }
	  var type = typeof index;
	  if (type == "number" ? isArrayLike(object) && isIndex(index, object.length) : type == "string" && index in object) {
	    return eq(object[index], value);
	  }
	  return false;
	}
	_isIterateeCall = isIterateeCall;
	return _isIterateeCall;
}

var _createAssigner;
var hasRequired_createAssigner;

function require_createAssigner () {
	if (hasRequired_createAssigner) return _createAssigner;
	hasRequired_createAssigner = 1;
	var baseRest = require_baseRest(), isIterateeCall = require_isIterateeCall();
	function createAssigner(assigner) {
	  return baseRest(function(object, sources) {
	    var index = -1, length = sources.length, customizer = length > 1 ? sources[length - 1] : void 0, guard = length > 2 ? sources[2] : void 0;
	    customizer = assigner.length > 3 && typeof customizer == "function" ? (length--, customizer) : void 0;
	    if (guard && isIterateeCall(sources[0], sources[1], guard)) {
	      customizer = length < 3 ? void 0 : customizer;
	      length = 1;
	    }
	    object = Object(object);
	    while (++index < length) {
	      var source = sources[index];
	      if (source) {
	        assigner(object, source, index, customizer);
	      }
	    }
	    return object;
	  });
	}
	_createAssigner = createAssigner;
	return _createAssigner;
}

var assign_1;
var hasRequiredAssign;

function requireAssign () {
	if (hasRequiredAssign) return assign_1;
	hasRequiredAssign = 1;
	var assignValue = require_assignValue(), copyObject = require_copyObject(), createAssigner = require_createAssigner(), isArrayLike = requireIsArrayLike(), isPrototype = require_isPrototype(), keys = requireKeys$1();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	var assign = createAssigner(function(object, source) {
	  if (isPrototype(source) || isArrayLike(source)) {
	    copyObject(source, keys(source), object);
	    return;
	  }
	  for (var key in source) {
	    if (hasOwnProperty.call(source, key)) {
	      assignValue(object, key, source[key]);
	    }
	  }
	});
	assign_1 = assign;
	return assign_1;
}

var hasRequiredModel$1;

function requireModel$1 () {
	if (hasRequiredModel$1) return model$1;
	hasRequiredModel$1 = 1;
	var __extends = model$1 && model$1.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __importDefault = model$1 && model$1.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(model$1, "__esModule", { value: true });
	model$1.serializeProduction = model$1.serializeGrammar = model$1.Terminal = model$1.Alternation = model$1.RepetitionWithSeparator = model$1.Repetition = model$1.RepetitionMandatoryWithSeparator = model$1.RepetitionMandatory = model$1.Option = model$1.Alternative = model$1.Rule = model$1.NonTerminal = model$1.AbstractProduction = void 0;
	var map_1 = __importDefault(requireMap());
	var forEach_1 = __importDefault(requireForEach());
	var isString_1 = __importDefault(requireIsString());
	var isRegExp_1 = __importDefault(requireIsRegExp());
	var pickBy_1 = __importDefault(requirePickBy());
	var assign_1 = __importDefault(requireAssign());
	function tokenLabel(tokType) {
	  if (hasTokenLabel(tokType)) {
	    return tokType.LABEL;
	  } else {
	    return tokType.name;
	  }
	}
	function hasTokenLabel(obj) {
	  return (0, isString_1.default)(obj.LABEL) && obj.LABEL !== "";
	}
	var AbstractProduction = (
	  /** @class */
	  (function() {
	    function AbstractProduction2(_definition) {
	      this._definition = _definition;
	    }
	    Object.defineProperty(AbstractProduction2.prototype, "definition", {
	      get: function() {
	        return this._definition;
	      },
	      set: function(value) {
	        this._definition = value;
	      },
	      enumerable: false,
	      configurable: true
	    });
	    AbstractProduction2.prototype.accept = function(visitor) {
	      visitor.visit(this);
	      (0, forEach_1.default)(this.definition, function(prod) {
	        prod.accept(visitor);
	      });
	    };
	    return AbstractProduction2;
	  })()
	);
	model$1.AbstractProduction = AbstractProduction;
	var NonTerminal = (
	  /** @class */
	  (function(_super) {
	    __extends(NonTerminal2, _super);
	    function NonTerminal2(options) {
	      var _this = _super.call(this, []) || this;
	      _this.idx = 1;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    Object.defineProperty(NonTerminal2.prototype, "definition", {
	      get: function() {
	        if (this.referencedRule !== void 0) {
	          return this.referencedRule.definition;
	        }
	        return [];
	      },
	      set: function(definition) {
	      },
	      enumerable: false,
	      configurable: true
	    });
	    NonTerminal2.prototype.accept = function(visitor) {
	      visitor.visit(this);
	    };
	    return NonTerminal2;
	  })(AbstractProduction)
	);
	model$1.NonTerminal = NonTerminal;
	var Rule = (
	  /** @class */
	  (function(_super) {
	    __extends(Rule2, _super);
	    function Rule2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.orgText = "";
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    return Rule2;
	  })(AbstractProduction)
	);
	model$1.Rule = Rule;
	var Alternative = (
	  /** @class */
	  (function(_super) {
	    __extends(Alternative2, _super);
	    function Alternative2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.ignoreAmbiguities = false;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    return Alternative2;
	  })(AbstractProduction)
	);
	model$1.Alternative = Alternative;
	var Option = (
	  /** @class */
	  (function(_super) {
	    __extends(Option2, _super);
	    function Option2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.idx = 1;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    return Option2;
	  })(AbstractProduction)
	);
	model$1.Option = Option;
	var RepetitionMandatory = (
	  /** @class */
	  (function(_super) {
	    __extends(RepetitionMandatory2, _super);
	    function RepetitionMandatory2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.idx = 1;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    return RepetitionMandatory2;
	  })(AbstractProduction)
	);
	model$1.RepetitionMandatory = RepetitionMandatory;
	var RepetitionMandatoryWithSeparator = (
	  /** @class */
	  (function(_super) {
	    __extends(RepetitionMandatoryWithSeparator2, _super);
	    function RepetitionMandatoryWithSeparator2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.idx = 1;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    return RepetitionMandatoryWithSeparator2;
	  })(AbstractProduction)
	);
	model$1.RepetitionMandatoryWithSeparator = RepetitionMandatoryWithSeparator;
	var Repetition = (
	  /** @class */
	  (function(_super) {
	    __extends(Repetition2, _super);
	    function Repetition2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.idx = 1;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    return Repetition2;
	  })(AbstractProduction)
	);
	model$1.Repetition = Repetition;
	var RepetitionWithSeparator = (
	  /** @class */
	  (function(_super) {
	    __extends(RepetitionWithSeparator2, _super);
	    function RepetitionWithSeparator2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.idx = 1;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    return RepetitionWithSeparator2;
	  })(AbstractProduction)
	);
	model$1.RepetitionWithSeparator = RepetitionWithSeparator;
	var Alternation = (
	  /** @class */
	  (function(_super) {
	    __extends(Alternation2, _super);
	    function Alternation2(options) {
	      var _this = _super.call(this, options.definition) || this;
	      _this.idx = 1;
	      _this.ignoreAmbiguities = false;
	      _this.hasPredicates = false;
	      (0, assign_1.default)(_this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	      return _this;
	    }
	    Object.defineProperty(Alternation2.prototype, "definition", {
	      get: function() {
	        return this._definition;
	      },
	      set: function(value) {
	        this._definition = value;
	      },
	      enumerable: false,
	      configurable: true
	    });
	    return Alternation2;
	  })(AbstractProduction)
	);
	model$1.Alternation = Alternation;
	var Terminal = (
	  /** @class */
	  (function() {
	    function Terminal2(options) {
	      this.idx = 1;
	      (0, assign_1.default)(this, (0, pickBy_1.default)(options, function(v) {
	        return v !== void 0;
	      }));
	    }
	    Terminal2.prototype.accept = function(visitor) {
	      visitor.visit(this);
	    };
	    return Terminal2;
	  })()
	);
	model$1.Terminal = Terminal;
	function serializeGrammar(topRules) {
	  return (0, map_1.default)(topRules, serializeProduction);
	}
	model$1.serializeGrammar = serializeGrammar;
	function serializeProduction(node) {
	  function convertDefinition(definition) {
	    return (0, map_1.default)(definition, serializeProduction);
	  }
	  if (node instanceof NonTerminal) {
	    var serializedNonTerminal = {
	      type: "NonTerminal",
	      name: node.nonTerminalName,
	      idx: node.idx
	    };
	    if ((0, isString_1.default)(node.label)) {
	      serializedNonTerminal.label = node.label;
	    }
	    return serializedNonTerminal;
	  } else if (node instanceof Alternative) {
	    return {
	      type: "Alternative",
	      definition: convertDefinition(node.definition)
	    };
	  } else if (node instanceof Option) {
	    return {
	      type: "Option",
	      idx: node.idx,
	      definition: convertDefinition(node.definition)
	    };
	  } else if (node instanceof RepetitionMandatory) {
	    return {
	      type: "RepetitionMandatory",
	      idx: node.idx,
	      definition: convertDefinition(node.definition)
	    };
	  } else if (node instanceof RepetitionMandatoryWithSeparator) {
	    return {
	      type: "RepetitionMandatoryWithSeparator",
	      idx: node.idx,
	      separator: serializeProduction(new Terminal({ terminalType: node.separator })),
	      definition: convertDefinition(node.definition)
	    };
	  } else if (node instanceof RepetitionWithSeparator) {
	    return {
	      type: "RepetitionWithSeparator",
	      idx: node.idx,
	      separator: serializeProduction(new Terminal({ terminalType: node.separator })),
	      definition: convertDefinition(node.definition)
	    };
	  } else if (node instanceof Repetition) {
	    return {
	      type: "Repetition",
	      idx: node.idx,
	      definition: convertDefinition(node.definition)
	    };
	  } else if (node instanceof Alternation) {
	    return {
	      type: "Alternation",
	      idx: node.idx,
	      definition: convertDefinition(node.definition)
	    };
	  } else if (node instanceof Terminal) {
	    var serializedTerminal = {
	      type: "Terminal",
	      name: node.terminalType.name,
	      label: tokenLabel(node.terminalType),
	      idx: node.idx
	    };
	    if ((0, isString_1.default)(node.label)) {
	      serializedTerminal.terminalLabel = node.label;
	    }
	    var pattern = node.terminalType.PATTERN;
	    if (node.terminalType.PATTERN) {
	      serializedTerminal.pattern = (0, isRegExp_1.default)(pattern) ? pattern.source : pattern;
	    }
	    return serializedTerminal;
	  } else if (node instanceof Rule) {
	    return {
	      type: "Rule",
	      name: node.name,
	      orgText: node.orgText,
	      definition: convertDefinition(node.definition)
	    };
	  } else {
	    throw Error("non exhaustive match");
	  }
	}
	model$1.serializeProduction = serializeProduction;
	return model$1;
}

var visitor = {};

var hasRequiredVisitor;

function requireVisitor () {
	if (hasRequiredVisitor) return visitor;
	hasRequiredVisitor = 1;
	Object.defineProperty(visitor, "__esModule", { value: true });
	visitor.GAstVisitor = void 0;
	var model_1 = requireModel$1();
	var GAstVisitor = (
	  /** @class */
	  (function() {
	    function GAstVisitor2() {
	    }
	    GAstVisitor2.prototype.visit = function(node) {
	      var nodeAny = node;
	      switch (nodeAny.constructor) {
	        case model_1.NonTerminal:
	          return this.visitNonTerminal(nodeAny);
	        case model_1.Alternative:
	          return this.visitAlternative(nodeAny);
	        case model_1.Option:
	          return this.visitOption(nodeAny);
	        case model_1.RepetitionMandatory:
	          return this.visitRepetitionMandatory(nodeAny);
	        case model_1.RepetitionMandatoryWithSeparator:
	          return this.visitRepetitionMandatoryWithSeparator(nodeAny);
	        case model_1.RepetitionWithSeparator:
	          return this.visitRepetitionWithSeparator(nodeAny);
	        case model_1.Repetition:
	          return this.visitRepetition(nodeAny);
	        case model_1.Alternation:
	          return this.visitAlternation(nodeAny);
	        case model_1.Terminal:
	          return this.visitTerminal(nodeAny);
	        case model_1.Rule:
	          return this.visitRule(nodeAny);
	        /* istanbul ignore next */
	        default:
	          throw Error("non exhaustive match");
	      }
	    };
	    GAstVisitor2.prototype.visitNonTerminal = function(node) {
	    };
	    GAstVisitor2.prototype.visitAlternative = function(node) {
	    };
	    GAstVisitor2.prototype.visitOption = function(node) {
	    };
	    GAstVisitor2.prototype.visitRepetition = function(node) {
	    };
	    GAstVisitor2.prototype.visitRepetitionMandatory = function(node) {
	    };
	    GAstVisitor2.prototype.visitRepetitionMandatoryWithSeparator = function(node) {
	    };
	    GAstVisitor2.prototype.visitRepetitionWithSeparator = function(node) {
	    };
	    GAstVisitor2.prototype.visitAlternation = function(node) {
	    };
	    GAstVisitor2.prototype.visitTerminal = function(node) {
	    };
	    GAstVisitor2.prototype.visitRule = function(node) {
	    };
	    return GAstVisitor2;
	  })()
	);
	visitor.GAstVisitor = GAstVisitor;
	return visitor;
}

var helpers = {};

var _baseSome;
var hasRequired_baseSome;

function require_baseSome () {
	if (hasRequired_baseSome) return _baseSome;
	hasRequired_baseSome = 1;
	var baseEach = require_baseEach();
	function baseSome(collection, predicate) {
	  var result;
	  baseEach(collection, function(value, index, collection2) {
	    result = predicate(value, index, collection2);
	    return !result;
	  });
	  return !!result;
	}
	_baseSome = baseSome;
	return _baseSome;
}

var some_1;
var hasRequiredSome;

function requireSome () {
	if (hasRequiredSome) return some_1;
	hasRequiredSome = 1;
	var arraySome = require_arraySome(), baseIteratee = require_baseIteratee(), baseSome = require_baseSome(), isArray = requireIsArray(), isIterateeCall = require_isIterateeCall();
	function some(collection, predicate, guard) {
	  var func = isArray(collection) ? arraySome : baseSome;
	  if (guard && isIterateeCall(collection, predicate, guard)) {
	    predicate = void 0;
	  }
	  return func(collection, baseIteratee(predicate, 3));
	}
	some_1 = some;
	return some_1;
}

var _arrayEvery;
var hasRequired_arrayEvery;

function require_arrayEvery () {
	if (hasRequired_arrayEvery) return _arrayEvery;
	hasRequired_arrayEvery = 1;
	function arrayEvery(array, predicate) {
	  var index = -1, length = array == null ? 0 : array.length;
	  while (++index < length) {
	    if (!predicate(array[index], index, array)) {
	      return false;
	    }
	  }
	  return true;
	}
	_arrayEvery = arrayEvery;
	return _arrayEvery;
}

var _baseEvery;
var hasRequired_baseEvery;

function require_baseEvery () {
	if (hasRequired_baseEvery) return _baseEvery;
	hasRequired_baseEvery = 1;
	var baseEach = require_baseEach();
	function baseEvery(collection, predicate) {
	  var result = true;
	  baseEach(collection, function(value, index, collection2) {
	    result = !!predicate(value, index, collection2);
	    return result;
	  });
	  return result;
	}
	_baseEvery = baseEvery;
	return _baseEvery;
}

var every_1;
var hasRequiredEvery;

function requireEvery () {
	if (hasRequiredEvery) return every_1;
	hasRequiredEvery = 1;
	var arrayEvery = require_arrayEvery(), baseEvery = require_baseEvery(), baseIteratee = require_baseIteratee(), isArray = requireIsArray(), isIterateeCall = require_isIterateeCall();
	function every(collection, predicate, guard) {
	  var func = isArray(collection) ? arrayEvery : baseEvery;
	  if (guard && isIterateeCall(collection, predicate, guard)) {
	    predicate = void 0;
	  }
	  return func(collection, baseIteratee(predicate, 3));
	}
	every_1 = every;
	return every_1;
}

var _baseFindIndex;
var hasRequired_baseFindIndex;

function require_baseFindIndex () {
	if (hasRequired_baseFindIndex) return _baseFindIndex;
	hasRequired_baseFindIndex = 1;
	function baseFindIndex(array, predicate, fromIndex, fromRight) {
	  var length = array.length, index = fromIndex + (fromRight ? 1 : -1);
	  while (fromRight ? index-- : ++index < length) {
	    if (predicate(array[index], index, array)) {
	      return index;
	    }
	  }
	  return -1;
	}
	_baseFindIndex = baseFindIndex;
	return _baseFindIndex;
}

var _baseIsNaN;
var hasRequired_baseIsNaN;

function require_baseIsNaN () {
	if (hasRequired_baseIsNaN) return _baseIsNaN;
	hasRequired_baseIsNaN = 1;
	function baseIsNaN(value) {
	  return value !== value;
	}
	_baseIsNaN = baseIsNaN;
	return _baseIsNaN;
}

var _strictIndexOf;
var hasRequired_strictIndexOf;

function require_strictIndexOf () {
	if (hasRequired_strictIndexOf) return _strictIndexOf;
	hasRequired_strictIndexOf = 1;
	function strictIndexOf(array, value, fromIndex) {
	  var index = fromIndex - 1, length = array.length;
	  while (++index < length) {
	    if (array[index] === value) {
	      return index;
	    }
	  }
	  return -1;
	}
	_strictIndexOf = strictIndexOf;
	return _strictIndexOf;
}

var _baseIndexOf;
var hasRequired_baseIndexOf;

function require_baseIndexOf () {
	if (hasRequired_baseIndexOf) return _baseIndexOf;
	hasRequired_baseIndexOf = 1;
	var baseFindIndex = require_baseFindIndex(), baseIsNaN = require_baseIsNaN(), strictIndexOf = require_strictIndexOf();
	function baseIndexOf(array, value, fromIndex) {
	  return value === value ? strictIndexOf(array, value, fromIndex) : baseFindIndex(array, baseIsNaN, fromIndex);
	}
	_baseIndexOf = baseIndexOf;
	return _baseIndexOf;
}

var includes_1;
var hasRequiredIncludes;

function requireIncludes () {
	if (hasRequiredIncludes) return includes_1;
	hasRequiredIncludes = 1;
	var baseIndexOf = require_baseIndexOf(), isArrayLike = requireIsArrayLike(), isString = requireIsString(), toInteger = requireToInteger(), values = requireValues();
	var nativeMax = Math.max;
	function includes(collection, value, fromIndex, guard) {
	  collection = isArrayLike(collection) ? collection : values(collection);
	  fromIndex = fromIndex && !guard ? toInteger(fromIndex) : 0;
	  var length = collection.length;
	  if (fromIndex < 0) {
	    fromIndex = nativeMax(length + fromIndex, 0);
	  }
	  return isString(collection) ? fromIndex <= length && collection.indexOf(value, fromIndex) > -1 : !!length && baseIndexOf(collection, value, fromIndex) > -1;
	}
	includes_1 = includes;
	return includes_1;
}

var hasRequiredHelpers;

function requireHelpers () {
	if (hasRequiredHelpers) return helpers;
	hasRequiredHelpers = 1;
	var __importDefault = helpers && helpers.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(helpers, "__esModule", { value: true });
	helpers.getProductionDslName = helpers.isBranchingProd = helpers.isOptionalProd = helpers.isSequenceProd = void 0;
	var some_1 = __importDefault(requireSome());
	var every_1 = __importDefault(requireEvery());
	var includes_1 = __importDefault(requireIncludes());
	var model_1 = requireModel$1();
	function isSequenceProd(prod) {
	  return prod instanceof model_1.Alternative || prod instanceof model_1.Option || prod instanceof model_1.Repetition || prod instanceof model_1.RepetitionMandatory || prod instanceof model_1.RepetitionMandatoryWithSeparator || prod instanceof model_1.RepetitionWithSeparator || prod instanceof model_1.Terminal || prod instanceof model_1.Rule;
	}
	helpers.isSequenceProd = isSequenceProd;
	function isOptionalProd(prod, alreadyVisited) {
	  if (alreadyVisited === void 0) {
	    alreadyVisited = [];
	  }
	  var isDirectlyOptional = prod instanceof model_1.Option || prod instanceof model_1.Repetition || prod instanceof model_1.RepetitionWithSeparator;
	  if (isDirectlyOptional) {
	    return true;
	  }
	  if (prod instanceof model_1.Alternation) {
	    return (0, some_1.default)(prod.definition, function(subProd) {
	      return isOptionalProd(subProd, alreadyVisited);
	    });
	  } else if (prod instanceof model_1.NonTerminal && (0, includes_1.default)(alreadyVisited, prod)) {
	    return false;
	  } else if (prod instanceof model_1.AbstractProduction) {
	    if (prod instanceof model_1.NonTerminal) {
	      alreadyVisited.push(prod);
	    }
	    return (0, every_1.default)(prod.definition, function(subProd) {
	      return isOptionalProd(subProd, alreadyVisited);
	    });
	  } else {
	    return false;
	  }
	}
	helpers.isOptionalProd = isOptionalProd;
	function isBranchingProd(prod) {
	  return prod instanceof model_1.Alternation;
	}
	helpers.isBranchingProd = isBranchingProd;
	function getProductionDslName(prod) {
	  if (prod instanceof model_1.NonTerminal) {
	    return "SUBRULE";
	  } else if (prod instanceof model_1.Option) {
	    return "OPTION";
	  } else if (prod instanceof model_1.Alternation) {
	    return "OR";
	  } else if (prod instanceof model_1.RepetitionMandatory) {
	    return "AT_LEAST_ONE";
	  } else if (prod instanceof model_1.RepetitionMandatoryWithSeparator) {
	    return "AT_LEAST_ONE_SEP";
	  } else if (prod instanceof model_1.RepetitionWithSeparator) {
	    return "MANY_SEP";
	  } else if (prod instanceof model_1.Repetition) {
	    return "MANY";
	  } else if (prod instanceof model_1.Terminal) {
	    return "CONSUME";
	  } else {
	    throw Error("non exhaustive match");
	  }
	}
	helpers.getProductionDslName = getProductionDslName;
	return helpers;
}

var hasRequiredApi$2;

function requireApi$2 () {
	if (hasRequiredApi$2) return api$1;
	hasRequiredApi$2 = 1;
	(function (exports$1) {
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.isSequenceProd = exports$1.isBranchingProd = exports$1.isOptionalProd = exports$1.getProductionDslName = exports$1.GAstVisitor = exports$1.serializeProduction = exports$1.serializeGrammar = exports$1.Alternative = exports$1.Alternation = exports$1.RepetitionWithSeparator = exports$1.RepetitionMandatoryWithSeparator = exports$1.RepetitionMandatory = exports$1.Repetition = exports$1.Option = exports$1.NonTerminal = exports$1.Terminal = exports$1.Rule = void 0;
		var model_1 = requireModel$1();
		Object.defineProperty(exports$1, "Rule", { enumerable: true, get: function() {
		  return model_1.Rule;
		} });
		Object.defineProperty(exports$1, "Terminal", { enumerable: true, get: function() {
		  return model_1.Terminal;
		} });
		Object.defineProperty(exports$1, "NonTerminal", { enumerable: true, get: function() {
		  return model_1.NonTerminal;
		} });
		Object.defineProperty(exports$1, "Option", { enumerable: true, get: function() {
		  return model_1.Option;
		} });
		Object.defineProperty(exports$1, "Repetition", { enumerable: true, get: function() {
		  return model_1.Repetition;
		} });
		Object.defineProperty(exports$1, "RepetitionMandatory", { enumerable: true, get: function() {
		  return model_1.RepetitionMandatory;
		} });
		Object.defineProperty(exports$1, "RepetitionMandatoryWithSeparator", { enumerable: true, get: function() {
		  return model_1.RepetitionMandatoryWithSeparator;
		} });
		Object.defineProperty(exports$1, "RepetitionWithSeparator", { enumerable: true, get: function() {
		  return model_1.RepetitionWithSeparator;
		} });
		Object.defineProperty(exports$1, "Alternation", { enumerable: true, get: function() {
		  return model_1.Alternation;
		} });
		Object.defineProperty(exports$1, "Alternative", { enumerable: true, get: function() {
		  return model_1.Alternative;
		} });
		Object.defineProperty(exports$1, "serializeGrammar", { enumerable: true, get: function() {
		  return model_1.serializeGrammar;
		} });
		Object.defineProperty(exports$1, "serializeProduction", { enumerable: true, get: function() {
		  return model_1.serializeProduction;
		} });
		var visitor_1 = requireVisitor();
		Object.defineProperty(exports$1, "GAstVisitor", { enumerable: true, get: function() {
		  return visitor_1.GAstVisitor;
		} });
		var helpers_1 = requireHelpers();
		Object.defineProperty(exports$1, "getProductionDslName", { enumerable: true, get: function() {
		  return helpers_1.getProductionDslName;
		} });
		Object.defineProperty(exports$1, "isOptionalProd", { enumerable: true, get: function() {
		  return helpers_1.isOptionalProd;
		} });
		Object.defineProperty(exports$1, "isBranchingProd", { enumerable: true, get: function() {
		  return helpers_1.isBranchingProd;
		} });
		Object.defineProperty(exports$1, "isSequenceProd", { enumerable: true, get: function() {
		  return helpers_1.isSequenceProd;
		} }); 
	} (api$1));
	return api$1;
}

var hasRequiredRest;

function requireRest () {
	if (hasRequiredRest) return rest;
	hasRequiredRest = 1;
	var __importDefault = rest && rest.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(rest, "__esModule", { value: true });
	rest.RestWalker = void 0;
	var drop_1 = __importDefault(requireDrop());
	var forEach_1 = __importDefault(requireForEach());
	var gast_1 = requireApi$2();
	var RestWalker = (
	  /** @class */
	  (function() {
	    function RestWalker2() {
	    }
	    RestWalker2.prototype.walk = function(prod, prevRest) {
	      var _this = this;
	      if (prevRest === void 0) {
	        prevRest = [];
	      }
	      (0, forEach_1.default)(prod.definition, function(subProd, index) {
	        var currRest = (0, drop_1.default)(prod.definition, index + 1);
	        if (subProd instanceof gast_1.NonTerminal) {
	          _this.walkProdRef(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.Terminal) {
	          _this.walkTerminal(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.Alternative) {
	          _this.walkFlat(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.Option) {
	          _this.walkOption(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.RepetitionMandatory) {
	          _this.walkAtLeastOne(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.RepetitionMandatoryWithSeparator) {
	          _this.walkAtLeastOneSep(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.RepetitionWithSeparator) {
	          _this.walkManySep(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.Repetition) {
	          _this.walkMany(subProd, currRest, prevRest);
	        } else if (subProd instanceof gast_1.Alternation) {
	          _this.walkOr(subProd, currRest, prevRest);
	        } else {
	          throw Error("non exhaustive match");
	        }
	      });
	    };
	    RestWalker2.prototype.walkTerminal = function(terminal, currRest, prevRest) {
	    };
	    RestWalker2.prototype.walkProdRef = function(refProd, currRest, prevRest) {
	    };
	    RestWalker2.prototype.walkFlat = function(flatProd, currRest, prevRest) {
	      var fullOrRest = currRest.concat(prevRest);
	      this.walk(flatProd, fullOrRest);
	    };
	    RestWalker2.prototype.walkOption = function(optionProd, currRest, prevRest) {
	      var fullOrRest = currRest.concat(prevRest);
	      this.walk(optionProd, fullOrRest);
	    };
	    RestWalker2.prototype.walkAtLeastOne = function(atLeastOneProd, currRest, prevRest) {
	      var fullAtLeastOneRest = [
	        new gast_1.Option({ definition: atLeastOneProd.definition })
	      ].concat(currRest, prevRest);
	      this.walk(atLeastOneProd, fullAtLeastOneRest);
	    };
	    RestWalker2.prototype.walkAtLeastOneSep = function(atLeastOneSepProd, currRest, prevRest) {
	      var fullAtLeastOneSepRest = restForRepetitionWithSeparator(atLeastOneSepProd, currRest, prevRest);
	      this.walk(atLeastOneSepProd, fullAtLeastOneSepRest);
	    };
	    RestWalker2.prototype.walkMany = function(manyProd, currRest, prevRest) {
	      var fullManyRest = [
	        new gast_1.Option({ definition: manyProd.definition })
	      ].concat(currRest, prevRest);
	      this.walk(manyProd, fullManyRest);
	    };
	    RestWalker2.prototype.walkManySep = function(manySepProd, currRest, prevRest) {
	      var fullManySepRest = restForRepetitionWithSeparator(manySepProd, currRest, prevRest);
	      this.walk(manySepProd, fullManySepRest);
	    };
	    RestWalker2.prototype.walkOr = function(orProd, currRest, prevRest) {
	      var _this = this;
	      var fullOrRest = currRest.concat(prevRest);
	      (0, forEach_1.default)(orProd.definition, function(alt) {
	        var prodWrapper = new gast_1.Alternative({ definition: [alt] });
	        _this.walk(prodWrapper, fullOrRest);
	      });
	    };
	    return RestWalker2;
	  })()
	);
	rest.RestWalker = RestWalker;
	function restForRepetitionWithSeparator(repSepProd, currRest, prevRest) {
	  var repSepRest = [
	    new gast_1.Option({
	      definition: [
	        new gast_1.Terminal({ terminalType: repSepProd.separator })
	      ].concat(repSepProd.definition)
	    })
	  ];
	  var fullRepSepRest = repSepRest.concat(currRest, prevRest);
	  return fullRepSepRest;
	}
	return rest;
}

var first$1 = {};

var _isFlattenable;
var hasRequired_isFlattenable;

function require_isFlattenable () {
	if (hasRequired_isFlattenable) return _isFlattenable;
	hasRequired_isFlattenable = 1;
	var Symbol = require_Symbol(), isArguments = requireIsArguments(), isArray = requireIsArray();
	var spreadableSymbol = Symbol ? Symbol.isConcatSpreadable : void 0;
	function isFlattenable(value) {
	  return isArray(value) || isArguments(value) || !!(spreadableSymbol && value && value[spreadableSymbol]);
	}
	_isFlattenable = isFlattenable;
	return _isFlattenable;
}

var _baseFlatten;
var hasRequired_baseFlatten;

function require_baseFlatten () {
	if (hasRequired_baseFlatten) return _baseFlatten;
	hasRequired_baseFlatten = 1;
	var arrayPush = require_arrayPush(), isFlattenable = require_isFlattenable();
	function baseFlatten(array, depth, predicate, isStrict, result) {
	  var index = -1, length = array.length;
	  predicate || (predicate = isFlattenable);
	  result || (result = []);
	  while (++index < length) {
	    var value = array[index];
	    if (depth > 0 && predicate(value)) {
	      if (depth > 1) {
	        baseFlatten(value, depth - 1, predicate, isStrict, result);
	      } else {
	        arrayPush(result, value);
	      }
	    } else if (!isStrict) {
	      result[result.length] = value;
	    }
	  }
	  return result;
	}
	_baseFlatten = baseFlatten;
	return _baseFlatten;
}

var flatten_1;
var hasRequiredFlatten;

function requireFlatten () {
	if (hasRequiredFlatten) return flatten_1;
	hasRequiredFlatten = 1;
	var baseFlatten = require_baseFlatten();
	function flatten(array) {
	  var length = array == null ? 0 : array.length;
	  return length ? baseFlatten(array, 1) : [];
	}
	flatten_1 = flatten;
	return flatten_1;
}

var _arrayIncludes;
var hasRequired_arrayIncludes;

function require_arrayIncludes () {
	if (hasRequired_arrayIncludes) return _arrayIncludes;
	hasRequired_arrayIncludes = 1;
	var baseIndexOf = require_baseIndexOf();
	function arrayIncludes(array, value) {
	  var length = array == null ? 0 : array.length;
	  return !!length && baseIndexOf(array, value, 0) > -1;
	}
	_arrayIncludes = arrayIncludes;
	return _arrayIncludes;
}

var _arrayIncludesWith;
var hasRequired_arrayIncludesWith;

function require_arrayIncludesWith () {
	if (hasRequired_arrayIncludesWith) return _arrayIncludesWith;
	hasRequired_arrayIncludesWith = 1;
	function arrayIncludesWith(array, value, comparator) {
	  var index = -1, length = array == null ? 0 : array.length;
	  while (++index < length) {
	    if (comparator(value, array[index])) {
	      return true;
	    }
	  }
	  return false;
	}
	_arrayIncludesWith = arrayIncludesWith;
	return _arrayIncludesWith;
}

var noop_1;
var hasRequiredNoop;

function requireNoop () {
	if (hasRequiredNoop) return noop_1;
	hasRequiredNoop = 1;
	function noop() {
	}
	noop_1 = noop;
	return noop_1;
}

var _createSet;
var hasRequired_createSet;

function require_createSet () {
	if (hasRequired_createSet) return _createSet;
	hasRequired_createSet = 1;
	var Set = require_Set(), noop = requireNoop(), setToArray = require_setToArray();
	var INFINITY = 1 / 0;
	var createSet = !(Set && 1 / setToArray(new Set([, -0]))[1] == INFINITY) ? noop : function(values) {
	  return new Set(values);
	};
	_createSet = createSet;
	return _createSet;
}

var _baseUniq;
var hasRequired_baseUniq;

function require_baseUniq () {
	if (hasRequired_baseUniq) return _baseUniq;
	hasRequired_baseUniq = 1;
	var SetCache = require_SetCache(), arrayIncludes = require_arrayIncludes(), arrayIncludesWith = require_arrayIncludesWith(), cacheHas = require_cacheHas(), createSet = require_createSet(), setToArray = require_setToArray();
	var LARGE_ARRAY_SIZE = 200;
	function baseUniq(array, iteratee, comparator) {
	  var index = -1, includes = arrayIncludes, length = array.length, isCommon = true, result = [], seen = result;
	  if (comparator) {
	    isCommon = false;
	    includes = arrayIncludesWith;
	  } else if (length >= LARGE_ARRAY_SIZE) {
	    var set = iteratee ? null : createSet(array);
	    if (set) {
	      return setToArray(set);
	    }
	    isCommon = false;
	    includes = cacheHas;
	    seen = new SetCache();
	  } else {
	    seen = iteratee ? [] : result;
	  }
	  outer:
	    while (++index < length) {
	      var value = array[index], computed = iteratee ? iteratee(value) : value;
	      value = comparator || value !== 0 ? value : 0;
	      if (isCommon && computed === computed) {
	        var seenIndex = seen.length;
	        while (seenIndex--) {
	          if (seen[seenIndex] === computed) {
	            continue outer;
	          }
	        }
	        if (iteratee) {
	          seen.push(computed);
	        }
	        result.push(value);
	      } else if (!includes(seen, computed, comparator)) {
	        if (seen !== result) {
	          seen.push(computed);
	        }
	        result.push(value);
	      }
	    }
	  return result;
	}
	_baseUniq = baseUniq;
	return _baseUniq;
}

var uniq_1;
var hasRequiredUniq;

function requireUniq () {
	if (hasRequiredUniq) return uniq_1;
	hasRequiredUniq = 1;
	var baseUniq = require_baseUniq();
	function uniq(array) {
	  return array && array.length ? baseUniq(array) : [];
	}
	uniq_1 = uniq;
	return uniq_1;
}

var hasRequiredFirst$1;

function requireFirst$1 () {
	if (hasRequiredFirst$1) return first$1;
	hasRequiredFirst$1 = 1;
	var __importDefault = first$1 && first$1.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(first$1, "__esModule", { value: true });
	first$1.firstForTerminal = first$1.firstForBranching = first$1.firstForSequence = first$1.first = void 0;
	var flatten_1 = __importDefault(requireFlatten());
	var uniq_1 = __importDefault(requireUniq());
	var map_1 = __importDefault(requireMap());
	var gast_1 = requireApi$2();
	var gast_2 = requireApi$2();
	function first(prod) {
	  if (prod instanceof gast_1.NonTerminal) {
	    return first(prod.referencedRule);
	  } else if (prod instanceof gast_1.Terminal) {
	    return firstForTerminal(prod);
	  } else if ((0, gast_2.isSequenceProd)(prod)) {
	    return firstForSequence(prod);
	  } else if ((0, gast_2.isBranchingProd)(prod)) {
	    return firstForBranching(prod);
	  } else {
	    throw Error("non exhaustive match");
	  }
	}
	first$1.first = first;
	function firstForSequence(prod) {
	  var firstSet = [];
	  var seq = prod.definition;
	  var nextSubProdIdx = 0;
	  var hasInnerProdsRemaining = seq.length > nextSubProdIdx;
	  var currSubProd;
	  var isLastInnerProdOptional = true;
	  while (hasInnerProdsRemaining && isLastInnerProdOptional) {
	    currSubProd = seq[nextSubProdIdx];
	    isLastInnerProdOptional = (0, gast_2.isOptionalProd)(currSubProd);
	    firstSet = firstSet.concat(first(currSubProd));
	    nextSubProdIdx = nextSubProdIdx + 1;
	    hasInnerProdsRemaining = seq.length > nextSubProdIdx;
	  }
	  return (0, uniq_1.default)(firstSet);
	}
	first$1.firstForSequence = firstForSequence;
	function firstForBranching(prod) {
	  var allAlternativesFirsts = (0, map_1.default)(prod.definition, function(innerProd) {
	    return first(innerProd);
	  });
	  return (0, uniq_1.default)((0, flatten_1.default)(allAlternativesFirsts));
	}
	first$1.firstForBranching = firstForBranching;
	function firstForTerminal(terminal) {
	  return [terminal.terminalType];
	}
	first$1.firstForTerminal = firstForTerminal;
	return first$1;
}

var constants = {};

var hasRequiredConstants;

function requireConstants () {
	if (hasRequiredConstants) return constants;
	hasRequiredConstants = 1;
	Object.defineProperty(constants, "__esModule", { value: true });
	constants.IN = void 0;
	constants.IN = "_~IN~_";
	return constants;
}

var hasRequiredFollow;

function requireFollow () {
	if (hasRequiredFollow) return follow;
	hasRequiredFollow = 1;
	var __extends = follow && follow.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __importDefault = follow && follow.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(follow, "__esModule", { value: true });
	follow.buildInProdFollowPrefix = follow.buildBetweenProdsFollowPrefix = follow.computeAllProdsFollows = follow.ResyncFollowsWalker = void 0;
	var rest_1 = requireRest();
	var first_1 = requireFirst$1();
	var forEach_1 = __importDefault(requireForEach());
	var assign_1 = __importDefault(requireAssign());
	var constants_1 = requireConstants();
	var gast_1 = requireApi$2();
	var ResyncFollowsWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(ResyncFollowsWalker2, _super);
	    function ResyncFollowsWalker2(topProd) {
	      var _this = _super.call(this) || this;
	      _this.topProd = topProd;
	      _this.follows = {};
	      return _this;
	    }
	    ResyncFollowsWalker2.prototype.startWalking = function() {
	      this.walk(this.topProd);
	      return this.follows;
	    };
	    ResyncFollowsWalker2.prototype.walkTerminal = function(terminal, currRest, prevRest) {
	    };
	    ResyncFollowsWalker2.prototype.walkProdRef = function(refProd, currRest, prevRest) {
	      var followName = buildBetweenProdsFollowPrefix(refProd.referencedRule, refProd.idx) + this.topProd.name;
	      var fullRest = currRest.concat(prevRest);
	      var restProd = new gast_1.Alternative({ definition: fullRest });
	      var t_in_topProd_follows = (0, first_1.first)(restProd);
	      this.follows[followName] = t_in_topProd_follows;
	    };
	    return ResyncFollowsWalker2;
	  })(rest_1.RestWalker)
	);
	follow.ResyncFollowsWalker = ResyncFollowsWalker;
	function computeAllProdsFollows(topProductions) {
	  var reSyncFollows = {};
	  (0, forEach_1.default)(topProductions, function(topProd) {
	    var currRefsFollow = new ResyncFollowsWalker(topProd).startWalking();
	    (0, assign_1.default)(reSyncFollows, currRefsFollow);
	  });
	  return reSyncFollows;
	}
	follow.computeAllProdsFollows = computeAllProdsFollows;
	function buildBetweenProdsFollowPrefix(inner, occurenceInParent) {
	  return inner.name + occurenceInParent + constants_1.IN;
	}
	follow.buildBetweenProdsFollowPrefix = buildBetweenProdsFollowPrefix;
	function buildInProdFollowPrefix(terminal) {
	  var terminalName = terminal.terminalType.name;
	  return terminalName + terminal.idx + constants_1.IN;
	}
	follow.buildInProdFollowPrefix = buildInProdFollowPrefix;
	return follow;
}

var tokens_public = {};

var isUndefined_1;
var hasRequiredIsUndefined;

function requireIsUndefined () {
	if (hasRequiredIsUndefined) return isUndefined_1;
	hasRequiredIsUndefined = 1;
	function isUndefined(value) {
	  return value === void 0;
	}
	isUndefined_1 = isUndefined;
	return isUndefined_1;
}

var lexer_public = {};

var lexer = {};

var regexpToAst$1 = {exports: {}};

var regexpToAst = regexpToAst$1.exports;

var hasRequiredRegexpToAst;

function requireRegexpToAst () {
	if (hasRequiredRegexpToAst) return regexpToAst$1.exports;
	hasRequiredRegexpToAst = 1;
	(function (module) {
		(function(root, factory) {
		  if (module.exports) {
		    module.exports = factory();
		  } else {
		    root.regexpToAst = factory();
		  }
		})(
		  typeof self !== "undefined" ? (
		    // istanbul ignore next
		    self
		  ) : regexpToAst,
		  function() {
		    function RegExpParser() {
		    }
		    RegExpParser.prototype.saveState = function() {
		      return {
		        idx: this.idx,
		        input: this.input,
		        groupIdx: this.groupIdx
		      };
		    };
		    RegExpParser.prototype.restoreState = function(newState) {
		      this.idx = newState.idx;
		      this.input = newState.input;
		      this.groupIdx = newState.groupIdx;
		    };
		    RegExpParser.prototype.pattern = function(input) {
		      this.idx = 0;
		      this.input = input;
		      this.groupIdx = 0;
		      this.consumeChar("/");
		      var value = this.disjunction();
		      this.consumeChar("/");
		      var flags = {
		        type: "Flags",
		        loc: { begin: this.idx, end: input.length },
		        global: false,
		        ignoreCase: false,
		        multiLine: false,
		        unicode: false,
		        sticky: false
		      };
		      while (this.isRegExpFlag()) {
		        switch (this.popChar()) {
		          case "g":
		            addFlag(flags, "global");
		            break;
		          case "i":
		            addFlag(flags, "ignoreCase");
		            break;
		          case "m":
		            addFlag(flags, "multiLine");
		            break;
		          case "u":
		            addFlag(flags, "unicode");
		            break;
		          case "y":
		            addFlag(flags, "sticky");
		            break;
		        }
		      }
		      if (this.idx !== this.input.length) {
		        throw Error(
		          "Redundant input: " + this.input.substring(this.idx)
		        );
		      }
		      return {
		        type: "Pattern",
		        flags,
		        value,
		        loc: this.loc(0)
		      };
		    };
		    RegExpParser.prototype.disjunction = function() {
		      var alts = [];
		      var begin = this.idx;
		      alts.push(this.alternative());
		      while (this.peekChar() === "|") {
		        this.consumeChar("|");
		        alts.push(this.alternative());
		      }
		      return { type: "Disjunction", value: alts, loc: this.loc(begin) };
		    };
		    RegExpParser.prototype.alternative = function() {
		      var terms = [];
		      var begin = this.idx;
		      while (this.isTerm()) {
		        terms.push(this.term());
		      }
		      return { type: "Alternative", value: terms, loc: this.loc(begin) };
		    };
		    RegExpParser.prototype.term = function() {
		      if (this.isAssertion()) {
		        return this.assertion();
		      } else {
		        return this.atom();
		      }
		    };
		    RegExpParser.prototype.assertion = function() {
		      var begin = this.idx;
		      switch (this.popChar()) {
		        case "^":
		          return {
		            type: "StartAnchor",
		            loc: this.loc(begin)
		          };
		        case "$":
		          return { type: "EndAnchor", loc: this.loc(begin) };
		        // '\b' or '\B'
		        case "\\":
		          switch (this.popChar()) {
		            case "b":
		              return {
		                type: "WordBoundary",
		                loc: this.loc(begin)
		              };
		            case "B":
		              return {
		                type: "NonWordBoundary",
		                loc: this.loc(begin)
		              };
		          }
		          throw Error("Invalid Assertion Escape");
		        // '(?=' or '(?!'
		        case "(":
		          this.consumeChar("?");
		          var type;
		          switch (this.popChar()) {
		            case "=":
		              type = "Lookahead";
		              break;
		            case "!":
		              type = "NegativeLookahead";
		              break;
		          }
		          ASSERT_EXISTS(type);
		          var disjunction = this.disjunction();
		          this.consumeChar(")");
		          return {
		            type,
		            value: disjunction,
		            loc: this.loc(begin)
		          };
		      }
		      ASSERT_NEVER_REACH_HERE();
		    };
		    RegExpParser.prototype.quantifier = function(isBacktracking) {
		      var range;
		      var begin = this.idx;
		      switch (this.popChar()) {
		        case "*":
		          range = {
		            atLeast: 0,
		            atMost: Infinity
		          };
		          break;
		        case "+":
		          range = {
		            atLeast: 1,
		            atMost: Infinity
		          };
		          break;
		        case "?":
		          range = {
		            atLeast: 0,
		            atMost: 1
		          };
		          break;
		        case "{":
		          var atLeast = this.integerIncludingZero();
		          switch (this.popChar()) {
		            case "}":
		              range = {
		                atLeast,
		                atMost: atLeast
		              };
		              break;
		            case ",":
		              var atMost;
		              if (this.isDigit()) {
		                atMost = this.integerIncludingZero();
		                range = {
		                  atLeast,
		                  atMost
		                };
		              } else {
		                range = {
		                  atLeast,
		                  atMost: Infinity
		                };
		              }
		              this.consumeChar("}");
		              break;
		          }
		          if (isBacktracking === true && range === void 0) {
		            return void 0;
		          }
		          ASSERT_EXISTS(range);
		          break;
		      }
		      if (isBacktracking === true && range === void 0) {
		        return void 0;
		      }
		      ASSERT_EXISTS(range);
		      if (this.peekChar(0) === "?") {
		        this.consumeChar("?");
		        range.greedy = false;
		      } else {
		        range.greedy = true;
		      }
		      range.type = "Quantifier";
		      range.loc = this.loc(begin);
		      return range;
		    };
		    RegExpParser.prototype.atom = function() {
		      var atom;
		      var begin = this.idx;
		      switch (this.peekChar()) {
		        case ".":
		          atom = this.dotAll();
		          break;
		        case "\\":
		          atom = this.atomEscape();
		          break;
		        case "[":
		          atom = this.characterClass();
		          break;
		        case "(":
		          atom = this.group();
		          break;
		      }
		      if (atom === void 0 && this.isPatternCharacter()) {
		        atom = this.patternCharacter();
		      }
		      ASSERT_EXISTS(atom);
		      atom.loc = this.loc(begin);
		      if (this.isQuantifier()) {
		        atom.quantifier = this.quantifier();
		      }
		      return atom;
		    };
		    RegExpParser.prototype.dotAll = function() {
		      this.consumeChar(".");
		      return {
		        type: "Set",
		        complement: true,
		        value: [cc("\n"), cc("\r"), cc("\u2028"), cc("\u2029")]
		      };
		    };
		    RegExpParser.prototype.atomEscape = function() {
		      this.consumeChar("\\");
		      switch (this.peekChar()) {
		        case "1":
		        case "2":
		        case "3":
		        case "4":
		        case "5":
		        case "6":
		        case "7":
		        case "8":
		        case "9":
		          return this.decimalEscapeAtom();
		        case "d":
		        case "D":
		        case "s":
		        case "S":
		        case "w":
		        case "W":
		          return this.characterClassEscape();
		        case "f":
		        case "n":
		        case "r":
		        case "t":
		        case "v":
		          return this.controlEscapeAtom();
		        case "c":
		          return this.controlLetterEscapeAtom();
		        case "0":
		          return this.nulCharacterAtom();
		        case "x":
		          return this.hexEscapeSequenceAtom();
		        case "u":
		          return this.regExpUnicodeEscapeSequenceAtom();
		        default:
		          return this.identityEscapeAtom();
		      }
		    };
		    RegExpParser.prototype.decimalEscapeAtom = function() {
		      var value = this.positiveInteger();
		      return { type: "GroupBackReference", value };
		    };
		    RegExpParser.prototype.characterClassEscape = function() {
		      var set;
		      var complement = false;
		      switch (this.popChar()) {
		        case "d":
		          set = digitsCharCodes;
		          break;
		        case "D":
		          set = digitsCharCodes;
		          complement = true;
		          break;
		        case "s":
		          set = whitespaceCodes;
		          break;
		        case "S":
		          set = whitespaceCodes;
		          complement = true;
		          break;
		        case "w":
		          set = wordCharCodes;
		          break;
		        case "W":
		          set = wordCharCodes;
		          complement = true;
		          break;
		      }
		      ASSERT_EXISTS(set);
		      return { type: "Set", value: set, complement };
		    };
		    RegExpParser.prototype.controlEscapeAtom = function() {
		      var escapeCode;
		      switch (this.popChar()) {
		        case "f":
		          escapeCode = cc("\f");
		          break;
		        case "n":
		          escapeCode = cc("\n");
		          break;
		        case "r":
		          escapeCode = cc("\r");
		          break;
		        case "t":
		          escapeCode = cc("	");
		          break;
		        case "v":
		          escapeCode = cc("\v");
		          break;
		      }
		      ASSERT_EXISTS(escapeCode);
		      return { type: "Character", value: escapeCode };
		    };
		    RegExpParser.prototype.controlLetterEscapeAtom = function() {
		      this.consumeChar("c");
		      var letter = this.popChar();
		      if (/[a-zA-Z]/.test(letter) === false) {
		        throw Error("Invalid ");
		      }
		      var letterCode = letter.toUpperCase().charCodeAt(0) - 64;
		      return { type: "Character", value: letterCode };
		    };
		    RegExpParser.prototype.nulCharacterAtom = function() {
		      this.consumeChar("0");
		      return { type: "Character", value: cc("\0") };
		    };
		    RegExpParser.prototype.hexEscapeSequenceAtom = function() {
		      this.consumeChar("x");
		      return this.parseHexDigits(2);
		    };
		    RegExpParser.prototype.regExpUnicodeEscapeSequenceAtom = function() {
		      this.consumeChar("u");
		      return this.parseHexDigits(4);
		    };
		    RegExpParser.prototype.identityEscapeAtom = function() {
		      var escapedChar = this.popChar();
		      return { type: "Character", value: cc(escapedChar) };
		    };
		    RegExpParser.prototype.classPatternCharacterAtom = function() {
		      switch (this.peekChar()) {
		        // istanbul ignore next
		        case "\n":
		        // istanbul ignore next
		        case "\r":
		        // istanbul ignore next
		        case "\u2028":
		        // istanbul ignore next
		        case "\u2029":
		        // istanbul ignore next
		        case "\\":
		        // istanbul ignore next
		        case "]":
		          throw Error("TBD");
		        default:
		          var nextChar = this.popChar();
		          return { type: "Character", value: cc(nextChar) };
		      }
		    };
		    RegExpParser.prototype.characterClass = function() {
		      var set = [];
		      var complement = false;
		      this.consumeChar("[");
		      if (this.peekChar(0) === "^") {
		        this.consumeChar("^");
		        complement = true;
		      }
		      while (this.isClassAtom()) {
		        var from = this.classAtom();
		        var isFromSingleChar = from.type === "Character";
		        if (isFromSingleChar && this.isRangeDash()) {
		          this.consumeChar("-");
		          var to = this.classAtom();
		          var isToSingleChar = to.type === "Character";
		          if (isToSingleChar) {
		            if (to.value < from.value) {
		              throw Error("Range out of order in character class");
		            }
		            set.push({ from: from.value, to: to.value });
		          } else {
		            insertToSet(from.value, set);
		            set.push(cc("-"));
		            insertToSet(to.value, set);
		          }
		        } else {
		          insertToSet(from.value, set);
		        }
		      }
		      this.consumeChar("]");
		      return { type: "Set", complement, value: set };
		    };
		    RegExpParser.prototype.classAtom = function() {
		      switch (this.peekChar()) {
		        // istanbul ignore next
		        case "]":
		        // istanbul ignore next
		        case "\n":
		        // istanbul ignore next
		        case "\r":
		        // istanbul ignore next
		        case "\u2028":
		        // istanbul ignore next
		        case "\u2029":
		          throw Error("TBD");
		        case "\\":
		          return this.classEscape();
		        default:
		          return this.classPatternCharacterAtom();
		      }
		    };
		    RegExpParser.prototype.classEscape = function() {
		      this.consumeChar("\\");
		      switch (this.peekChar()) {
		        // Matches a backspace.
		        // (Not to be confused with \b word boundary outside characterClass)
		        case "b":
		          this.consumeChar("b");
		          return { type: "Character", value: cc("\b") };
		        case "d":
		        case "D":
		        case "s":
		        case "S":
		        case "w":
		        case "W":
		          return this.characterClassEscape();
		        case "f":
		        case "n":
		        case "r":
		        case "t":
		        case "v":
		          return this.controlEscapeAtom();
		        case "c":
		          return this.controlLetterEscapeAtom();
		        case "0":
		          return this.nulCharacterAtom();
		        case "x":
		          return this.hexEscapeSequenceAtom();
		        case "u":
		          return this.regExpUnicodeEscapeSequenceAtom();
		        default:
		          return this.identityEscapeAtom();
		      }
		    };
		    RegExpParser.prototype.group = function() {
		      var capturing = true;
		      this.consumeChar("(");
		      switch (this.peekChar(0)) {
		        case "?":
		          this.consumeChar("?");
		          this.consumeChar(":");
		          capturing = false;
		          break;
		        default:
		          this.groupIdx++;
		          break;
		      }
		      var value = this.disjunction();
		      this.consumeChar(")");
		      var groupAst = {
		        type: "Group",
		        capturing,
		        value
		      };
		      if (capturing) {
		        groupAst.idx = this.groupIdx;
		      }
		      return groupAst;
		    };
		    RegExpParser.prototype.positiveInteger = function() {
		      var number = this.popChar();
		      if (decimalPatternNoZero.test(number) === false) {
		        throw Error("Expecting a positive integer");
		      }
		      while (decimalPattern.test(this.peekChar(0))) {
		        number += this.popChar();
		      }
		      return parseInt(number, 10);
		    };
		    RegExpParser.prototype.integerIncludingZero = function() {
		      var number = this.popChar();
		      if (decimalPattern.test(number) === false) {
		        throw Error("Expecting an integer");
		      }
		      while (decimalPattern.test(this.peekChar(0))) {
		        number += this.popChar();
		      }
		      return parseInt(number, 10);
		    };
		    RegExpParser.prototype.patternCharacter = function() {
		      var nextChar = this.popChar();
		      switch (nextChar) {
		        // istanbul ignore next
		        case "\n":
		        // istanbul ignore next
		        case "\r":
		        // istanbul ignore next
		        case "\u2028":
		        // istanbul ignore next
		        case "\u2029":
		        // istanbul ignore next
		        case "^":
		        // istanbul ignore next
		        case "$":
		        // istanbul ignore next
		        case "\\":
		        // istanbul ignore next
		        case ".":
		        // istanbul ignore next
		        case "*":
		        // istanbul ignore next
		        case "+":
		        // istanbul ignore next
		        case "?":
		        // istanbul ignore next
		        case "(":
		        // istanbul ignore next
		        case ")":
		        // istanbul ignore next
		        case "[":
		        // istanbul ignore next
		        case "|":
		          throw Error("TBD");
		        default:
		          return { type: "Character", value: cc(nextChar) };
		      }
		    };
		    RegExpParser.prototype.isRegExpFlag = function() {
		      switch (this.peekChar(0)) {
		        case "g":
		        case "i":
		        case "m":
		        case "u":
		        case "y":
		          return true;
		        default:
		          return false;
		      }
		    };
		    RegExpParser.prototype.isRangeDash = function() {
		      return this.peekChar() === "-" && this.isClassAtom(1);
		    };
		    RegExpParser.prototype.isDigit = function() {
		      return decimalPattern.test(this.peekChar(0));
		    };
		    RegExpParser.prototype.isClassAtom = function(howMuch) {
		      if (howMuch === void 0) {
		        howMuch = 0;
		      }
		      switch (this.peekChar(howMuch)) {
		        case "]":
		        case "\n":
		        case "\r":
		        case "\u2028":
		        case "\u2029":
		          return false;
		        default:
		          return true;
		      }
		    };
		    RegExpParser.prototype.isTerm = function() {
		      return this.isAtom() || this.isAssertion();
		    };
		    RegExpParser.prototype.isAtom = function() {
		      if (this.isPatternCharacter()) {
		        return true;
		      }
		      switch (this.peekChar(0)) {
		        case ".":
		        case "\\":
		        // atomEscape
		        case "[":
		        // characterClass
		        // TODO: isAtom must be called before isAssertion - disambiguate
		        case "(":
		          return true;
		        default:
		          return false;
		      }
		    };
		    RegExpParser.prototype.isAssertion = function() {
		      switch (this.peekChar(0)) {
		        case "^":
		        case "$":
		          return true;
		        // '\b' or '\B'
		        case "\\":
		          switch (this.peekChar(1)) {
		            case "b":
		            case "B":
		              return true;
		            default:
		              return false;
		          }
		        // '(?=' or '(?!'
		        case "(":
		          return this.peekChar(1) === "?" && (this.peekChar(2) === "=" || this.peekChar(2) === "!");
		        default:
		          return false;
		      }
		    };
		    RegExpParser.prototype.isQuantifier = function() {
		      var prevState = this.saveState();
		      try {
		        return this.quantifier(true) !== void 0;
		      } catch (e) {
		        return false;
		      } finally {
		        this.restoreState(prevState);
		      }
		    };
		    RegExpParser.prototype.isPatternCharacter = function() {
		      switch (this.peekChar()) {
		        case "^":
		        case "$":
		        case "\\":
		        case ".":
		        case "*":
		        case "+":
		        case "?":
		        case "(":
		        case ")":
		        case "[":
		        case "|":
		        case "/":
		        case "\n":
		        case "\r":
		        case "\u2028":
		        case "\u2029":
		          return false;
		        default:
		          return true;
		      }
		    };
		    RegExpParser.prototype.parseHexDigits = function(howMany) {
		      var hexString = "";
		      for (var i2 = 0; i2 < howMany; i2++) {
		        var hexChar = this.popChar();
		        if (hexDigitPattern.test(hexChar) === false) {
		          throw Error("Expecting a HexDecimal digits");
		        }
		        hexString += hexChar;
		      }
		      var charCode = parseInt(hexString, 16);
		      return { type: "Character", value: charCode };
		    };
		    RegExpParser.prototype.peekChar = function(howMuch) {
		      if (howMuch === void 0) {
		        howMuch = 0;
		      }
		      return this.input[this.idx + howMuch];
		    };
		    RegExpParser.prototype.popChar = function() {
		      var nextChar = this.peekChar(0);
		      this.consumeChar();
		      return nextChar;
		    };
		    RegExpParser.prototype.consumeChar = function(char) {
		      if (char !== void 0 && this.input[this.idx] !== char) {
		        throw Error(
		          "Expected: '" + char + "' but found: '" + this.input[this.idx] + "' at offset: " + this.idx
		        );
		      }
		      if (this.idx >= this.input.length) {
		        throw Error("Unexpected end of input");
		      }
		      this.idx++;
		    };
		    RegExpParser.prototype.loc = function(begin) {
		      return { begin, end: this.idx };
		    };
		    var hexDigitPattern = /[0-9a-fA-F]/;
		    var decimalPattern = /[0-9]/;
		    var decimalPatternNoZero = /[1-9]/;
		    function cc(char) {
		      return char.charCodeAt(0);
		    }
		    function insertToSet(item, set) {
		      if (item.length !== void 0) {
		        item.forEach(function(subItem) {
		          set.push(subItem);
		        });
		      } else {
		        set.push(item);
		      }
		    }
		    function addFlag(flagObj, flagKey) {
		      if (flagObj[flagKey] === true) {
		        throw "duplicate flag " + flagKey;
		      }
		      flagObj[flagKey] = true;
		    }
		    function ASSERT_EXISTS(obj) {
		      if (obj === void 0) {
		        throw Error("Internal Error - Should never get here!");
		      }
		    }
		    function ASSERT_NEVER_REACH_HERE() {
		      throw Error("Internal Error - Should never get here!");
		    }
		    var i;
		    var digitsCharCodes = [];
		    for (i = cc("0"); i <= cc("9"); i++) {
		      digitsCharCodes.push(i);
		    }
		    var wordCharCodes = [cc("_")].concat(digitsCharCodes);
		    for (i = cc("a"); i <= cc("z"); i++) {
		      wordCharCodes.push(i);
		    }
		    for (i = cc("A"); i <= cc("Z"); i++) {
		      wordCharCodes.push(i);
		    }
		    var whitespaceCodes = [
		      cc(" "),
		      cc("\f"),
		      cc("\n"),
		      cc("\r"),
		      cc("	"),
		      cc("\v"),
		      cc("	"),
		      cc("\xA0"),
		      cc("\u1680"),
		      cc("\u2000"),
		      cc("\u2001"),
		      cc("\u2002"),
		      cc("\u2003"),
		      cc("\u2004"),
		      cc("\u2005"),
		      cc("\u2006"),
		      cc("\u2007"),
		      cc("\u2008"),
		      cc("\u2009"),
		      cc("\u200A"),
		      cc("\u2028"),
		      cc("\u2029"),
		      cc("\u202F"),
		      cc("\u205F"),
		      cc("\u3000"),
		      cc("\uFEFF")
		    ];
		    function BaseRegExpVisitor() {
		    }
		    BaseRegExpVisitor.prototype.visitChildren = function(node) {
		      for (var key in node) {
		        var child = node[key];
		        if (node.hasOwnProperty(key)) {
		          if (child.type !== void 0) {
		            this.visit(child);
		          } else if (Array.isArray(child)) {
		            child.forEach(function(subChild) {
		              this.visit(subChild);
		            }, this);
		          }
		        }
		      }
		    };
		    BaseRegExpVisitor.prototype.visit = function(node) {
		      switch (node.type) {
		        case "Pattern":
		          this.visitPattern(node);
		          break;
		        case "Flags":
		          this.visitFlags(node);
		          break;
		        case "Disjunction":
		          this.visitDisjunction(node);
		          break;
		        case "Alternative":
		          this.visitAlternative(node);
		          break;
		        case "StartAnchor":
		          this.visitStartAnchor(node);
		          break;
		        case "EndAnchor":
		          this.visitEndAnchor(node);
		          break;
		        case "WordBoundary":
		          this.visitWordBoundary(node);
		          break;
		        case "NonWordBoundary":
		          this.visitNonWordBoundary(node);
		          break;
		        case "Lookahead":
		          this.visitLookahead(node);
		          break;
		        case "NegativeLookahead":
		          this.visitNegativeLookahead(node);
		          break;
		        case "Character":
		          this.visitCharacter(node);
		          break;
		        case "Set":
		          this.visitSet(node);
		          break;
		        case "Group":
		          this.visitGroup(node);
		          break;
		        case "GroupBackReference":
		          this.visitGroupBackReference(node);
		          break;
		        case "Quantifier":
		          this.visitQuantifier(node);
		          break;
		      }
		      this.visitChildren(node);
		    };
		    BaseRegExpVisitor.prototype.visitPattern = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitFlags = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitDisjunction = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitAlternative = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitStartAnchor = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitEndAnchor = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitWordBoundary = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitNonWordBoundary = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitLookahead = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitNegativeLookahead = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitCharacter = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitSet = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitGroup = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitGroupBackReference = function(node) {
		    };
		    BaseRegExpVisitor.prototype.visitQuantifier = function(node) {
		    };
		    return {
		      RegExpParser,
		      BaseRegExpVisitor,
		      VERSION: "0.5.0"
		    };
		  }
		); 
	} (regexpToAst$1));
	return regexpToAst$1.exports;
}

var head_1;
var hasRequiredHead;

function requireHead () {
	if (hasRequiredHead) return head_1;
	hasRequiredHead = 1;
	function head(array) {
	  return array && array.length ? array[0] : void 0;
	}
	head_1 = head;
	return head_1;
}

var first;
var hasRequiredFirst;

function requireFirst () {
	if (hasRequiredFirst) return first;
	hasRequiredFirst = 1;
	first = requireHead();
	return first;
}

var compact_1;
var hasRequiredCompact;

function requireCompact () {
	if (hasRequiredCompact) return compact_1;
	hasRequiredCompact = 1;
	function compact(array) {
	  var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result = [];
	  while (++index < length) {
	    var value = array[index];
	    if (value) {
	      result[resIndex++] = value;
	    }
	  }
	  return result;
	}
	compact_1 = compact;
	return compact_1;
}

var _baseFilter;
var hasRequired_baseFilter;

function require_baseFilter () {
	if (hasRequired_baseFilter) return _baseFilter;
	hasRequired_baseFilter = 1;
	var baseEach = require_baseEach();
	function baseFilter(collection, predicate) {
	  var result = [];
	  baseEach(collection, function(value, index, collection2) {
	    if (predicate(value, index, collection2)) {
	      result.push(value);
	    }
	  });
	  return result;
	}
	_baseFilter = baseFilter;
	return _baseFilter;
}

var negate_1;
var hasRequiredNegate;

function requireNegate () {
	if (hasRequiredNegate) return negate_1;
	hasRequiredNegate = 1;
	var FUNC_ERROR_TEXT = "Expected a function";
	function negate(predicate) {
	  if (typeof predicate != "function") {
	    throw new TypeError(FUNC_ERROR_TEXT);
	  }
	  return function() {
	    var args = arguments;
	    switch (args.length) {
	      case 0:
	        return !predicate.call(this);
	      case 1:
	        return !predicate.call(this, args[0]);
	      case 2:
	        return !predicate.call(this, args[0], args[1]);
	      case 3:
	        return !predicate.call(this, args[0], args[1], args[2]);
	    }
	    return !predicate.apply(this, args);
	  };
	}
	negate_1 = negate;
	return negate_1;
}

var reject_1;
var hasRequiredReject;

function requireReject () {
	if (hasRequiredReject) return reject_1;
	hasRequiredReject = 1;
	var arrayFilter = require_arrayFilter(), baseFilter = require_baseFilter(), baseIteratee = require_baseIteratee(), isArray = requireIsArray(), negate = requireNegate();
	function reject(collection, predicate) {
	  var func = isArray(collection) ? arrayFilter : baseFilter;
	  return func(collection, negate(baseIteratee(predicate, 3)));
	}
	reject_1 = reject;
	return reject_1;
}

var _baseDifference;
var hasRequired_baseDifference;

function require_baseDifference () {
	if (hasRequired_baseDifference) return _baseDifference;
	hasRequired_baseDifference = 1;
	var SetCache = require_SetCache(), arrayIncludes = require_arrayIncludes(), arrayIncludesWith = require_arrayIncludesWith(), arrayMap = require_arrayMap(), baseUnary = require_baseUnary(), cacheHas = require_cacheHas();
	var LARGE_ARRAY_SIZE = 200;
	function baseDifference(array, values, iteratee, comparator) {
	  var index = -1, includes = arrayIncludes, isCommon = true, length = array.length, result = [], valuesLength = values.length;
	  if (!length) {
	    return result;
	  }
	  if (iteratee) {
	    values = arrayMap(values, baseUnary(iteratee));
	  }
	  if (comparator) {
	    includes = arrayIncludesWith;
	    isCommon = false;
	  } else if (values.length >= LARGE_ARRAY_SIZE) {
	    includes = cacheHas;
	    isCommon = false;
	    values = new SetCache(values);
	  }
	  outer:
	    while (++index < length) {
	      var value = array[index], computed = iteratee == null ? value : iteratee(value);
	      value = comparator || value !== 0 ? value : 0;
	      if (isCommon && computed === computed) {
	        var valuesIndex = valuesLength;
	        while (valuesIndex--) {
	          if (values[valuesIndex] === computed) {
	            continue outer;
	          }
	        }
	        result.push(value);
	      } else if (!includes(values, computed, comparator)) {
	        result.push(value);
	      }
	    }
	  return result;
	}
	_baseDifference = baseDifference;
	return _baseDifference;
}

var isArrayLikeObject_1;
var hasRequiredIsArrayLikeObject;

function requireIsArrayLikeObject () {
	if (hasRequiredIsArrayLikeObject) return isArrayLikeObject_1;
	hasRequiredIsArrayLikeObject = 1;
	var isArrayLike = requireIsArrayLike(), isObjectLike = requireIsObjectLike();
	function isArrayLikeObject(value) {
	  return isObjectLike(value) && isArrayLike(value);
	}
	isArrayLikeObject_1 = isArrayLikeObject;
	return isArrayLikeObject_1;
}

var difference_1;
var hasRequiredDifference;

function requireDifference () {
	if (hasRequiredDifference) return difference_1;
	hasRequiredDifference = 1;
	var baseDifference = require_baseDifference(), baseFlatten = require_baseFlatten(), baseRest = require_baseRest(), isArrayLikeObject = requireIsArrayLikeObject();
	var difference = baseRest(function(array, values) {
	  return isArrayLikeObject(array) ? baseDifference(array, baseFlatten(values, 1, isArrayLikeObject, true)) : [];
	});
	difference_1 = difference;
	return difference_1;
}

var indexOf_1;
var hasRequiredIndexOf;

function requireIndexOf () {
	if (hasRequiredIndexOf) return indexOf_1;
	hasRequiredIndexOf = 1;
	var baseIndexOf = require_baseIndexOf(), toInteger = requireToInteger();
	var nativeMax = Math.max;
	function indexOf(array, value, fromIndex) {
	  var length = array == null ? 0 : array.length;
	  if (!length) {
	    return -1;
	  }
	  var index = fromIndex == null ? 0 : toInteger(fromIndex);
	  if (index < 0) {
	    index = nativeMax(length + index, 0);
	  }
	  return baseIndexOf(array, value, index);
	}
	indexOf_1 = indexOf;
	return indexOf_1;
}

var _createFind;
var hasRequired_createFind;

function require_createFind () {
	if (hasRequired_createFind) return _createFind;
	hasRequired_createFind = 1;
	var baseIteratee = require_baseIteratee(), isArrayLike = requireIsArrayLike(), keys = requireKeys$1();
	function createFind(findIndexFunc) {
	  return function(collection, predicate, fromIndex) {
	    var iterable = Object(collection);
	    if (!isArrayLike(collection)) {
	      var iteratee = baseIteratee(predicate, 3);
	      collection = keys(collection);
	      predicate = function(key) {
	        return iteratee(iterable[key], key, iterable);
	      };
	    }
	    var index = findIndexFunc(collection, predicate, fromIndex);
	    return index > -1 ? iterable[iteratee ? collection[index] : index] : void 0;
	  };
	}
	_createFind = createFind;
	return _createFind;
}

var findIndex_1;
var hasRequiredFindIndex;

function requireFindIndex () {
	if (hasRequiredFindIndex) return findIndex_1;
	hasRequiredFindIndex = 1;
	var baseFindIndex = require_baseFindIndex(), baseIteratee = require_baseIteratee(), toInteger = requireToInteger();
	var nativeMax = Math.max;
	function findIndex(array, predicate, fromIndex) {
	  var length = array == null ? 0 : array.length;
	  if (!length) {
	    return -1;
	  }
	  var index = fromIndex == null ? 0 : toInteger(fromIndex);
	  if (index < 0) {
	    index = nativeMax(length + index, 0);
	  }
	  return baseFindIndex(array, baseIteratee(predicate, 3), index);
	}
	findIndex_1 = findIndex;
	return findIndex_1;
}

var find_1;
var hasRequiredFind;

function requireFind () {
	if (hasRequiredFind) return find_1;
	hasRequiredFind = 1;
	var createFind = require_createFind(), findIndex = requireFindIndex();
	var find = createFind(findIndex);
	find_1 = find;
	return find_1;
}

var filter_1;
var hasRequiredFilter;

function requireFilter () {
	if (hasRequiredFilter) return filter_1;
	hasRequiredFilter = 1;
	var arrayFilter = require_arrayFilter(), baseFilter = require_baseFilter(), baseIteratee = require_baseIteratee(), isArray = requireIsArray();
	function filter(collection, predicate) {
	  var func = isArray(collection) ? arrayFilter : baseFilter;
	  return func(collection, baseIteratee(predicate, 3));
	}
	filter_1 = filter;
	return filter_1;
}

var defaults_1;
var hasRequiredDefaults;

function requireDefaults () {
	if (hasRequiredDefaults) return defaults_1;
	hasRequiredDefaults = 1;
	var baseRest = require_baseRest(), eq = requireEq(), isIterateeCall = require_isIterateeCall(), keysIn = requireKeysIn();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	var defaults = baseRest(function(object, sources) {
	  object = Object(object);
	  var index = -1;
	  var length = sources.length;
	  var guard = length > 2 ? sources[2] : void 0;
	  if (guard && isIterateeCall(sources[0], sources[1], guard)) {
	    length = 1;
	  }
	  while (++index < length) {
	    var source = sources[index];
	    var props = keysIn(source);
	    var propsIndex = -1;
	    var propsLength = props.length;
	    while (++propsIndex < propsLength) {
	      var key = props[propsIndex];
	      var value = object[key];
	      if (value === void 0 || eq(value, objectProto[key]) && !hasOwnProperty.call(object, key)) {
	        object[key] = source[key];
	      }
	    }
	  }
	  return object;
	});
	defaults_1 = defaults;
	return defaults_1;
}

var _arrayReduce;
var hasRequired_arrayReduce;

function require_arrayReduce () {
	if (hasRequired_arrayReduce) return _arrayReduce;
	hasRequired_arrayReduce = 1;
	function arrayReduce(array, iteratee, accumulator, initAccum) {
	  var index = -1, length = array == null ? 0 : array.length;
	  if (initAccum && length) {
	    accumulator = array[++index];
	  }
	  while (++index < length) {
	    accumulator = iteratee(accumulator, array[index], index, array);
	  }
	  return accumulator;
	}
	_arrayReduce = arrayReduce;
	return _arrayReduce;
}

var _baseReduce;
var hasRequired_baseReduce;

function require_baseReduce () {
	if (hasRequired_baseReduce) return _baseReduce;
	hasRequired_baseReduce = 1;
	function baseReduce(collection, iteratee, accumulator, initAccum, eachFunc) {
	  eachFunc(collection, function(value, index, collection2) {
	    accumulator = initAccum ? (initAccum = false, value) : iteratee(accumulator, value, index, collection2);
	  });
	  return accumulator;
	}
	_baseReduce = baseReduce;
	return _baseReduce;
}

var reduce_1;
var hasRequiredReduce;

function requireReduce () {
	if (hasRequiredReduce) return reduce_1;
	hasRequiredReduce = 1;
	var arrayReduce = require_arrayReduce(), baseEach = require_baseEach(), baseIteratee = require_baseIteratee(), baseReduce = require_baseReduce(), isArray = requireIsArray();
	function reduce(collection, iteratee, accumulator) {
	  var func = isArray(collection) ? arrayReduce : baseReduce, initAccum = arguments.length < 3;
	  return func(collection, baseIteratee(iteratee, 4), accumulator, initAccum, baseEach);
	}
	reduce_1 = reduce;
	return reduce_1;
}

var reg_exp = {};

var reg_exp_parser = {};

var hasRequiredReg_exp_parser;

function requireReg_exp_parser () {
	if (hasRequiredReg_exp_parser) return reg_exp_parser;
	hasRequiredReg_exp_parser = 1;
	Object.defineProperty(reg_exp_parser, "__esModule", { value: true });
	reg_exp_parser.clearRegExpParserCache = reg_exp_parser.getRegExpAst = void 0;
	var regexp_to_ast_1 = requireRegexpToAst();
	var regExpAstCache = {};
	var regExpParser = new regexp_to_ast_1.RegExpParser();
	function getRegExpAst(regExp) {
	  var regExpStr = regExp.toString();
	  if (regExpAstCache.hasOwnProperty(regExpStr)) {
	    return regExpAstCache[regExpStr];
	  } else {
	    var regExpAst = regExpParser.pattern(regExpStr);
	    regExpAstCache[regExpStr] = regExpAst;
	    return regExpAst;
	  }
	}
	reg_exp_parser.getRegExpAst = getRegExpAst;
	function clearRegExpParserCache() {
	  regExpAstCache = {};
	}
	reg_exp_parser.clearRegExpParserCache = clearRegExpParserCache;
	return reg_exp_parser;
}

var hasRequiredReg_exp;

function requireReg_exp () {
	if (hasRequiredReg_exp) return reg_exp;
	hasRequiredReg_exp = 1;
	(function (exports$1) {
		var __extends = reg_exp && reg_exp.__extends || /* @__PURE__ */ (function() {
		  var extendStatics = function(d, b) {
		    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
		      d2.__proto__ = b2;
		    } || function(d2, b2) {
		      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
		    };
		    return extendStatics(d, b);
		  };
		  return function(d, b) {
		    if (typeof b !== "function" && b !== null)
		      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
		    extendStatics(d, b);
		    function __() {
		      this.constructor = d;
		    }
		    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		  };
		})();
		var __importDefault = reg_exp && reg_exp.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.canMatchCharCode = exports$1.firstCharOptimizedIndices = exports$1.getOptimizedStartCodesIndices = exports$1.failedOptimizationPrefixMsg = void 0;
		var regexp_to_ast_1 = requireRegexpToAst();
		var isArray_1 = __importDefault(requireIsArray());
		var every_1 = __importDefault(requireEvery());
		var forEach_1 = __importDefault(requireForEach());
		var find_1 = __importDefault(requireFind());
		var values_1 = __importDefault(requireValues());
		var includes_1 = __importDefault(requireIncludes());
		var utils_1 = requireApi$3();
		var reg_exp_parser_1 = requireReg_exp_parser();
		var lexer_1 = requireLexer();
		var complementErrorMessage = "Complement Sets are not supported for first char optimization";
		exports$1.failedOptimizationPrefixMsg = 'Unable to use "first char" lexer optimizations:\n';
		function getOptimizedStartCodesIndices(regExp, ensureOptimizations) {
		  if (ensureOptimizations === void 0) {
		    ensureOptimizations = false;
		  }
		  try {
		    var ast = (0, reg_exp_parser_1.getRegExpAst)(regExp);
		    var firstChars = firstCharOptimizedIndices(ast.value, {}, ast.flags.ignoreCase);
		    return firstChars;
		  } catch (e) {
		    if (e.message === complementErrorMessage) {
		      if (ensureOptimizations) {
		        (0, utils_1.PRINT_WARNING)("".concat(exports$1.failedOptimizationPrefixMsg) + "	Unable to optimize: < ".concat(regExp.toString(), " >\n") + "	Complement Sets cannot be automatically optimized.\n	This will disable the lexer's first char optimizations.\n	See: https://chevrotain.io/docs/guide/resolving_lexer_errors.html#COMPLEMENT for details.");
		      }
		    } else {
		      var msgSuffix = "";
		      if (ensureOptimizations) {
		        msgSuffix = "\n	This will disable the lexer's first char optimizations.\n	See: https://chevrotain.io/docs/guide/resolving_lexer_errors.html#REGEXP_PARSING for details.";
		      }
		      (0, utils_1.PRINT_ERROR)("".concat(exports$1.failedOptimizationPrefixMsg, "\n") + "	Failed parsing: < ".concat(regExp.toString(), " >\n") + "	Using the regexp-to-ast library version: ".concat(regexp_to_ast_1.VERSION, "\n") + "	Please open an issue at: https://github.com/bd82/regexp-to-ast/issues" + msgSuffix);
		    }
		  }
		  return [];
		}
		exports$1.getOptimizedStartCodesIndices = getOptimizedStartCodesIndices;
		function firstCharOptimizedIndices(ast, result, ignoreCase) {
		  switch (ast.type) {
		    case "Disjunction":
		      for (var i = 0; i < ast.value.length; i++) {
		        firstCharOptimizedIndices(ast.value[i], result, ignoreCase);
		      }
		      break;
		    case "Alternative":
		      var terms = ast.value;
		      for (var i = 0; i < terms.length; i++) {
		        var term = terms[i];
		        switch (term.type) {
		          case "EndAnchor":
		          // A group back reference cannot affect potential starting char.
		          // because if a back reference is the first production than automatically
		          // the group being referenced has had to come BEFORE so its codes have already been added
		          case "GroupBackReference":
		          // assertions do not affect potential starting codes
		          case "Lookahead":
		          case "NegativeLookahead":
		          case "StartAnchor":
		          case "WordBoundary":
		          case "NonWordBoundary":
		            continue;
		        }
		        var atom = term;
		        switch (atom.type) {
		          case "Character":
		            addOptimizedIdxToResult(atom.value, result, ignoreCase);
		            break;
		          case "Set":
		            if (atom.complement === true) {
		              throw Error(complementErrorMessage);
		            }
		            (0, forEach_1.default)(atom.value, function(code) {
		              if (typeof code === "number") {
		                addOptimizedIdxToResult(code, result, ignoreCase);
		              } else {
		                var range = code;
		                if (ignoreCase === true) {
		                  for (var rangeCode = range.from; rangeCode <= range.to; rangeCode++) {
		                    addOptimizedIdxToResult(rangeCode, result, ignoreCase);
		                  }
		                } else {
		                  for (var rangeCode = range.from; rangeCode <= range.to && rangeCode < lexer_1.minOptimizationVal; rangeCode++) {
		                    addOptimizedIdxToResult(rangeCode, result, ignoreCase);
		                  }
		                  if (range.to >= lexer_1.minOptimizationVal) {
		                    var minUnOptVal = range.from >= lexer_1.minOptimizationVal ? range.from : lexer_1.minOptimizationVal;
		                    var maxUnOptVal = range.to;
		                    var minOptIdx = (0, lexer_1.charCodeToOptimizedIndex)(minUnOptVal);
		                    var maxOptIdx = (0, lexer_1.charCodeToOptimizedIndex)(maxUnOptVal);
		                    for (var currOptIdx = minOptIdx; currOptIdx <= maxOptIdx; currOptIdx++) {
		                      result[currOptIdx] = currOptIdx;
		                    }
		                  }
		                }
		              }
		            });
		            break;
		          case "Group":
		            firstCharOptimizedIndices(atom.value, result, ignoreCase);
		            break;
		          /* istanbul ignore next */
		          default:
		            throw Error("Non Exhaustive Match");
		        }
		        var isOptionalQuantifier = atom.quantifier !== void 0 && atom.quantifier.atLeast === 0;
		        if (
		          // A group may be optional due to empty contents /(?:)/
		          // or if everything inside it is optional /((a)?)/
		          atom.type === "Group" && isWholeOptional(atom) === false || // If this term is not a group it may only be optional if it has an optional quantifier
		          atom.type !== "Group" && isOptionalQuantifier === false
		        ) {
		          break;
		        }
		      }
		      break;
		    /* istanbul ignore next */
		    default:
		      throw Error("non exhaustive match!");
		  }
		  return (0, values_1.default)(result);
		}
		exports$1.firstCharOptimizedIndices = firstCharOptimizedIndices;
		function addOptimizedIdxToResult(code, result, ignoreCase) {
		  var optimizedCharIdx = (0, lexer_1.charCodeToOptimizedIndex)(code);
		  result[optimizedCharIdx] = optimizedCharIdx;
		  if (ignoreCase === true) {
		    handleIgnoreCase(code, result);
		  }
		}
		function handleIgnoreCase(code, result) {
		  var char = String.fromCharCode(code);
		  var upperChar = char.toUpperCase();
		  if (upperChar !== char) {
		    var optimizedCharIdx = (0, lexer_1.charCodeToOptimizedIndex)(upperChar.charCodeAt(0));
		    result[optimizedCharIdx] = optimizedCharIdx;
		  } else {
		    var lowerChar = char.toLowerCase();
		    if (lowerChar !== char) {
		      var optimizedCharIdx = (0, lexer_1.charCodeToOptimizedIndex)(lowerChar.charCodeAt(0));
		      result[optimizedCharIdx] = optimizedCharIdx;
		    }
		  }
		}
		function findCode(setNode, targetCharCodes) {
		  return (0, find_1.default)(setNode.value, function(codeOrRange) {
		    if (typeof codeOrRange === "number") {
		      return (0, includes_1.default)(targetCharCodes, codeOrRange);
		    } else {
		      var range_1 = codeOrRange;
		      return (0, find_1.default)(targetCharCodes, function(targetCode) {
		        return range_1.from <= targetCode && targetCode <= range_1.to;
		      }) !== void 0;
		    }
		  });
		}
		function isWholeOptional(ast) {
		  var quantifier = ast.quantifier;
		  if (quantifier && quantifier.atLeast === 0) {
		    return true;
		  }
		  if (!ast.value) {
		    return false;
		  }
		  return (0, isArray_1.default)(ast.value) ? (0, every_1.default)(ast.value, isWholeOptional) : isWholeOptional(ast.value);
		}
		var CharCodeFinder = (
		  /** @class */
		  (function(_super) {
		    __extends(CharCodeFinder2, _super);
		    function CharCodeFinder2(targetCharCodes) {
		      var _this = _super.call(this) || this;
		      _this.targetCharCodes = targetCharCodes;
		      _this.found = false;
		      return _this;
		    }
		    CharCodeFinder2.prototype.visitChildren = function(node) {
		      if (this.found === true) {
		        return;
		      }
		      switch (node.type) {
		        case "Lookahead":
		          this.visitLookahead(node);
		          return;
		        case "NegativeLookahead":
		          this.visitNegativeLookahead(node);
		          return;
		      }
		      _super.prototype.visitChildren.call(this, node);
		    };
		    CharCodeFinder2.prototype.visitCharacter = function(node) {
		      if ((0, includes_1.default)(this.targetCharCodes, node.value)) {
		        this.found = true;
		      }
		    };
		    CharCodeFinder2.prototype.visitSet = function(node) {
		      if (node.complement) {
		        if (findCode(node, this.targetCharCodes) === void 0) {
		          this.found = true;
		        }
		      } else {
		        if (findCode(node, this.targetCharCodes) !== void 0) {
		          this.found = true;
		        }
		      }
		    };
		    return CharCodeFinder2;
		  })(regexp_to_ast_1.BaseRegExpVisitor)
		);
		function canMatchCharCode(charCodes, pattern) {
		  if (pattern instanceof RegExp) {
		    var ast = (0, reg_exp_parser_1.getRegExpAst)(pattern);
		    var charCodeFinder = new CharCodeFinder(charCodes);
		    charCodeFinder.visit(ast);
		    return charCodeFinder.found;
		  } else {
		    return (0, find_1.default)(pattern, function(char) {
		      return (0, includes_1.default)(charCodes, char.charCodeAt(0));
		    }) !== void 0;
		  }
		}
		exports$1.canMatchCharCode = canMatchCharCode; 
	} (reg_exp));
	return reg_exp;
}

var hasRequiredLexer;

function requireLexer () {
	if (hasRequiredLexer) return lexer;
	hasRequiredLexer = 1;
	(function (exports$1) {
		var __extends = lexer && lexer.__extends || /* @__PURE__ */ (function() {
		  var extendStatics = function(d, b) {
		    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
		      d2.__proto__ = b2;
		    } || function(d2, b2) {
		      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
		    };
		    return extendStatics(d, b);
		  };
		  return function(d, b) {
		    if (typeof b !== "function" && b !== null)
		      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
		    extendStatics(d, b);
		    function __() {
		      this.constructor = d;
		    }
		    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		  };
		})();
		var __importDefault = lexer && lexer.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.charCodeToOptimizedIndex = exports$1.minOptimizationVal = exports$1.buildLineBreakIssueMessage = exports$1.LineTerminatorOptimizedTester = exports$1.isShortPattern = exports$1.isCustomPattern = exports$1.cloneEmptyGroups = exports$1.performWarningRuntimeChecks = exports$1.performRuntimeChecks = exports$1.addStickyFlag = exports$1.addStartOfInput = exports$1.findUnreachablePatterns = exports$1.findModesThatDoNotExist = exports$1.findInvalidGroupType = exports$1.findDuplicatePatterns = exports$1.findUnsupportedFlags = exports$1.findStartOfInputAnchor = exports$1.findEmptyMatchRegExps = exports$1.findEndOfInputAnchor = exports$1.findInvalidPatterns = exports$1.findMissingPatterns = exports$1.validatePatterns = exports$1.analyzeTokenTypes = exports$1.enableSticky = exports$1.disableSticky = exports$1.SUPPORT_STICKY = exports$1.MODES = exports$1.DEFAULT_MODE = void 0;
		var regexp_to_ast_1 = requireRegexpToAst();
		var lexer_public_1 = requireLexer_public();
		var first_1 = __importDefault(requireFirst());
		var isEmpty_1 = __importDefault(requireIsEmpty());
		var compact_1 = __importDefault(requireCompact());
		var isArray_1 = __importDefault(requireIsArray());
		var values_1 = __importDefault(requireValues());
		var flatten_1 = __importDefault(requireFlatten());
		var reject_1 = __importDefault(requireReject());
		var difference_1 = __importDefault(requireDifference());
		var indexOf_1 = __importDefault(requireIndexOf());
		var map_1 = __importDefault(requireMap());
		var forEach_1 = __importDefault(requireForEach());
		var isString_1 = __importDefault(requireIsString());
		var isFunction_1 = __importDefault(requireIsFunction());
		var isUndefined_1 = __importDefault(requireIsUndefined());
		var find_1 = __importDefault(requireFind());
		var has_1 = __importDefault(requireHas());
		var keys_1 = __importDefault(requireKeys$1());
		var isRegExp_1 = __importDefault(requireIsRegExp());
		var filter_1 = __importDefault(requireFilter());
		var defaults_1 = __importDefault(requireDefaults());
		var reduce_1 = __importDefault(requireReduce());
		var includes_1 = __importDefault(requireIncludes());
		var utils_1 = requireApi$3();
		var reg_exp_1 = requireReg_exp();
		var reg_exp_parser_1 = requireReg_exp_parser();
		var PATTERN = "PATTERN";
		exports$1.DEFAULT_MODE = "defaultMode";
		exports$1.MODES = "modes";
		exports$1.SUPPORT_STICKY = typeof new RegExp("(?:)").sticky === "boolean";
		function disableSticky() {
		  exports$1.SUPPORT_STICKY = false;
		}
		exports$1.disableSticky = disableSticky;
		function enableSticky() {
		  exports$1.SUPPORT_STICKY = true;
		}
		exports$1.enableSticky = enableSticky;
		function analyzeTokenTypes(tokenTypes, options) {
		  options = (0, defaults_1.default)(options, {
		    useSticky: exports$1.SUPPORT_STICKY,
		    debug: false,
		    safeMode: false,
		    positionTracking: "full",
		    lineTerminatorCharacters: ["\r", "\n"],
		    tracer: function(msg, action) {
		      return action();
		    }
		  });
		  var tracer = options.tracer;
		  tracer("initCharCodeToOptimizedIndexMap", function() {
		    initCharCodeToOptimizedIndexMap();
		  });
		  var onlyRelevantTypes;
		  tracer("Reject Lexer.NA", function() {
		    onlyRelevantTypes = (0, reject_1.default)(tokenTypes, function(currType) {
		      return currType[PATTERN] === lexer_public_1.Lexer.NA;
		    });
		  });
		  var hasCustom = false;
		  var allTransformedPatterns;
		  tracer("Transform Patterns", function() {
		    hasCustom = false;
		    allTransformedPatterns = (0, map_1.default)(onlyRelevantTypes, function(currType) {
		      var currPattern = currType[PATTERN];
		      if ((0, isRegExp_1.default)(currPattern)) {
		        var regExpSource = currPattern.source;
		        if (regExpSource.length === 1 && // only these regExp meta characters which can appear in a length one regExp
		        regExpSource !== "^" && regExpSource !== "$" && regExpSource !== "." && !currPattern.ignoreCase) {
		          return regExpSource;
		        } else if (regExpSource.length === 2 && regExpSource[0] === "\\" && // not a meta character
		        !(0, includes_1.default)([
		          "d",
		          "D",
		          "s",
		          "S",
		          "t",
		          "r",
		          "n",
		          "t",
		          "0",
		          "c",
		          "b",
		          "B",
		          "f",
		          "v",
		          "w",
		          "W"
		        ], regExpSource[1])) {
		          return regExpSource[1];
		        } else {
		          return options.useSticky ? addStickyFlag(currPattern) : addStartOfInput(currPattern);
		        }
		      } else if ((0, isFunction_1.default)(currPattern)) {
		        hasCustom = true;
		        return { exec: currPattern };
		      } else if (typeof currPattern === "object") {
		        hasCustom = true;
		        return currPattern;
		      } else if (typeof currPattern === "string") {
		        if (currPattern.length === 1) {
		          return currPattern;
		        } else {
		          var escapedRegExpString = currPattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
		          var wrappedRegExp = new RegExp(escapedRegExpString);
		          return options.useSticky ? addStickyFlag(wrappedRegExp) : addStartOfInput(wrappedRegExp);
		        }
		      } else {
		        throw Error("non exhaustive match");
		      }
		    });
		  });
		  var patternIdxToType;
		  var patternIdxToGroup;
		  var patternIdxToLongerAltIdxArr;
		  var patternIdxToPushMode;
		  var patternIdxToPopMode;
		  tracer("misc mapping", function() {
		    patternIdxToType = (0, map_1.default)(onlyRelevantTypes, function(currType) {
		      return currType.tokenTypeIdx;
		    });
		    patternIdxToGroup = (0, map_1.default)(onlyRelevantTypes, function(clazz) {
		      var groupName = clazz.GROUP;
		      if (groupName === lexer_public_1.Lexer.SKIPPED) {
		        return void 0;
		      } else if ((0, isString_1.default)(groupName)) {
		        return groupName;
		      } else if ((0, isUndefined_1.default)(groupName)) {
		        return false;
		      } else {
		        throw Error("non exhaustive match");
		      }
		    });
		    patternIdxToLongerAltIdxArr = (0, map_1.default)(onlyRelevantTypes, function(clazz) {
		      var longerAltType = clazz.LONGER_ALT;
		      if (longerAltType) {
		        var longerAltIdxArr = (0, isArray_1.default)(longerAltType) ? (0, map_1.default)(longerAltType, function(type) {
		          return (0, indexOf_1.default)(onlyRelevantTypes, type);
		        }) : [(0, indexOf_1.default)(onlyRelevantTypes, longerAltType)];
		        return longerAltIdxArr;
		      }
		    });
		    patternIdxToPushMode = (0, map_1.default)(onlyRelevantTypes, function(clazz) {
		      return clazz.PUSH_MODE;
		    });
		    patternIdxToPopMode = (0, map_1.default)(onlyRelevantTypes, function(clazz) {
		      return (0, has_1.default)(clazz, "POP_MODE");
		    });
		  });
		  var patternIdxToCanLineTerminator;
		  tracer("Line Terminator Handling", function() {
		    var lineTerminatorCharCodes = getCharCodes(options.lineTerminatorCharacters);
		    patternIdxToCanLineTerminator = (0, map_1.default)(onlyRelevantTypes, function(tokType) {
		      return false;
		    });
		    if (options.positionTracking !== "onlyOffset") {
		      patternIdxToCanLineTerminator = (0, map_1.default)(onlyRelevantTypes, function(tokType) {
		        if ((0, has_1.default)(tokType, "LINE_BREAKS")) {
		          return !!tokType.LINE_BREAKS;
		        } else {
		          return checkLineBreaksIssues(tokType, lineTerminatorCharCodes) === false && (0, reg_exp_1.canMatchCharCode)(lineTerminatorCharCodes, tokType.PATTERN);
		        }
		      });
		    }
		  });
		  var patternIdxToIsCustom;
		  var patternIdxToShort;
		  var emptyGroups;
		  var patternIdxToConfig;
		  tracer("Misc Mapping #2", function() {
		    patternIdxToIsCustom = (0, map_1.default)(onlyRelevantTypes, isCustomPattern);
		    patternIdxToShort = (0, map_1.default)(allTransformedPatterns, isShortPattern);
		    emptyGroups = (0, reduce_1.default)(onlyRelevantTypes, function(acc, clazz) {
		      var groupName = clazz.GROUP;
		      if ((0, isString_1.default)(groupName) && !(groupName === lexer_public_1.Lexer.SKIPPED)) {
		        acc[groupName] = [];
		      }
		      return acc;
		    }, {});
		    patternIdxToConfig = (0, map_1.default)(allTransformedPatterns, function(x, idx) {
		      return {
		        pattern: allTransformedPatterns[idx],
		        longerAlt: patternIdxToLongerAltIdxArr[idx],
		        canLineTerminator: patternIdxToCanLineTerminator[idx],
		        isCustom: patternIdxToIsCustom[idx],
		        short: patternIdxToShort[idx],
		        group: patternIdxToGroup[idx],
		        push: patternIdxToPushMode[idx],
		        pop: patternIdxToPopMode[idx],
		        tokenTypeIdx: patternIdxToType[idx],
		        tokenType: onlyRelevantTypes[idx]
		      };
		    });
		  });
		  var canBeOptimized = true;
		  var charCodeToPatternIdxToConfig = [];
		  if (!options.safeMode) {
		    tracer("First Char Optimization", function() {
		      charCodeToPatternIdxToConfig = (0, reduce_1.default)(onlyRelevantTypes, function(result, currTokType, idx) {
		        if (typeof currTokType.PATTERN === "string") {
		          var charCode = currTokType.PATTERN.charCodeAt(0);
		          var optimizedIdx = charCodeToOptimizedIndex(charCode);
		          addToMapOfArrays(result, optimizedIdx, patternIdxToConfig[idx]);
		        } else if ((0, isArray_1.default)(currTokType.START_CHARS_HINT)) {
		          var lastOptimizedIdx_1;
		          (0, forEach_1.default)(currTokType.START_CHARS_HINT, function(charOrInt) {
		            var charCode2 = typeof charOrInt === "string" ? charOrInt.charCodeAt(0) : charOrInt;
		            var currOptimizedIdx = charCodeToOptimizedIndex(charCode2);
		            if (lastOptimizedIdx_1 !== currOptimizedIdx) {
		              lastOptimizedIdx_1 = currOptimizedIdx;
		              addToMapOfArrays(result, currOptimizedIdx, patternIdxToConfig[idx]);
		            }
		          });
		        } else if ((0, isRegExp_1.default)(currTokType.PATTERN)) {
		          if (currTokType.PATTERN.unicode) {
		            canBeOptimized = false;
		            if (options.ensureOptimizations) {
		              (0, utils_1.PRINT_ERROR)("".concat(reg_exp_1.failedOptimizationPrefixMsg) + "	Unable to analyze < ".concat(currTokType.PATTERN.toString(), " > pattern.\n") + "	The regexp unicode flag is not currently supported by the regexp-to-ast library.\n	This will disable the lexer's first char optimizations.\n	For details See: https://chevrotain.io/docs/guide/resolving_lexer_errors.html#UNICODE_OPTIMIZE");
		            }
		          } else {
		            var optimizedCodes = (0, reg_exp_1.getOptimizedStartCodesIndices)(currTokType.PATTERN, options.ensureOptimizations);
		            if ((0, isEmpty_1.default)(optimizedCodes)) {
		              canBeOptimized = false;
		            }
		            (0, forEach_1.default)(optimizedCodes, function(code) {
		              addToMapOfArrays(result, code, patternIdxToConfig[idx]);
		            });
		          }
		        } else {
		          if (options.ensureOptimizations) {
		            (0, utils_1.PRINT_ERROR)("".concat(reg_exp_1.failedOptimizationPrefixMsg) + "	TokenType: <".concat(currTokType.name, "> is using a custom token pattern without providing <start_chars_hint> parameter.\n") + "	This will disable the lexer's first char optimizations.\n	For details See: https://chevrotain.io/docs/guide/resolving_lexer_errors.html#CUSTOM_OPTIMIZE");
		          }
		          canBeOptimized = false;
		        }
		        return result;
		      }, []);
		    });
		  }
		  return {
		    emptyGroups,
		    patternIdxToConfig,
		    charCodeToPatternIdxToConfig,
		    hasCustom,
		    canBeOptimized
		  };
		}
		exports$1.analyzeTokenTypes = analyzeTokenTypes;
		function validatePatterns(tokenTypes, validModesNames) {
		  var errors = [];
		  var missingResult = findMissingPatterns(tokenTypes);
		  errors = errors.concat(missingResult.errors);
		  var invalidResult = findInvalidPatterns(missingResult.valid);
		  var validTokenTypes = invalidResult.valid;
		  errors = errors.concat(invalidResult.errors);
		  errors = errors.concat(validateRegExpPattern(validTokenTypes));
		  errors = errors.concat(findInvalidGroupType(validTokenTypes));
		  errors = errors.concat(findModesThatDoNotExist(validTokenTypes, validModesNames));
		  errors = errors.concat(findUnreachablePatterns(validTokenTypes));
		  return errors;
		}
		exports$1.validatePatterns = validatePatterns;
		function validateRegExpPattern(tokenTypes) {
		  var errors = [];
		  var withRegExpPatterns = (0, filter_1.default)(tokenTypes, function(currTokType) {
		    return (0, isRegExp_1.default)(currTokType[PATTERN]);
		  });
		  errors = errors.concat(findEndOfInputAnchor(withRegExpPatterns));
		  errors = errors.concat(findStartOfInputAnchor(withRegExpPatterns));
		  errors = errors.concat(findUnsupportedFlags(withRegExpPatterns));
		  errors = errors.concat(findDuplicatePatterns(withRegExpPatterns));
		  errors = errors.concat(findEmptyMatchRegExps(withRegExpPatterns));
		  return errors;
		}
		function findMissingPatterns(tokenTypes) {
		  var tokenTypesWithMissingPattern = (0, filter_1.default)(tokenTypes, function(currType) {
		    return !(0, has_1.default)(currType, PATTERN);
		  });
		  var errors = (0, map_1.default)(tokenTypesWithMissingPattern, function(currType) {
		    return {
		      message: "Token Type: ->" + currType.name + "<- missing static 'PATTERN' property",
		      type: lexer_public_1.LexerDefinitionErrorType.MISSING_PATTERN,
		      tokenTypes: [currType]
		    };
		  });
		  var valid = (0, difference_1.default)(tokenTypes, tokenTypesWithMissingPattern);
		  return { errors, valid };
		}
		exports$1.findMissingPatterns = findMissingPatterns;
		function findInvalidPatterns(tokenTypes) {
		  var tokenTypesWithInvalidPattern = (0, filter_1.default)(tokenTypes, function(currType) {
		    var pattern = currType[PATTERN];
		    return !(0, isRegExp_1.default)(pattern) && !(0, isFunction_1.default)(pattern) && !(0, has_1.default)(pattern, "exec") && !(0, isString_1.default)(pattern);
		  });
		  var errors = (0, map_1.default)(tokenTypesWithInvalidPattern, function(currType) {
		    return {
		      message: "Token Type: ->" + currType.name + "<- static 'PATTERN' can only be a RegExp, a Function matching the {CustomPatternMatcherFunc} type or an Object matching the {ICustomPattern} interface.",
		      type: lexer_public_1.LexerDefinitionErrorType.INVALID_PATTERN,
		      tokenTypes: [currType]
		    };
		  });
		  var valid = (0, difference_1.default)(tokenTypes, tokenTypesWithInvalidPattern);
		  return { errors, valid };
		}
		exports$1.findInvalidPatterns = findInvalidPatterns;
		var end_of_input = /[^\\][$]/;
		function findEndOfInputAnchor(tokenTypes) {
		  var EndAnchorFinder = (
		    /** @class */
		    (function(_super) {
		      __extends(EndAnchorFinder2, _super);
		      function EndAnchorFinder2() {
		        var _this = _super !== null && _super.apply(this, arguments) || this;
		        _this.found = false;
		        return _this;
		      }
		      EndAnchorFinder2.prototype.visitEndAnchor = function(node) {
		        this.found = true;
		      };
		      return EndAnchorFinder2;
		    })(regexp_to_ast_1.BaseRegExpVisitor)
		  );
		  var invalidRegex = (0, filter_1.default)(tokenTypes, function(currType) {
		    var pattern = currType.PATTERN;
		    try {
		      var regexpAst = (0, reg_exp_parser_1.getRegExpAst)(pattern);
		      var endAnchorVisitor = new EndAnchorFinder();
		      endAnchorVisitor.visit(regexpAst);
		      return endAnchorVisitor.found;
		    } catch (e) {
		      return end_of_input.test(pattern.source);
		    }
		  });
		  var errors = (0, map_1.default)(invalidRegex, function(currType) {
		    return {
		      message: "Unexpected RegExp Anchor Error:\n	Token Type: ->" + currType.name + "<- static 'PATTERN' cannot contain end of input anchor '$'\n	See chevrotain.io/docs/guide/resolving_lexer_errors.html#ANCHORS	for details.",
		      type: lexer_public_1.LexerDefinitionErrorType.EOI_ANCHOR_FOUND,
		      tokenTypes: [currType]
		    };
		  });
		  return errors;
		}
		exports$1.findEndOfInputAnchor = findEndOfInputAnchor;
		function findEmptyMatchRegExps(tokenTypes) {
		  var matchesEmptyString = (0, filter_1.default)(tokenTypes, function(currType) {
		    var pattern = currType.PATTERN;
		    return pattern.test("");
		  });
		  var errors = (0, map_1.default)(matchesEmptyString, function(currType) {
		    return {
		      message: "Token Type: ->" + currType.name + "<- static 'PATTERN' must not match an empty string",
		      type: lexer_public_1.LexerDefinitionErrorType.EMPTY_MATCH_PATTERN,
		      tokenTypes: [currType]
		    };
		  });
		  return errors;
		}
		exports$1.findEmptyMatchRegExps = findEmptyMatchRegExps;
		var start_of_input = /[^\\[][\^]|^\^/;
		function findStartOfInputAnchor(tokenTypes) {
		  var StartAnchorFinder = (
		    /** @class */
		    (function(_super) {
		      __extends(StartAnchorFinder2, _super);
		      function StartAnchorFinder2() {
		        var _this = _super !== null && _super.apply(this, arguments) || this;
		        _this.found = false;
		        return _this;
		      }
		      StartAnchorFinder2.prototype.visitStartAnchor = function(node) {
		        this.found = true;
		      };
		      return StartAnchorFinder2;
		    })(regexp_to_ast_1.BaseRegExpVisitor)
		  );
		  var invalidRegex = (0, filter_1.default)(tokenTypes, function(currType) {
		    var pattern = currType.PATTERN;
		    try {
		      var regexpAst = (0, reg_exp_parser_1.getRegExpAst)(pattern);
		      var startAnchorVisitor = new StartAnchorFinder();
		      startAnchorVisitor.visit(regexpAst);
		      return startAnchorVisitor.found;
		    } catch (e) {
		      return start_of_input.test(pattern.source);
		    }
		  });
		  var errors = (0, map_1.default)(invalidRegex, function(currType) {
		    return {
		      message: "Unexpected RegExp Anchor Error:\n	Token Type: ->" + currType.name + "<- static 'PATTERN' cannot contain start of input anchor '^'\n	See https://chevrotain.io/docs/guide/resolving_lexer_errors.html#ANCHORS	for details.",
		      type: lexer_public_1.LexerDefinitionErrorType.SOI_ANCHOR_FOUND,
		      tokenTypes: [currType]
		    };
		  });
		  return errors;
		}
		exports$1.findStartOfInputAnchor = findStartOfInputAnchor;
		function findUnsupportedFlags(tokenTypes) {
		  var invalidFlags = (0, filter_1.default)(tokenTypes, function(currType) {
		    var pattern = currType[PATTERN];
		    return pattern instanceof RegExp && (pattern.multiline || pattern.global);
		  });
		  var errors = (0, map_1.default)(invalidFlags, function(currType) {
		    return {
		      message: "Token Type: ->" + currType.name + "<- static 'PATTERN' may NOT contain global('g') or multiline('m')",
		      type: lexer_public_1.LexerDefinitionErrorType.UNSUPPORTED_FLAGS_FOUND,
		      tokenTypes: [currType]
		    };
		  });
		  return errors;
		}
		exports$1.findUnsupportedFlags = findUnsupportedFlags;
		function findDuplicatePatterns(tokenTypes) {
		  var found = [];
		  var identicalPatterns = (0, map_1.default)(tokenTypes, function(outerType) {
		    return (0, reduce_1.default)(tokenTypes, function(result, innerType) {
		      if (outerType.PATTERN.source === innerType.PATTERN.source && !(0, includes_1.default)(found, innerType) && innerType.PATTERN !== lexer_public_1.Lexer.NA) {
		        found.push(innerType);
		        result.push(innerType);
		        return result;
		      }
		      return result;
		    }, []);
		  });
		  identicalPatterns = (0, compact_1.default)(identicalPatterns);
		  var duplicatePatterns = (0, filter_1.default)(identicalPatterns, function(currIdenticalSet) {
		    return currIdenticalSet.length > 1;
		  });
		  var errors = (0, map_1.default)(duplicatePatterns, function(setOfIdentical) {
		    var tokenTypeNames = (0, map_1.default)(setOfIdentical, function(currType) {
		      return currType.name;
		    });
		    var dupPatternSrc = (0, first_1.default)(setOfIdentical).PATTERN;
		    return {
		      message: "The same RegExp pattern ->".concat(dupPatternSrc, "<-") + "has been used in all of the following Token Types: ".concat(tokenTypeNames.join(", "), " <-"),
		      type: lexer_public_1.LexerDefinitionErrorType.DUPLICATE_PATTERNS_FOUND,
		      tokenTypes: setOfIdentical
		    };
		  });
		  return errors;
		}
		exports$1.findDuplicatePatterns = findDuplicatePatterns;
		function findInvalidGroupType(tokenTypes) {
		  var invalidTypes = (0, filter_1.default)(tokenTypes, function(clazz) {
		    if (!(0, has_1.default)(clazz, "GROUP")) {
		      return false;
		    }
		    var group = clazz.GROUP;
		    return group !== lexer_public_1.Lexer.SKIPPED && group !== lexer_public_1.Lexer.NA && !(0, isString_1.default)(group);
		  });
		  var errors = (0, map_1.default)(invalidTypes, function(currType) {
		    return {
		      message: "Token Type: ->" + currType.name + "<- static 'GROUP' can only be Lexer.SKIPPED/Lexer.NA/A String",
		      type: lexer_public_1.LexerDefinitionErrorType.INVALID_GROUP_TYPE_FOUND,
		      tokenTypes: [currType]
		    };
		  });
		  return errors;
		}
		exports$1.findInvalidGroupType = findInvalidGroupType;
		function findModesThatDoNotExist(tokenTypes, validModes) {
		  var invalidModes = (0, filter_1.default)(tokenTypes, function(clazz) {
		    return clazz.PUSH_MODE !== void 0 && !(0, includes_1.default)(validModes, clazz.PUSH_MODE);
		  });
		  var errors = (0, map_1.default)(invalidModes, function(tokType) {
		    var msg = "Token Type: ->".concat(tokType.name, "<- static 'PUSH_MODE' value cannot refer to a Lexer Mode ->").concat(tokType.PUSH_MODE, "<-") + "which does not exist";
		    return {
		      message: msg,
		      type: lexer_public_1.LexerDefinitionErrorType.PUSH_MODE_DOES_NOT_EXIST,
		      tokenTypes: [tokType]
		    };
		  });
		  return errors;
		}
		exports$1.findModesThatDoNotExist = findModesThatDoNotExist;
		function findUnreachablePatterns(tokenTypes) {
		  var errors = [];
		  var canBeTested = (0, reduce_1.default)(tokenTypes, function(result, tokType, idx) {
		    var pattern = tokType.PATTERN;
		    if (pattern === lexer_public_1.Lexer.NA) {
		      return result;
		    }
		    if ((0, isString_1.default)(pattern)) {
		      result.push({ str: pattern, idx, tokenType: tokType });
		    } else if ((0, isRegExp_1.default)(pattern) && noMetaChar(pattern)) {
		      result.push({ str: pattern.source, idx, tokenType: tokType });
		    }
		    return result;
		  }, []);
		  (0, forEach_1.default)(tokenTypes, function(tokType, testIdx) {
		    (0, forEach_1.default)(canBeTested, function(_a) {
		      var str = _a.str, idx = _a.idx, tokenType = _a.tokenType;
		      if (testIdx < idx && testTokenType(str, tokType.PATTERN)) {
		        var msg = "Token: ->".concat(tokenType.name, "<- can never be matched.\n") + "Because it appears AFTER the Token Type ->".concat(tokType.name, "<-") + "in the lexer's definition.\nSee https://chevrotain.io/docs/guide/resolving_lexer_errors.html#UNREACHABLE";
		        errors.push({
		          message: msg,
		          type: lexer_public_1.LexerDefinitionErrorType.UNREACHABLE_PATTERN,
		          tokenTypes: [tokType, tokenType]
		        });
		      }
		    });
		  });
		  return errors;
		}
		exports$1.findUnreachablePatterns = findUnreachablePatterns;
		function testTokenType(str, pattern) {
		  if ((0, isRegExp_1.default)(pattern)) {
		    var regExpArray = pattern.exec(str);
		    return regExpArray !== null && regExpArray.index === 0;
		  } else if ((0, isFunction_1.default)(pattern)) {
		    return pattern(str, 0, [], {});
		  } else if ((0, has_1.default)(pattern, "exec")) {
		    return pattern.exec(str, 0, [], {});
		  } else if (typeof pattern === "string") {
		    return pattern === str;
		  } else {
		    throw Error("non exhaustive match");
		  }
		}
		function noMetaChar(regExp) {
		  var metaChars = [
		    ".",
		    "\\",
		    "[",
		    "]",
		    "|",
		    "^",
		    "$",
		    "(",
		    ")",
		    "?",
		    "*",
		    "+",
		    "{"
		  ];
		  return (0, find_1.default)(metaChars, function(char) {
		    return regExp.source.indexOf(char) !== -1;
		  }) === void 0;
		}
		function addStartOfInput(pattern) {
		  var flags = pattern.ignoreCase ? "i" : "";
		  return new RegExp("^(?:".concat(pattern.source, ")"), flags);
		}
		exports$1.addStartOfInput = addStartOfInput;
		function addStickyFlag(pattern) {
		  var flags = pattern.ignoreCase ? "iy" : "y";
		  return new RegExp("".concat(pattern.source), flags);
		}
		exports$1.addStickyFlag = addStickyFlag;
		function performRuntimeChecks(lexerDefinition, trackLines, lineTerminatorCharacters) {
		  var errors = [];
		  if (!(0, has_1.default)(lexerDefinition, exports$1.DEFAULT_MODE)) {
		    errors.push({
		      message: "A MultiMode Lexer cannot be initialized without a <" + exports$1.DEFAULT_MODE + "> property in its definition\n",
		      type: lexer_public_1.LexerDefinitionErrorType.MULTI_MODE_LEXER_WITHOUT_DEFAULT_MODE
		    });
		  }
		  if (!(0, has_1.default)(lexerDefinition, exports$1.MODES)) {
		    errors.push({
		      message: "A MultiMode Lexer cannot be initialized without a <" + exports$1.MODES + "> property in its definition\n",
		      type: lexer_public_1.LexerDefinitionErrorType.MULTI_MODE_LEXER_WITHOUT_MODES_PROPERTY
		    });
		  }
		  if ((0, has_1.default)(lexerDefinition, exports$1.MODES) && (0, has_1.default)(lexerDefinition, exports$1.DEFAULT_MODE) && !(0, has_1.default)(lexerDefinition.modes, lexerDefinition.defaultMode)) {
		    errors.push({
		      message: "A MultiMode Lexer cannot be initialized with a ".concat(exports$1.DEFAULT_MODE, ": <").concat(lexerDefinition.defaultMode, ">") + "which does not exist\n",
		      type: lexer_public_1.LexerDefinitionErrorType.MULTI_MODE_LEXER_DEFAULT_MODE_VALUE_DOES_NOT_EXIST
		    });
		  }
		  if ((0, has_1.default)(lexerDefinition, exports$1.MODES)) {
		    (0, forEach_1.default)(lexerDefinition.modes, function(currModeValue, currModeName) {
		      (0, forEach_1.default)(currModeValue, function(currTokType, currIdx) {
		        if ((0, isUndefined_1.default)(currTokType)) {
		          errors.push({
		            message: "A Lexer cannot be initialized using an undefined Token Type. Mode:" + "<".concat(currModeName, "> at index: <").concat(currIdx, ">\n"),
		            type: lexer_public_1.LexerDefinitionErrorType.LEXER_DEFINITION_CANNOT_CONTAIN_UNDEFINED
		          });
		        } else if ((0, has_1.default)(currTokType, "LONGER_ALT")) {
		          var longerAlt = (0, isArray_1.default)(currTokType.LONGER_ALT) ? currTokType.LONGER_ALT : [currTokType.LONGER_ALT];
		          (0, forEach_1.default)(longerAlt, function(currLongerAlt) {
		            if (!(0, isUndefined_1.default)(currLongerAlt) && !(0, includes_1.default)(currModeValue, currLongerAlt)) {
		              errors.push({
		                message: "A MultiMode Lexer cannot be initialized with a longer_alt <".concat(currLongerAlt.name, "> on token <").concat(currTokType.name, "> outside of mode <").concat(currModeName, ">\n"),
		                type: lexer_public_1.LexerDefinitionErrorType.MULTI_MODE_LEXER_LONGER_ALT_NOT_IN_CURRENT_MODE
		              });
		            }
		          });
		        }
		      });
		    });
		  }
		  return errors;
		}
		exports$1.performRuntimeChecks = performRuntimeChecks;
		function performWarningRuntimeChecks(lexerDefinition, trackLines, lineTerminatorCharacters) {
		  var warnings = [];
		  var hasAnyLineBreak = false;
		  var allTokenTypes = (0, compact_1.default)((0, flatten_1.default)((0, values_1.default)(lexerDefinition.modes)));
		  var concreteTokenTypes = (0, reject_1.default)(allTokenTypes, function(currType) {
		    return currType[PATTERN] === lexer_public_1.Lexer.NA;
		  });
		  var terminatorCharCodes = getCharCodes(lineTerminatorCharacters);
		  if (trackLines) {
		    (0, forEach_1.default)(concreteTokenTypes, function(tokType) {
		      var currIssue = checkLineBreaksIssues(tokType, terminatorCharCodes);
		      if (currIssue !== false) {
		        var message = buildLineBreakIssueMessage(tokType, currIssue);
		        var warningDescriptor = {
		          message,
		          type: currIssue.issue,
		          tokenType: tokType
		        };
		        warnings.push(warningDescriptor);
		      } else {
		        if ((0, has_1.default)(tokType, "LINE_BREAKS")) {
		          if (tokType.LINE_BREAKS === true) {
		            hasAnyLineBreak = true;
		          }
		        } else {
		          if ((0, reg_exp_1.canMatchCharCode)(terminatorCharCodes, tokType.PATTERN)) {
		            hasAnyLineBreak = true;
		          }
		        }
		      }
		    });
		  }
		  if (trackLines && !hasAnyLineBreak) {
		    warnings.push({
		      message: "Warning: No LINE_BREAKS Found.\n	This Lexer has been defined to track line and column information,\n	But none of the Token Types can be identified as matching a line terminator.\n	See https://chevrotain.io/docs/guide/resolving_lexer_errors.html#LINE_BREAKS \n	for details.",
		      type: lexer_public_1.LexerDefinitionErrorType.NO_LINE_BREAKS_FLAGS
		    });
		  }
		  return warnings;
		}
		exports$1.performWarningRuntimeChecks = performWarningRuntimeChecks;
		function cloneEmptyGroups(emptyGroups) {
		  var clonedResult = {};
		  var groupKeys = (0, keys_1.default)(emptyGroups);
		  (0, forEach_1.default)(groupKeys, function(currKey) {
		    var currGroupValue = emptyGroups[currKey];
		    if ((0, isArray_1.default)(currGroupValue)) {
		      clonedResult[currKey] = [];
		    } else {
		      throw Error("non exhaustive match");
		    }
		  });
		  return clonedResult;
		}
		exports$1.cloneEmptyGroups = cloneEmptyGroups;
		function isCustomPattern(tokenType) {
		  var pattern = tokenType.PATTERN;
		  if ((0, isRegExp_1.default)(pattern)) {
		    return false;
		  } else if ((0, isFunction_1.default)(pattern)) {
		    return true;
		  } else if ((0, has_1.default)(pattern, "exec")) {
		    return true;
		  } else if ((0, isString_1.default)(pattern)) {
		    return false;
		  } else {
		    throw Error("non exhaustive match");
		  }
		}
		exports$1.isCustomPattern = isCustomPattern;
		function isShortPattern(pattern) {
		  if ((0, isString_1.default)(pattern) && pattern.length === 1) {
		    return pattern.charCodeAt(0);
		  } else {
		    return false;
		  }
		}
		exports$1.isShortPattern = isShortPattern;
		exports$1.LineTerminatorOptimizedTester = {
		  // implements /\n|\r\n?/g.test
		  test: function(text) {
		    var len = text.length;
		    for (var i = this.lastIndex; i < len; i++) {
		      var c = text.charCodeAt(i);
		      if (c === 10) {
		        this.lastIndex = i + 1;
		        return true;
		      } else if (c === 13) {
		        if (text.charCodeAt(i + 1) === 10) {
		          this.lastIndex = i + 2;
		        } else {
		          this.lastIndex = i + 1;
		        }
		        return true;
		      }
		    }
		    return false;
		  },
		  lastIndex: 0
		};
		function checkLineBreaksIssues(tokType, lineTerminatorCharCodes) {
		  if ((0, has_1.default)(tokType, "LINE_BREAKS")) {
		    return false;
		  } else {
		    if ((0, isRegExp_1.default)(tokType.PATTERN)) {
		      try {
		        (0, reg_exp_1.canMatchCharCode)(lineTerminatorCharCodes, tokType.PATTERN);
		      } catch (e) {
		        return {
		          issue: lexer_public_1.LexerDefinitionErrorType.IDENTIFY_TERMINATOR,
		          errMsg: e.message
		        };
		      }
		      return false;
		    } else if ((0, isString_1.default)(tokType.PATTERN)) {
		      return false;
		    } else if (isCustomPattern(tokType)) {
		      return { issue: lexer_public_1.LexerDefinitionErrorType.CUSTOM_LINE_BREAK };
		    } else {
		      throw Error("non exhaustive match");
		    }
		  }
		}
		function buildLineBreakIssueMessage(tokType, details) {
		  if (details.issue === lexer_public_1.LexerDefinitionErrorType.IDENTIFY_TERMINATOR) {
		    return "Warning: unable to identify line terminator usage in pattern.\n" + "	The problem is in the <".concat(tokType.name, "> Token Type\n") + "	 Root cause: ".concat(details.errMsg, ".\n") + "	For details See: https://chevrotain.io/docs/guide/resolving_lexer_errors.html#IDENTIFY_TERMINATOR";
		  } else if (details.issue === lexer_public_1.LexerDefinitionErrorType.CUSTOM_LINE_BREAK) {
		    return "Warning: A Custom Token Pattern should specify the <line_breaks> option.\n" + "	The problem is in the <".concat(tokType.name, "> Token Type\n") + "	For details See: https://chevrotain.io/docs/guide/resolving_lexer_errors.html#CUSTOM_LINE_BREAK";
		  } else {
		    throw Error("non exhaustive match");
		  }
		}
		exports$1.buildLineBreakIssueMessage = buildLineBreakIssueMessage;
		function getCharCodes(charsOrCodes) {
		  var charCodes = (0, map_1.default)(charsOrCodes, function(numOrString) {
		    if ((0, isString_1.default)(numOrString)) {
		      return numOrString.charCodeAt(0);
		    } else {
		      return numOrString;
		    }
		  });
		  return charCodes;
		}
		function addToMapOfArrays(map, key, value) {
		  if (map[key] === void 0) {
		    map[key] = [value];
		  } else {
		    map[key].push(value);
		  }
		}
		exports$1.minOptimizationVal = 256;
		var charCodeToOptimizedIdxMap = [];
		function charCodeToOptimizedIndex(charCode) {
		  return charCode < exports$1.minOptimizationVal ? charCode : charCodeToOptimizedIdxMap[charCode];
		}
		exports$1.charCodeToOptimizedIndex = charCodeToOptimizedIndex;
		function initCharCodeToOptimizedIndexMap() {
		  if ((0, isEmpty_1.default)(charCodeToOptimizedIdxMap)) {
		    charCodeToOptimizedIdxMap = new Array(65536);
		    for (var i = 0; i < 65536; i++) {
		      charCodeToOptimizedIdxMap[i] = i > 255 ? 255 + ~~(i / 255) : i;
		    }
		  }
		} 
	} (lexer));
	return lexer;
}

var last_1;
var hasRequiredLast;

function requireLast () {
	if (hasRequiredLast) return last_1;
	hasRequiredLast = 1;
	function last(array) {
	  var length = array == null ? 0 : array.length;
	  return length ? array[length - 1] : void 0;
	}
	last_1 = last;
	return last_1;
}

var tokens = {};

var hasRequiredTokens;

function requireTokens () {
	if (hasRequiredTokens) return tokens;
	hasRequiredTokens = 1;
	(function (exports$1) {
		var __importDefault = tokens && tokens.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.isTokenType = exports$1.hasExtendingTokensTypesMapProperty = exports$1.hasExtendingTokensTypesProperty = exports$1.hasCategoriesProperty = exports$1.hasShortKeyProperty = exports$1.singleAssignCategoriesToksMap = exports$1.assignCategoriesMapProp = exports$1.assignCategoriesTokensProp = exports$1.assignTokenDefaultProps = exports$1.expandCategories = exports$1.augmentTokenTypes = exports$1.tokenIdxToClass = exports$1.tokenShortNameIdx = exports$1.tokenStructuredMatcherNoCategories = exports$1.tokenStructuredMatcher = void 0;
		var isEmpty_1 = __importDefault(requireIsEmpty());
		var compact_1 = __importDefault(requireCompact());
		var isArray_1 = __importDefault(requireIsArray());
		var flatten_1 = __importDefault(requireFlatten());
		var difference_1 = __importDefault(requireDifference());
		var map_1 = __importDefault(requireMap());
		var forEach_1 = __importDefault(requireForEach());
		var has_1 = __importDefault(requireHas());
		var includes_1 = __importDefault(requireIncludes());
		var clone_1 = __importDefault(requireClone());
		function tokenStructuredMatcher(tokInstance, tokConstructor) {
		  var instanceType = tokInstance.tokenTypeIdx;
		  if (instanceType === tokConstructor.tokenTypeIdx) {
		    return true;
		  } else {
		    return tokConstructor.isParent === true && tokConstructor.categoryMatchesMap[instanceType] === true;
		  }
		}
		exports$1.tokenStructuredMatcher = tokenStructuredMatcher;
		function tokenStructuredMatcherNoCategories(token, tokType) {
		  return token.tokenTypeIdx === tokType.tokenTypeIdx;
		}
		exports$1.tokenStructuredMatcherNoCategories = tokenStructuredMatcherNoCategories;
		exports$1.tokenShortNameIdx = 1;
		exports$1.tokenIdxToClass = {};
		function augmentTokenTypes(tokenTypes) {
		  var tokenTypesAndParents = expandCategories(tokenTypes);
		  assignTokenDefaultProps(tokenTypesAndParents);
		  assignCategoriesMapProp(tokenTypesAndParents);
		  assignCategoriesTokensProp(tokenTypesAndParents);
		  (0, forEach_1.default)(tokenTypesAndParents, function(tokType) {
		    tokType.isParent = tokType.categoryMatches.length > 0;
		  });
		}
		exports$1.augmentTokenTypes = augmentTokenTypes;
		function expandCategories(tokenTypes) {
		  var result = (0, clone_1.default)(tokenTypes);
		  var categories = tokenTypes;
		  var searching = true;
		  while (searching) {
		    categories = (0, compact_1.default)((0, flatten_1.default)((0, map_1.default)(categories, function(currTokType) {
		      return currTokType.CATEGORIES;
		    })));
		    var newCategories = (0, difference_1.default)(categories, result);
		    result = result.concat(newCategories);
		    if ((0, isEmpty_1.default)(newCategories)) {
		      searching = false;
		    } else {
		      categories = newCategories;
		    }
		  }
		  return result;
		}
		exports$1.expandCategories = expandCategories;
		function assignTokenDefaultProps(tokenTypes) {
		  (0, forEach_1.default)(tokenTypes, function(currTokType) {
		    if (!hasShortKeyProperty(currTokType)) {
		      exports$1.tokenIdxToClass[exports$1.tokenShortNameIdx] = currTokType;
		      currTokType.tokenTypeIdx = exports$1.tokenShortNameIdx++;
		    }
		    if (hasCategoriesProperty(currTokType) && !(0, isArray_1.default)(currTokType.CATEGORIES)) {
		      currTokType.CATEGORIES = [currTokType.CATEGORIES];
		    }
		    if (!hasCategoriesProperty(currTokType)) {
		      currTokType.CATEGORIES = [];
		    }
		    if (!hasExtendingTokensTypesProperty(currTokType)) {
		      currTokType.categoryMatches = [];
		    }
		    if (!hasExtendingTokensTypesMapProperty(currTokType)) {
		      currTokType.categoryMatchesMap = {};
		    }
		  });
		}
		exports$1.assignTokenDefaultProps = assignTokenDefaultProps;
		function assignCategoriesTokensProp(tokenTypes) {
		  (0, forEach_1.default)(tokenTypes, function(currTokType) {
		    currTokType.categoryMatches = [];
		    (0, forEach_1.default)(currTokType.categoryMatchesMap, function(val, key) {
		      currTokType.categoryMatches.push(exports$1.tokenIdxToClass[key].tokenTypeIdx);
		    });
		  });
		}
		exports$1.assignCategoriesTokensProp = assignCategoriesTokensProp;
		function assignCategoriesMapProp(tokenTypes) {
		  (0, forEach_1.default)(tokenTypes, function(currTokType) {
		    singleAssignCategoriesToksMap([], currTokType);
		  });
		}
		exports$1.assignCategoriesMapProp = assignCategoriesMapProp;
		function singleAssignCategoriesToksMap(path, nextNode) {
		  (0, forEach_1.default)(path, function(pathNode) {
		    nextNode.categoryMatchesMap[pathNode.tokenTypeIdx] = true;
		  });
		  (0, forEach_1.default)(nextNode.CATEGORIES, function(nextCategory) {
		    var newPath = path.concat(nextNode);
		    if (!(0, includes_1.default)(newPath, nextCategory)) {
		      singleAssignCategoriesToksMap(newPath, nextCategory);
		    }
		  });
		}
		exports$1.singleAssignCategoriesToksMap = singleAssignCategoriesToksMap;
		function hasShortKeyProperty(tokType) {
		  return (0, has_1.default)(tokType, "tokenTypeIdx");
		}
		exports$1.hasShortKeyProperty = hasShortKeyProperty;
		function hasCategoriesProperty(tokType) {
		  return (0, has_1.default)(tokType, "CATEGORIES");
		}
		exports$1.hasCategoriesProperty = hasCategoriesProperty;
		function hasExtendingTokensTypesProperty(tokType) {
		  return (0, has_1.default)(tokType, "categoryMatches");
		}
		exports$1.hasExtendingTokensTypesProperty = hasExtendingTokensTypesProperty;
		function hasExtendingTokensTypesMapProperty(tokType) {
		  return (0, has_1.default)(tokType, "categoryMatchesMap");
		}
		exports$1.hasExtendingTokensTypesMapProperty = hasExtendingTokensTypesMapProperty;
		function isTokenType(tokType) {
		  return (0, has_1.default)(tokType, "tokenTypeIdx");
		}
		exports$1.isTokenType = isTokenType; 
	} (tokens));
	return tokens;
}

var lexer_errors_public = {};

var hasRequiredLexer_errors_public;

function requireLexer_errors_public () {
	if (hasRequiredLexer_errors_public) return lexer_errors_public;
	hasRequiredLexer_errors_public = 1;
	Object.defineProperty(lexer_errors_public, "__esModule", { value: true });
	lexer_errors_public.defaultLexerErrorProvider = void 0;
	lexer_errors_public.defaultLexerErrorProvider = {
	  buildUnableToPopLexerModeMessage: function(token) {
	    return "Unable to pop Lexer Mode after encountering Token ->".concat(token.image, "<- The Mode Stack is empty");
	  },
	  buildUnexpectedCharactersMessage: function(fullText, startOffset, length, line, column) {
	    return "unexpected character: ->".concat(fullText.charAt(startOffset), "<- at offset: ").concat(startOffset, ",") + " skipped ".concat(length, " characters.");
	  }
	};
	return lexer_errors_public;
}

var hasRequiredLexer_public;

function requireLexer_public () {
	if (hasRequiredLexer_public) return lexer_public;
	hasRequiredLexer_public = 1;
	(function (exports$1) {
		var __importDefault = lexer_public && lexer_public.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.Lexer = exports$1.LexerDefinitionErrorType = void 0;
		var lexer_1 = requireLexer();
		var noop_1 = __importDefault(requireNoop());
		var isEmpty_1 = __importDefault(requireIsEmpty());
		var isArray_1 = __importDefault(requireIsArray());
		var last_1 = __importDefault(requireLast());
		var reject_1 = __importDefault(requireReject());
		var map_1 = __importDefault(requireMap());
		var forEach_1 = __importDefault(requireForEach());
		var keys_1 = __importDefault(requireKeys$1());
		var isUndefined_1 = __importDefault(requireIsUndefined());
		var identity_1 = __importDefault(requireIdentity());
		var assign_1 = __importDefault(requireAssign());
		var reduce_1 = __importDefault(requireReduce());
		var clone_1 = __importDefault(requireClone());
		var utils_1 = requireApi$3();
		var tokens_1 = requireTokens();
		var lexer_errors_public_1 = requireLexer_errors_public();
		var reg_exp_parser_1 = requireReg_exp_parser();
		(function(LexerDefinitionErrorType2) {
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["MISSING_PATTERN"] = 0] = "MISSING_PATTERN";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["INVALID_PATTERN"] = 1] = "INVALID_PATTERN";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["EOI_ANCHOR_FOUND"] = 2] = "EOI_ANCHOR_FOUND";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["UNSUPPORTED_FLAGS_FOUND"] = 3] = "UNSUPPORTED_FLAGS_FOUND";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["DUPLICATE_PATTERNS_FOUND"] = 4] = "DUPLICATE_PATTERNS_FOUND";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["INVALID_GROUP_TYPE_FOUND"] = 5] = "INVALID_GROUP_TYPE_FOUND";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["PUSH_MODE_DOES_NOT_EXIST"] = 6] = "PUSH_MODE_DOES_NOT_EXIST";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["MULTI_MODE_LEXER_WITHOUT_DEFAULT_MODE"] = 7] = "MULTI_MODE_LEXER_WITHOUT_DEFAULT_MODE";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["MULTI_MODE_LEXER_WITHOUT_MODES_PROPERTY"] = 8] = "MULTI_MODE_LEXER_WITHOUT_MODES_PROPERTY";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["MULTI_MODE_LEXER_DEFAULT_MODE_VALUE_DOES_NOT_EXIST"] = 9] = "MULTI_MODE_LEXER_DEFAULT_MODE_VALUE_DOES_NOT_EXIST";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["LEXER_DEFINITION_CANNOT_CONTAIN_UNDEFINED"] = 10] = "LEXER_DEFINITION_CANNOT_CONTAIN_UNDEFINED";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["SOI_ANCHOR_FOUND"] = 11] = "SOI_ANCHOR_FOUND";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["EMPTY_MATCH_PATTERN"] = 12] = "EMPTY_MATCH_PATTERN";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["NO_LINE_BREAKS_FLAGS"] = 13] = "NO_LINE_BREAKS_FLAGS";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["UNREACHABLE_PATTERN"] = 14] = "UNREACHABLE_PATTERN";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["IDENTIFY_TERMINATOR"] = 15] = "IDENTIFY_TERMINATOR";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["CUSTOM_LINE_BREAK"] = 16] = "CUSTOM_LINE_BREAK";
		  LexerDefinitionErrorType2[LexerDefinitionErrorType2["MULTI_MODE_LEXER_LONGER_ALT_NOT_IN_CURRENT_MODE"] = 17] = "MULTI_MODE_LEXER_LONGER_ALT_NOT_IN_CURRENT_MODE";
		})(exports$1.LexerDefinitionErrorType || (exports$1.LexerDefinitionErrorType = {}));
		var DEFAULT_LEXER_CONFIG = {
		  deferDefinitionErrorsHandling: false,
		  positionTracking: "full",
		  lineTerminatorsPattern: /\n|\r\n?/g,
		  lineTerminatorCharacters: ["\n", "\r"],
		  ensureOptimizations: false,
		  safeMode: false,
		  errorMessageProvider: lexer_errors_public_1.defaultLexerErrorProvider,
		  traceInitPerf: false,
		  skipValidations: false,
		  recoveryEnabled: true
		};
		Object.freeze(DEFAULT_LEXER_CONFIG);
		var Lexer = (
		  /** @class */
		  (function() {
		    function Lexer2(lexerDefinition, config) {
		      if (config === void 0) {
		        config = DEFAULT_LEXER_CONFIG;
		      }
		      var _this = this;
		      this.lexerDefinition = lexerDefinition;
		      this.lexerDefinitionErrors = [];
		      this.lexerDefinitionWarning = [];
		      this.patternIdxToConfig = {};
		      this.charCodeToPatternIdxToConfig = {};
		      this.modes = [];
		      this.emptyGroups = {};
		      this.trackStartLines = true;
		      this.trackEndLines = true;
		      this.hasCustom = false;
		      this.canModeBeOptimized = {};
		      this.TRACE_INIT = function(phaseDesc, phaseImpl) {
		        if (_this.traceInitPerf === true) {
		          _this.traceInitIndent++;
		          var indent = new Array(_this.traceInitIndent + 1).join("	");
		          if (_this.traceInitIndent < _this.traceInitMaxIdent) {
		            console.log("".concat(indent, "--> <").concat(phaseDesc, ">"));
		          }
		          var _a = (0, utils_1.timer)(phaseImpl), time = _a.time, value = _a.value;
		          var traceMethod = time > 10 ? console.warn : console.log;
		          if (_this.traceInitIndent < _this.traceInitMaxIdent) {
		            traceMethod("".concat(indent, "<-- <").concat(phaseDesc, "> time: ").concat(time, "ms"));
		          }
		          _this.traceInitIndent--;
		          return value;
		        } else {
		          return phaseImpl();
		        }
		      };
		      if (typeof config === "boolean") {
		        throw Error("The second argument to the Lexer constructor is now an ILexerConfig Object.\na boolean 2nd argument is no longer supported");
		      }
		      this.config = (0, assign_1.default)({}, DEFAULT_LEXER_CONFIG, config);
		      var traceInitVal = this.config.traceInitPerf;
		      if (traceInitVal === true) {
		        this.traceInitMaxIdent = Infinity;
		        this.traceInitPerf = true;
		      } else if (typeof traceInitVal === "number") {
		        this.traceInitMaxIdent = traceInitVal;
		        this.traceInitPerf = true;
		      }
		      this.traceInitIndent = -1;
		      this.TRACE_INIT("Lexer Constructor", function() {
		        var actualDefinition;
		        var hasOnlySingleMode = true;
		        _this.TRACE_INIT("Lexer Config handling", function() {
		          if (_this.config.lineTerminatorsPattern === DEFAULT_LEXER_CONFIG.lineTerminatorsPattern) {
		            _this.config.lineTerminatorsPattern = lexer_1.LineTerminatorOptimizedTester;
		          } else {
		            if (_this.config.lineTerminatorCharacters === DEFAULT_LEXER_CONFIG.lineTerminatorCharacters) {
		              throw Error("Error: Missing <lineTerminatorCharacters> property on the Lexer config.\n	For details See: https://chevrotain.io/docs/guide/resolving_lexer_errors.html#MISSING_LINE_TERM_CHARS");
		            }
		          }
		          if (config.safeMode && config.ensureOptimizations) {
		            throw Error('"safeMode" and "ensureOptimizations" flags are mutually exclusive.');
		          }
		          _this.trackStartLines = /full|onlyStart/i.test(_this.config.positionTracking);
		          _this.trackEndLines = /full/i.test(_this.config.positionTracking);
		          if ((0, isArray_1.default)(lexerDefinition)) {
		            actualDefinition = {
		              modes: { defaultMode: (0, clone_1.default)(lexerDefinition) },
		              defaultMode: lexer_1.DEFAULT_MODE
		            };
		          } else {
		            hasOnlySingleMode = false;
		            actualDefinition = (0, clone_1.default)(lexerDefinition);
		          }
		        });
		        if (_this.config.skipValidations === false) {
		          _this.TRACE_INIT("performRuntimeChecks", function() {
		            _this.lexerDefinitionErrors = _this.lexerDefinitionErrors.concat((0, lexer_1.performRuntimeChecks)(actualDefinition, _this.trackStartLines, _this.config.lineTerminatorCharacters));
		          });
		          _this.TRACE_INIT("performWarningRuntimeChecks", function() {
		            _this.lexerDefinitionWarning = _this.lexerDefinitionWarning.concat((0, lexer_1.performWarningRuntimeChecks)(actualDefinition, _this.trackStartLines, _this.config.lineTerminatorCharacters));
		          });
		        }
		        actualDefinition.modes = actualDefinition.modes ? actualDefinition.modes : {};
		        (0, forEach_1.default)(actualDefinition.modes, function(currModeValue, currModeName) {
		          actualDefinition.modes[currModeName] = (0, reject_1.default)(currModeValue, function(currTokType) {
		            return (0, isUndefined_1.default)(currTokType);
		          });
		        });
		        var allModeNames = (0, keys_1.default)(actualDefinition.modes);
		        (0, forEach_1.default)(actualDefinition.modes, function(currModDef, currModName) {
		          _this.TRACE_INIT("Mode: <".concat(currModName, "> processing"), function() {
		            _this.modes.push(currModName);
		            if (_this.config.skipValidations === false) {
		              _this.TRACE_INIT("validatePatterns", function() {
		                _this.lexerDefinitionErrors = _this.lexerDefinitionErrors.concat((0, lexer_1.validatePatterns)(currModDef, allModeNames));
		              });
		            }
		            if ((0, isEmpty_1.default)(_this.lexerDefinitionErrors)) {
		              (0, tokens_1.augmentTokenTypes)(currModDef);
		              var currAnalyzeResult_1;
		              _this.TRACE_INIT("analyzeTokenTypes", function() {
		                currAnalyzeResult_1 = (0, lexer_1.analyzeTokenTypes)(currModDef, {
		                  lineTerminatorCharacters: _this.config.lineTerminatorCharacters,
		                  positionTracking: config.positionTracking,
		                  ensureOptimizations: config.ensureOptimizations,
		                  safeMode: config.safeMode,
		                  tracer: _this.TRACE_INIT
		                });
		              });
		              _this.patternIdxToConfig[currModName] = currAnalyzeResult_1.patternIdxToConfig;
		              _this.charCodeToPatternIdxToConfig[currModName] = currAnalyzeResult_1.charCodeToPatternIdxToConfig;
		              _this.emptyGroups = (0, assign_1.default)({}, _this.emptyGroups, currAnalyzeResult_1.emptyGroups);
		              _this.hasCustom = currAnalyzeResult_1.hasCustom || _this.hasCustom;
		              _this.canModeBeOptimized[currModName] = currAnalyzeResult_1.canBeOptimized;
		            }
		          });
		        });
		        _this.defaultMode = actualDefinition.defaultMode;
		        if (!(0, isEmpty_1.default)(_this.lexerDefinitionErrors) && !_this.config.deferDefinitionErrorsHandling) {
		          var allErrMessages = (0, map_1.default)(_this.lexerDefinitionErrors, function(error) {
		            return error.message;
		          });
		          var allErrMessagesString = allErrMessages.join("-----------------------\n");
		          throw new Error("Errors detected in definition of Lexer:\n" + allErrMessagesString);
		        }
		        (0, forEach_1.default)(_this.lexerDefinitionWarning, function(warningDescriptor) {
		          (0, utils_1.PRINT_WARNING)(warningDescriptor.message);
		        });
		        _this.TRACE_INIT("Choosing sub-methods implementations", function() {
		          if (lexer_1.SUPPORT_STICKY) {
		            _this.chopInput = identity_1.default;
		            _this.match = _this.matchWithTest;
		          } else {
		            _this.updateLastIndex = noop_1.default;
		            _this.match = _this.matchWithExec;
		          }
		          if (hasOnlySingleMode) {
		            _this.handleModes = noop_1.default;
		          }
		          if (_this.trackStartLines === false) {
		            _this.computeNewColumn = identity_1.default;
		          }
		          if (_this.trackEndLines === false) {
		            _this.updateTokenEndLineColumnLocation = noop_1.default;
		          }
		          if (/full/i.test(_this.config.positionTracking)) {
		            _this.createTokenInstance = _this.createFullToken;
		          } else if (/onlyStart/i.test(_this.config.positionTracking)) {
		            _this.createTokenInstance = _this.createStartOnlyToken;
		          } else if (/onlyOffset/i.test(_this.config.positionTracking)) {
		            _this.createTokenInstance = _this.createOffsetOnlyToken;
		          } else {
		            throw Error('Invalid <positionTracking> config option: "'.concat(_this.config.positionTracking, '"'));
		          }
		          if (_this.hasCustom) {
		            _this.addToken = _this.addTokenUsingPush;
		            _this.handlePayload = _this.handlePayloadWithCustom;
		          } else {
		            _this.addToken = _this.addTokenUsingMemberAccess;
		            _this.handlePayload = _this.handlePayloadNoCustom;
		          }
		        });
		        _this.TRACE_INIT("Failed Optimization Warnings", function() {
		          var unOptimizedModes = (0, reduce_1.default)(_this.canModeBeOptimized, function(cannotBeOptimized, canBeOptimized, modeName) {
		            if (canBeOptimized === false) {
		              cannotBeOptimized.push(modeName);
		            }
		            return cannotBeOptimized;
		          }, []);
		          if (config.ensureOptimizations && !(0, isEmpty_1.default)(unOptimizedModes)) {
		            throw Error("Lexer Modes: < ".concat(unOptimizedModes.join(", "), " > cannot be optimized.\n") + '	 Disable the "ensureOptimizations" lexer config flag to silently ignore this and run the lexer in an un-optimized mode.\n	 Or inspect the console log for details on how to resolve these issues.');
		          }
		        });
		        _this.TRACE_INIT("clearRegExpParserCache", function() {
		          (0, reg_exp_parser_1.clearRegExpParserCache)();
		        });
		        _this.TRACE_INIT("toFastProperties", function() {
		          (0, utils_1.toFastProperties)(_this);
		        });
		      });
		    }
		    Lexer2.prototype.tokenize = function(text, initialMode) {
		      if (initialMode === void 0) {
		        initialMode = this.defaultMode;
		      }
		      if (!(0, isEmpty_1.default)(this.lexerDefinitionErrors)) {
		        var allErrMessages = (0, map_1.default)(this.lexerDefinitionErrors, function(error) {
		          return error.message;
		        });
		        var allErrMessagesString = allErrMessages.join("-----------------------\n");
		        throw new Error("Unable to Tokenize because Errors detected in definition of Lexer:\n" + allErrMessagesString);
		      }
		      return this.tokenizeInternal(text, initialMode);
		    };
		    Lexer2.prototype.tokenizeInternal = function(text, initialMode) {
		      var _this = this;
		      var i, j, k, matchAltImage, longerAlt, matchedImage, payload, altPayload, imageLength, group, tokType, newToken, errLength, msg, match;
		      var orgText = text;
		      var orgLength = orgText.length;
		      var offset = 0;
		      var matchedTokensIndex = 0;
		      var guessedNumberOfTokens = this.hasCustom ? 0 : Math.floor(text.length / 10);
		      var matchedTokens = new Array(guessedNumberOfTokens);
		      var errors = [];
		      var line = this.trackStartLines ? 1 : void 0;
		      var column = this.trackStartLines ? 1 : void 0;
		      var groups = (0, lexer_1.cloneEmptyGroups)(this.emptyGroups);
		      var trackLines = this.trackStartLines;
		      var lineTerminatorPattern = this.config.lineTerminatorsPattern;
		      var currModePatternsLength = 0;
		      var patternIdxToConfig = [];
		      var currCharCodeToPatternIdxToConfig = [];
		      var modeStack = [];
		      var emptyArray = [];
		      Object.freeze(emptyArray);
		      var getPossiblePatterns;
		      function getPossiblePatternsSlow() {
		        return patternIdxToConfig;
		      }
		      function getPossiblePatternsOptimized(charCode) {
		        var optimizedCharIdx = (0, lexer_1.charCodeToOptimizedIndex)(charCode);
		        var possiblePatterns = currCharCodeToPatternIdxToConfig[optimizedCharIdx];
		        if (possiblePatterns === void 0) {
		          return emptyArray;
		        } else {
		          return possiblePatterns;
		        }
		      }
		      var pop_mode = function(popToken) {
		        if (modeStack.length === 1 && // if we have both a POP_MODE and a PUSH_MODE this is in-fact a "transition"
		        // So no error should occur.
		        popToken.tokenType.PUSH_MODE === void 0) {
		          var msg_1 = _this.config.errorMessageProvider.buildUnableToPopLexerModeMessage(popToken);
		          errors.push({
		            offset: popToken.startOffset,
		            line: popToken.startLine,
		            column: popToken.startColumn,
		            length: popToken.image.length,
		            message: msg_1
		          });
		        } else {
		          modeStack.pop();
		          var newMode = (0, last_1.default)(modeStack);
		          patternIdxToConfig = _this.patternIdxToConfig[newMode];
		          currCharCodeToPatternIdxToConfig = _this.charCodeToPatternIdxToConfig[newMode];
		          currModePatternsLength = patternIdxToConfig.length;
		          var modeCanBeOptimized = _this.canModeBeOptimized[newMode] && _this.config.safeMode === false;
		          if (currCharCodeToPatternIdxToConfig && modeCanBeOptimized) {
		            getPossiblePatterns = getPossiblePatternsOptimized;
		          } else {
		            getPossiblePatterns = getPossiblePatternsSlow;
		          }
		        }
		      };
		      function push_mode(newMode) {
		        modeStack.push(newMode);
		        currCharCodeToPatternIdxToConfig = this.charCodeToPatternIdxToConfig[newMode];
		        patternIdxToConfig = this.patternIdxToConfig[newMode];
		        currModePatternsLength = patternIdxToConfig.length;
		        currModePatternsLength = patternIdxToConfig.length;
		        var modeCanBeOptimized = this.canModeBeOptimized[newMode] && this.config.safeMode === false;
		        if (currCharCodeToPatternIdxToConfig && modeCanBeOptimized) {
		          getPossiblePatterns = getPossiblePatternsOptimized;
		        } else {
		          getPossiblePatterns = getPossiblePatternsSlow;
		        }
		      }
		      push_mode.call(this, initialMode);
		      var currConfig;
		      var recoveryEnabled = this.config.recoveryEnabled;
		      while (offset < orgLength) {
		        matchedImage = null;
		        var nextCharCode = orgText.charCodeAt(offset);
		        var chosenPatternIdxToConfig = getPossiblePatterns(nextCharCode);
		        var chosenPatternsLength = chosenPatternIdxToConfig.length;
		        for (i = 0; i < chosenPatternsLength; i++) {
		          currConfig = chosenPatternIdxToConfig[i];
		          var currPattern = currConfig.pattern;
		          payload = null;
		          var singleCharCode = currConfig.short;
		          if (singleCharCode !== false) {
		            if (nextCharCode === singleCharCode) {
		              matchedImage = currPattern;
		            }
		          } else if (currConfig.isCustom === true) {
		            match = currPattern.exec(orgText, offset, matchedTokens, groups);
		            if (match !== null) {
		              matchedImage = match[0];
		              if (match.payload !== void 0) {
		                payload = match.payload;
		              }
		            } else {
		              matchedImage = null;
		            }
		          } else {
		            this.updateLastIndex(currPattern, offset);
		            matchedImage = this.match(currPattern, text, offset);
		          }
		          if (matchedImage !== null) {
		            longerAlt = currConfig.longerAlt;
		            if (longerAlt !== void 0) {
		              var longerAltLength = longerAlt.length;
		              for (k = 0; k < longerAltLength; k++) {
		                var longerAltConfig = patternIdxToConfig[longerAlt[k]];
		                var longerAltPattern = longerAltConfig.pattern;
		                altPayload = null;
		                if (longerAltConfig.isCustom === true) {
		                  match = longerAltPattern.exec(orgText, offset, matchedTokens, groups);
		                  if (match !== null) {
		                    matchAltImage = match[0];
		                    if (match.payload !== void 0) {
		                      altPayload = match.payload;
		                    }
		                  } else {
		                    matchAltImage = null;
		                  }
		                } else {
		                  this.updateLastIndex(longerAltPattern, offset);
		                  matchAltImage = this.match(longerAltPattern, text, offset);
		                }
		                if (matchAltImage && matchAltImage.length > matchedImage.length) {
		                  matchedImage = matchAltImage;
		                  payload = altPayload;
		                  currConfig = longerAltConfig;
		                  break;
		                }
		              }
		            }
		            break;
		          }
		        }
		        if (matchedImage !== null) {
		          imageLength = matchedImage.length;
		          group = currConfig.group;
		          if (group !== void 0) {
		            tokType = currConfig.tokenTypeIdx;
		            newToken = this.createTokenInstance(matchedImage, offset, tokType, currConfig.tokenType, line, column, imageLength);
		            this.handlePayload(newToken, payload);
		            if (group === false) {
		              matchedTokensIndex = this.addToken(matchedTokens, matchedTokensIndex, newToken);
		            } else {
		              groups[group].push(newToken);
		            }
		          }
		          text = this.chopInput(text, imageLength);
		          offset = offset + imageLength;
		          column = this.computeNewColumn(column, imageLength);
		          if (trackLines === true && currConfig.canLineTerminator === true) {
		            var numOfLTsInMatch = 0;
		            var foundTerminator = void 0;
		            var lastLTEndOffset = void 0;
		            lineTerminatorPattern.lastIndex = 0;
		            do {
		              foundTerminator = lineTerminatorPattern.test(matchedImage);
		              if (foundTerminator === true) {
		                lastLTEndOffset = lineTerminatorPattern.lastIndex - 1;
		                numOfLTsInMatch++;
		              }
		            } while (foundTerminator === true);
		            if (numOfLTsInMatch !== 0) {
		              line = line + numOfLTsInMatch;
		              column = imageLength - lastLTEndOffset;
		              this.updateTokenEndLineColumnLocation(newToken, group, lastLTEndOffset, numOfLTsInMatch, line, column, imageLength);
		            }
		          }
		          this.handleModes(currConfig, pop_mode, push_mode, newToken);
		        } else {
		          var errorStartOffset = offset;
		          var errorLine = line;
		          var errorColumn = column;
		          var foundResyncPoint = recoveryEnabled === false;
		          while (foundResyncPoint === false && offset < orgLength) {
		            text = this.chopInput(text, 1);
		            offset++;
		            for (j = 0; j < currModePatternsLength; j++) {
		              var currConfig_1 = patternIdxToConfig[j];
		              var currPattern = currConfig_1.pattern;
		              var singleCharCode = currConfig_1.short;
		              if (singleCharCode !== false) {
		                if (orgText.charCodeAt(offset) === singleCharCode) {
		                  foundResyncPoint = true;
		                }
		              } else if (currConfig_1.isCustom === true) {
		                foundResyncPoint = currPattern.exec(orgText, offset, matchedTokens, groups) !== null;
		              } else {
		                this.updateLastIndex(currPattern, offset);
		                foundResyncPoint = currPattern.exec(text) !== null;
		              }
		              if (foundResyncPoint === true) {
		                break;
		              }
		            }
		          }
		          errLength = offset - errorStartOffset;
		          msg = this.config.errorMessageProvider.buildUnexpectedCharactersMessage(orgText, errorStartOffset, errLength, errorLine, errorColumn);
		          errors.push({
		            offset: errorStartOffset,
		            line: errorLine,
		            column: errorColumn,
		            length: errLength,
		            message: msg
		          });
		          if (recoveryEnabled === false) {
		            break;
		          }
		        }
		      }
		      if (!this.hasCustom) {
		        matchedTokens.length = matchedTokensIndex;
		      }
		      return {
		        tokens: matchedTokens,
		        groups,
		        errors
		      };
		    };
		    Lexer2.prototype.handleModes = function(config, pop_mode, push_mode, newToken) {
		      if (config.pop === true) {
		        var pushMode = config.push;
		        pop_mode(newToken);
		        if (pushMode !== void 0) {
		          push_mode.call(this, pushMode);
		        }
		      } else if (config.push !== void 0) {
		        push_mode.call(this, config.push);
		      }
		    };
		    Lexer2.prototype.chopInput = function(text, length) {
		      return text.substring(length);
		    };
		    Lexer2.prototype.updateLastIndex = function(regExp, newLastIndex) {
		      regExp.lastIndex = newLastIndex;
		    };
		    Lexer2.prototype.updateTokenEndLineColumnLocation = function(newToken, group, lastLTIdx, numOfLTsInMatch, line, column, imageLength) {
		      var lastCharIsLT, fixForEndingInLT;
		      if (group !== void 0) {
		        lastCharIsLT = lastLTIdx === imageLength - 1;
		        fixForEndingInLT = lastCharIsLT ? -1 : 0;
		        if (!(numOfLTsInMatch === 1 && lastCharIsLT === true)) {
		          newToken.endLine = line + fixForEndingInLT;
		          newToken.endColumn = column - 1 + -fixForEndingInLT;
		        }
		      }
		    };
		    Lexer2.prototype.computeNewColumn = function(oldColumn, imageLength) {
		      return oldColumn + imageLength;
		    };
		    Lexer2.prototype.createOffsetOnlyToken = function(image, startOffset, tokenTypeIdx, tokenType) {
		      return {
		        image,
		        startOffset,
		        tokenTypeIdx,
		        tokenType
		      };
		    };
		    Lexer2.prototype.createStartOnlyToken = function(image, startOffset, tokenTypeIdx, tokenType, startLine, startColumn) {
		      return {
		        image,
		        startOffset,
		        startLine,
		        startColumn,
		        tokenTypeIdx,
		        tokenType
		      };
		    };
		    Lexer2.prototype.createFullToken = function(image, startOffset, tokenTypeIdx, tokenType, startLine, startColumn, imageLength) {
		      return {
		        image,
		        startOffset,
		        endOffset: startOffset + imageLength - 1,
		        startLine,
		        endLine: startLine,
		        startColumn,
		        endColumn: startColumn + imageLength - 1,
		        tokenTypeIdx,
		        tokenType
		      };
		    };
		    Lexer2.prototype.addTokenUsingPush = function(tokenVector, index, tokenToAdd) {
		      tokenVector.push(tokenToAdd);
		      return index;
		    };
		    Lexer2.prototype.addTokenUsingMemberAccess = function(tokenVector, index, tokenToAdd) {
		      tokenVector[index] = tokenToAdd;
		      index++;
		      return index;
		    };
		    Lexer2.prototype.handlePayloadNoCustom = function(token, payload) {
		    };
		    Lexer2.prototype.handlePayloadWithCustom = function(token, payload) {
		      if (payload !== null) {
		        token.payload = payload;
		      }
		    };
		    Lexer2.prototype.matchWithTest = function(pattern, text, offset) {
		      var found = pattern.test(text);
		      if (found === true) {
		        return text.substring(offset, pattern.lastIndex);
		      }
		      return null;
		    };
		    Lexer2.prototype.matchWithExec = function(pattern, text) {
		      var regExpArray = pattern.exec(text);
		      return regExpArray !== null ? regExpArray[0] : null;
		    };
		    Lexer2.SKIPPED = "This marks a skipped Token pattern, this means each token identified by it willbe consumed and then thrown into oblivion, this can be used to for example to completely ignore whitespace.";
		    Lexer2.NA = /NOT_APPLICABLE/;
		    return Lexer2;
		  })()
		);
		exports$1.Lexer = Lexer; 
	} (lexer_public));
	return lexer_public;
}

var hasRequiredTokens_public;

function requireTokens_public () {
	if (hasRequiredTokens_public) return tokens_public;
	hasRequiredTokens_public = 1;
	(function (exports$1) {
		var __importDefault = tokens_public && tokens_public.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.tokenMatcher = exports$1.createTokenInstance = exports$1.EOF = exports$1.createToken = exports$1.hasTokenLabel = exports$1.tokenName = exports$1.tokenLabel = void 0;
		var isString_1 = __importDefault(requireIsString());
		var has_1 = __importDefault(requireHas());
		var isUndefined_1 = __importDefault(requireIsUndefined());
		var lexer_public_1 = requireLexer_public();
		var tokens_1 = requireTokens();
		function tokenLabel(tokType) {
		  if (hasTokenLabel(tokType)) {
		    return tokType.LABEL;
		  } else {
		    return tokType.name;
		  }
		}
		exports$1.tokenLabel = tokenLabel;
		function tokenName(tokType) {
		  return tokType.name;
		}
		exports$1.tokenName = tokenName;
		function hasTokenLabel(obj) {
		  return (0, isString_1.default)(obj.LABEL) && obj.LABEL !== "";
		}
		exports$1.hasTokenLabel = hasTokenLabel;
		var PARENT = "parent";
		var CATEGORIES = "categories";
		var LABEL = "label";
		var GROUP = "group";
		var PUSH_MODE = "push_mode";
		var POP_MODE = "pop_mode";
		var LONGER_ALT = "longer_alt";
		var LINE_BREAKS = "line_breaks";
		var START_CHARS_HINT = "start_chars_hint";
		function createToken(config) {
		  return createTokenInternal(config);
		}
		exports$1.createToken = createToken;
		function createTokenInternal(config) {
		  var pattern = config.pattern;
		  var tokenType = {};
		  tokenType.name = config.name;
		  if (!(0, isUndefined_1.default)(pattern)) {
		    tokenType.PATTERN = pattern;
		  }
		  if ((0, has_1.default)(config, PARENT)) {
		    throw "The parent property is no longer supported.\nSee: https://github.com/chevrotain/chevrotain/issues/564#issuecomment-349062346 for details.";
		  }
		  if ((0, has_1.default)(config, CATEGORIES)) {
		    tokenType.CATEGORIES = config[CATEGORIES];
		  }
		  (0, tokens_1.augmentTokenTypes)([tokenType]);
		  if ((0, has_1.default)(config, LABEL)) {
		    tokenType.LABEL = config[LABEL];
		  }
		  if ((0, has_1.default)(config, GROUP)) {
		    tokenType.GROUP = config[GROUP];
		  }
		  if ((0, has_1.default)(config, POP_MODE)) {
		    tokenType.POP_MODE = config[POP_MODE];
		  }
		  if ((0, has_1.default)(config, PUSH_MODE)) {
		    tokenType.PUSH_MODE = config[PUSH_MODE];
		  }
		  if ((0, has_1.default)(config, LONGER_ALT)) {
		    tokenType.LONGER_ALT = config[LONGER_ALT];
		  }
		  if ((0, has_1.default)(config, LINE_BREAKS)) {
		    tokenType.LINE_BREAKS = config[LINE_BREAKS];
		  }
		  if ((0, has_1.default)(config, START_CHARS_HINT)) {
		    tokenType.START_CHARS_HINT = config[START_CHARS_HINT];
		  }
		  return tokenType;
		}
		exports$1.EOF = createToken({ name: "EOF", pattern: lexer_public_1.Lexer.NA });
		(0, tokens_1.augmentTokenTypes)([exports$1.EOF]);
		function createTokenInstance(tokType, image, startOffset, endOffset, startLine, endLine, startColumn, endColumn) {
		  return {
		    image,
		    startOffset,
		    endOffset,
		    startLine,
		    endLine,
		    startColumn,
		    endColumn,
		    tokenTypeIdx: tokType.tokenTypeIdx,
		    tokenType: tokType
		  };
		}
		exports$1.createTokenInstance = createTokenInstance;
		function tokenMatcher(token, tokType) {
		  return (0, tokens_1.tokenStructuredMatcher)(token, tokType);
		}
		exports$1.tokenMatcher = tokenMatcher; 
	} (tokens_public));
	return tokens_public;
}

var errors_public = {};

var hasRequiredErrors_public;

function requireErrors_public () {
	if (hasRequiredErrors_public) return errors_public;
	hasRequiredErrors_public = 1;
	(function (exports$1) {
		var __importDefault = errors_public && errors_public.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.defaultGrammarValidatorErrorProvider = exports$1.defaultGrammarResolverErrorProvider = exports$1.defaultParserErrorProvider = void 0;
		var tokens_public_1 = requireTokens_public();
		var first_1 = __importDefault(requireFirst());
		var map_1 = __importDefault(requireMap());
		var reduce_1 = __importDefault(requireReduce());
		var gast_1 = requireApi$2();
		var gast_2 = requireApi$2();
		exports$1.defaultParserErrorProvider = {
		  buildMismatchTokenMessage: function(_a) {
		    var expected = _a.expected, actual = _a.actual; _a.previous; _a.ruleName;
		    var hasLabel = (0, tokens_public_1.hasTokenLabel)(expected);
		    var expectedMsg = hasLabel ? "--> ".concat((0, tokens_public_1.tokenLabel)(expected), " <--") : "token of type --> ".concat(expected.name, " <--");
		    var msg = "Expecting ".concat(expectedMsg, " but found --> '").concat(actual.image, "' <--");
		    return msg;
		  },
		  buildNotAllInputParsedMessage: function(_a) {
		    var firstRedundant = _a.firstRedundant; _a.ruleName;
		    return "Redundant input, expecting EOF but found: " + firstRedundant.image;
		  },
		  buildNoViableAltMessage: function(_a) {
		    var expectedPathsPerAlt = _a.expectedPathsPerAlt, actual = _a.actual; _a.previous; var customUserDescription = _a.customUserDescription; _a.ruleName;
		    var errPrefix = "Expecting: ";
		    var actualText = (0, first_1.default)(actual).image;
		    var errSuffix = "\nbut found: '" + actualText + "'";
		    if (customUserDescription) {
		      return errPrefix + customUserDescription + errSuffix;
		    } else {
		      var allLookAheadPaths = (0, reduce_1.default)(expectedPathsPerAlt, function(result, currAltPaths) {
		        return result.concat(currAltPaths);
		      }, []);
		      var nextValidTokenSequences = (0, map_1.default)(allLookAheadPaths, function(currPath) {
		        return "[".concat((0, map_1.default)(currPath, function(currTokenType) {
		          return (0, tokens_public_1.tokenLabel)(currTokenType);
		        }).join(", "), "]");
		      });
		      var nextValidSequenceItems = (0, map_1.default)(nextValidTokenSequences, function(itemMsg, idx) {
		        return "  ".concat(idx + 1, ". ").concat(itemMsg);
		      });
		      var calculatedDescription = "one of these possible Token sequences:\n".concat(nextValidSequenceItems.join("\n"));
		      return errPrefix + calculatedDescription + errSuffix;
		    }
		  },
		  buildEarlyExitMessage: function(_a) {
		    var expectedIterationPaths = _a.expectedIterationPaths, actual = _a.actual, customUserDescription = _a.customUserDescription; _a.ruleName;
		    var errPrefix = "Expecting: ";
		    var actualText = (0, first_1.default)(actual).image;
		    var errSuffix = "\nbut found: '" + actualText + "'";
		    if (customUserDescription) {
		      return errPrefix + customUserDescription + errSuffix;
		    } else {
		      var nextValidTokenSequences = (0, map_1.default)(expectedIterationPaths, function(currPath) {
		        return "[".concat((0, map_1.default)(currPath, function(currTokenType) {
		          return (0, tokens_public_1.tokenLabel)(currTokenType);
		        }).join(","), "]");
		      });
		      var calculatedDescription = "expecting at least one iteration which starts with one of these possible Token sequences::\n  " + "<".concat(nextValidTokenSequences.join(" ,"), ">");
		      return errPrefix + calculatedDescription + errSuffix;
		    }
		  }
		};
		Object.freeze(exports$1.defaultParserErrorProvider);
		exports$1.defaultGrammarResolverErrorProvider = {
		  buildRuleNotFoundError: function(topLevelRule, undefinedRule) {
		    var msg = "Invalid grammar, reference to a rule which is not defined: ->" + undefinedRule.nonTerminalName + "<-\ninside top level rule: ->" + topLevelRule.name + "<-";
		    return msg;
		  }
		};
		exports$1.defaultGrammarValidatorErrorProvider = {
		  buildDuplicateFoundError: function(topLevelRule, duplicateProds) {
		    function getExtraProductionArgument(prod) {
		      if (prod instanceof gast_1.Terminal) {
		        return prod.terminalType.name;
		      } else if (prod instanceof gast_1.NonTerminal) {
		        return prod.nonTerminalName;
		      } else {
		        return "";
		      }
		    }
		    var topLevelName = topLevelRule.name;
		    var duplicateProd = (0, first_1.default)(duplicateProds);
		    var index = duplicateProd.idx;
		    var dslName = (0, gast_2.getProductionDslName)(duplicateProd);
		    var extraArgument = getExtraProductionArgument(duplicateProd);
		    var hasExplicitIndex = index > 0;
		    var msg = "->".concat(dslName).concat(hasExplicitIndex ? index : "", "<- ").concat(extraArgument ? "with argument: ->".concat(extraArgument, "<-") : "", "\n                  appears more than once (").concat(duplicateProds.length, " times) in the top level rule: ->").concat(topLevelName, "<-.                  \n                  For further details see: https://chevrotain.io/docs/FAQ.html#NUMERICAL_SUFFIXES \n                  ");
		    msg = msg.replace(/[ \t]+/g, " ");
		    msg = msg.replace(/\s\s+/g, "\n");
		    return msg;
		  },
		  buildNamespaceConflictError: function(rule) {
		    var errMsg = "Namespace conflict found in grammar.\n" + "The grammar has both a Terminal(Token) and a Non-Terminal(Rule) named: <".concat(rule.name, ">.\n") + "To resolve this make sure each Terminal and Non-Terminal names are unique\nThis is easy to accomplish by using the convention that Terminal names start with an uppercase letter\nand Non-Terminal names start with a lower case letter.";
		    return errMsg;
		  },
		  buildAlternationPrefixAmbiguityError: function(options) {
		    var pathMsg = (0, map_1.default)(options.prefixPath, function(currTok) {
		      return (0, tokens_public_1.tokenLabel)(currTok);
		    }).join(", ");
		    var occurrence = options.alternation.idx === 0 ? "" : options.alternation.idx;
		    var errMsg = "Ambiguous alternatives: <".concat(options.ambiguityIndices.join(" ,"), "> due to common lookahead prefix\n") + "in <OR".concat(occurrence, "> inside <").concat(options.topLevelRule.name, "> Rule,\n") + "<".concat(pathMsg, "> may appears as a prefix path in all these alternatives.\n") + "See: https://chevrotain.io/docs/guide/resolving_grammar_errors.html#COMMON_PREFIX\nFor Further details.";
		    return errMsg;
		  },
		  buildAlternationAmbiguityError: function(options) {
		    var pathMsg = (0, map_1.default)(options.prefixPath, function(currtok) {
		      return (0, tokens_public_1.tokenLabel)(currtok);
		    }).join(", ");
		    var occurrence = options.alternation.idx === 0 ? "" : options.alternation.idx;
		    var currMessage = "Ambiguous Alternatives Detected: <".concat(options.ambiguityIndices.join(" ,"), "> in <OR").concat(occurrence, ">") + " inside <".concat(options.topLevelRule.name, "> Rule,\n") + "<".concat(pathMsg, "> may appears as a prefix path in all these alternatives.\n");
		    currMessage = currMessage + "See: https://chevrotain.io/docs/guide/resolving_grammar_errors.html#AMBIGUOUS_ALTERNATIVES\nFor Further details.";
		    return currMessage;
		  },
		  buildEmptyRepetitionError: function(options) {
		    var dslName = (0, gast_2.getProductionDslName)(options.repetition);
		    if (options.repetition.idx !== 0) {
		      dslName += options.repetition.idx;
		    }
		    var errMsg = "The repetition <".concat(dslName, "> within Rule <").concat(options.topLevelRule.name, "> can never consume any tokens.\n") + "This could lead to an infinite loop.";
		    return errMsg;
		  },
		  // TODO: remove - `errors_public` from nyc.config.js exclude
		  //       once this method is fully removed from this file
		  buildTokenNameError: function(options) {
		    return "deprecated";
		  },
		  buildEmptyAlternationError: function(options) {
		    var errMsg = "Ambiguous empty alternative: <".concat(options.emptyChoiceIdx + 1, ">") + " in <OR".concat(options.alternation.idx, "> inside <").concat(options.topLevelRule.name, "> Rule.\n") + "Only the last alternative may be an empty alternative.";
		    return errMsg;
		  },
		  buildTooManyAlternativesError: function(options) {
		    var errMsg = "An Alternation cannot have more than 256 alternatives:\n" + "<OR".concat(options.alternation.idx, "> inside <").concat(options.topLevelRule.name, "> Rule.\n has ").concat(options.alternation.definition.length + 1, " alternatives.");
		    return errMsg;
		  },
		  buildLeftRecursionError: function(options) {
		    var ruleName = options.topLevelRule.name;
		    var pathNames = (0, map_1.default)(options.leftRecursionPath, function(currRule) {
		      return currRule.name;
		    });
		    var leftRecursivePath = "".concat(ruleName, " --> ").concat(pathNames.concat([ruleName]).join(" --> "));
		    var errMsg = "Left Recursion found in grammar.\n" + "rule: <".concat(ruleName, "> can be invoked from itself (directly or indirectly)\n") + "without consuming any Tokens. The grammar path that causes this is: \n ".concat(leftRecursivePath, "\n") + " To fix this refactor your grammar to remove the left recursion.\nsee: https://en.wikipedia.org/wiki/LL_parser#Left_factoring.";
		    return errMsg;
		  },
		  // TODO: remove - `errors_public` from nyc.config.js exclude
		  //       once this method is fully removed from this file
		  buildInvalidRuleNameError: function(options) {
		    return "deprecated";
		  },
		  buildDuplicateRuleNameError: function(options) {
		    var ruleName;
		    if (options.topLevelRule instanceof gast_1.Rule) {
		      ruleName = options.topLevelRule.name;
		    } else {
		      ruleName = options.topLevelRule;
		    }
		    var errMsg = "Duplicate definition, rule: ->".concat(ruleName, "<- is already defined in the grammar: ->").concat(options.grammarName, "<-");
		    return errMsg;
		  }
		}; 
	} (errors_public));
	return errors_public;
}

var gast_resolver_public = {};

var resolver = {};

var hasRequiredResolver;

function requireResolver () {
	if (hasRequiredResolver) return resolver;
	hasRequiredResolver = 1;
	var __extends = resolver && resolver.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __importDefault = resolver && resolver.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(resolver, "__esModule", { value: true });
	resolver.GastRefResolverVisitor = resolver.resolveGrammar = void 0;
	var parser_1 = requireParser();
	var forEach_1 = __importDefault(requireForEach());
	var values_1 = __importDefault(requireValues());
	var gast_1 = requireApi$2();
	function resolveGrammar(topLevels, errMsgProvider) {
	  var refResolver = new GastRefResolverVisitor(topLevels, errMsgProvider);
	  refResolver.resolveRefs();
	  return refResolver.errors;
	}
	resolver.resolveGrammar = resolveGrammar;
	var GastRefResolverVisitor = (
	  /** @class */
	  (function(_super) {
	    __extends(GastRefResolverVisitor2, _super);
	    function GastRefResolverVisitor2(nameToTopRule, errMsgProvider) {
	      var _this = _super.call(this) || this;
	      _this.nameToTopRule = nameToTopRule;
	      _this.errMsgProvider = errMsgProvider;
	      _this.errors = [];
	      return _this;
	    }
	    GastRefResolverVisitor2.prototype.resolveRefs = function() {
	      var _this = this;
	      (0, forEach_1.default)((0, values_1.default)(this.nameToTopRule), function(prod) {
	        _this.currTopLevel = prod;
	        prod.accept(_this);
	      });
	    };
	    GastRefResolverVisitor2.prototype.visitNonTerminal = function(node) {
	      var ref = this.nameToTopRule[node.nonTerminalName];
	      if (!ref) {
	        var msg = this.errMsgProvider.buildRuleNotFoundError(this.currTopLevel, node);
	        this.errors.push({
	          message: msg,
	          type: parser_1.ParserDefinitionErrorType.UNRESOLVED_SUBRULE_REF,
	          ruleName: this.currTopLevel.name,
	          unresolvedRefName: node.nonTerminalName
	        });
	      } else {
	        node.referencedRule = ref;
	      }
	    };
	    return GastRefResolverVisitor2;
	  })(gast_1.GAstVisitor)
	);
	resolver.GastRefResolverVisitor = GastRefResolverVisitor;
	return resolver;
}

var checks = {};

var _arrayAggregator;
var hasRequired_arrayAggregator;

function require_arrayAggregator () {
	if (hasRequired_arrayAggregator) return _arrayAggregator;
	hasRequired_arrayAggregator = 1;
	function arrayAggregator(array, setter, iteratee, accumulator) {
	  var index = -1, length = array == null ? 0 : array.length;
	  while (++index < length) {
	    var value = array[index];
	    setter(accumulator, value, iteratee(value), array);
	  }
	  return accumulator;
	}
	_arrayAggregator = arrayAggregator;
	return _arrayAggregator;
}

var _baseAggregator;
var hasRequired_baseAggregator;

function require_baseAggregator () {
	if (hasRequired_baseAggregator) return _baseAggregator;
	hasRequired_baseAggregator = 1;
	var baseEach = require_baseEach();
	function baseAggregator(collection, setter, iteratee, accumulator) {
	  baseEach(collection, function(value, key, collection2) {
	    setter(accumulator, value, iteratee(value), collection2);
	  });
	  return accumulator;
	}
	_baseAggregator = baseAggregator;
	return _baseAggregator;
}

var _createAggregator;
var hasRequired_createAggregator;

function require_createAggregator () {
	if (hasRequired_createAggregator) return _createAggregator;
	hasRequired_createAggregator = 1;
	var arrayAggregator = require_arrayAggregator(), baseAggregator = require_baseAggregator(), baseIteratee = require_baseIteratee(), isArray = requireIsArray();
	function createAggregator(setter, initializer) {
	  return function(collection, iteratee) {
	    var func = isArray(collection) ? arrayAggregator : baseAggregator, accumulator = initializer ? initializer() : {};
	    return func(collection, setter, baseIteratee(iteratee, 2), accumulator);
	  };
	}
	_createAggregator = createAggregator;
	return _createAggregator;
}

var groupBy_1;
var hasRequiredGroupBy;

function requireGroupBy () {
	if (hasRequiredGroupBy) return groupBy_1;
	hasRequiredGroupBy = 1;
	var baseAssignValue = require_baseAssignValue(), createAggregator = require_createAggregator();
	var objectProto = Object.prototype;
	var hasOwnProperty = objectProto.hasOwnProperty;
	var groupBy = createAggregator(function(result, value, key) {
	  if (hasOwnProperty.call(result, key)) {
	    result[key].push(value);
	  } else {
	    baseAssignValue(result, key, [value]);
	  }
	});
	groupBy_1 = groupBy;
	return groupBy_1;
}

var flatMap_1;
var hasRequiredFlatMap;

function requireFlatMap () {
	if (hasRequiredFlatMap) return flatMap_1;
	hasRequiredFlatMap = 1;
	var baseFlatten = require_baseFlatten(), map = requireMap();
	function flatMap(collection, iteratee) {
	  return baseFlatten(map(collection, iteratee), 1);
	}
	flatMap_1 = flatMap;
	return flatMap_1;
}

var lookahead = {};

var interpreter = {};

var dropRight_1;
var hasRequiredDropRight;

function requireDropRight () {
	if (hasRequiredDropRight) return dropRight_1;
	hasRequiredDropRight = 1;
	var baseSlice = require_baseSlice(), toInteger = requireToInteger();
	function dropRight(array, n, guard) {
	  var length = array == null ? 0 : array.length;
	  if (!length) {
	    return [];
	  }
	  n = guard || n === void 0 ? 1 : toInteger(n);
	  n = length - n;
	  return baseSlice(array, 0, n < 0 ? 0 : n);
	}
	dropRight_1 = dropRight;
	return dropRight_1;
}

var hasRequiredInterpreter;

function requireInterpreter () {
	if (hasRequiredInterpreter) return interpreter;
	hasRequiredInterpreter = 1;
	var __extends = interpreter && interpreter.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __importDefault = interpreter && interpreter.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(interpreter, "__esModule", { value: true });
	interpreter.nextPossibleTokensAfter = interpreter.possiblePathsFrom = interpreter.NextTerminalAfterAtLeastOneSepWalker = interpreter.NextTerminalAfterAtLeastOneWalker = interpreter.NextTerminalAfterManySepWalker = interpreter.NextTerminalAfterManyWalker = interpreter.AbstractNextTerminalAfterProductionWalker = interpreter.NextAfterTokenWalker = interpreter.AbstractNextPossibleTokensWalker = void 0;
	var rest_1 = requireRest();
	var first_1 = __importDefault(requireFirst());
	var isEmpty_1 = __importDefault(requireIsEmpty());
	var dropRight_1 = __importDefault(requireDropRight());
	var drop_1 = __importDefault(requireDrop());
	var last_1 = __importDefault(requireLast());
	var forEach_1 = __importDefault(requireForEach());
	var clone_1 = __importDefault(requireClone());
	var first_2 = requireFirst$1();
	var gast_1 = requireApi$2();
	var AbstractNextPossibleTokensWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(AbstractNextPossibleTokensWalker2, _super);
	    function AbstractNextPossibleTokensWalker2(topProd, path) {
	      var _this = _super.call(this) || this;
	      _this.topProd = topProd;
	      _this.path = path;
	      _this.possibleTokTypes = [];
	      _this.nextProductionName = "";
	      _this.nextProductionOccurrence = 0;
	      _this.found = false;
	      _this.isAtEndOfPath = false;
	      return _this;
	    }
	    AbstractNextPossibleTokensWalker2.prototype.startWalking = function() {
	      this.found = false;
	      if (this.path.ruleStack[0] !== this.topProd.name) {
	        throw Error("The path does not start with the walker's top Rule!");
	      }
	      this.ruleStack = (0, clone_1.default)(this.path.ruleStack).reverse();
	      this.occurrenceStack = (0, clone_1.default)(this.path.occurrenceStack).reverse();
	      this.ruleStack.pop();
	      this.occurrenceStack.pop();
	      this.updateExpectedNext();
	      this.walk(this.topProd);
	      return this.possibleTokTypes;
	    };
	    AbstractNextPossibleTokensWalker2.prototype.walk = function(prod, prevRest) {
	      if (prevRest === void 0) {
	        prevRest = [];
	      }
	      if (!this.found) {
	        _super.prototype.walk.call(this, prod, prevRest);
	      }
	    };
	    AbstractNextPossibleTokensWalker2.prototype.walkProdRef = function(refProd, currRest, prevRest) {
	      if (refProd.referencedRule.name === this.nextProductionName && refProd.idx === this.nextProductionOccurrence) {
	        var fullRest = currRest.concat(prevRest);
	        this.updateExpectedNext();
	        this.walk(refProd.referencedRule, fullRest);
	      }
	    };
	    AbstractNextPossibleTokensWalker2.prototype.updateExpectedNext = function() {
	      if ((0, isEmpty_1.default)(this.ruleStack)) {
	        this.nextProductionName = "";
	        this.nextProductionOccurrence = 0;
	        this.isAtEndOfPath = true;
	      } else {
	        this.nextProductionName = this.ruleStack.pop();
	        this.nextProductionOccurrence = this.occurrenceStack.pop();
	      }
	    };
	    return AbstractNextPossibleTokensWalker2;
	  })(rest_1.RestWalker)
	);
	interpreter.AbstractNextPossibleTokensWalker = AbstractNextPossibleTokensWalker;
	var NextAfterTokenWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(NextAfterTokenWalker2, _super);
	    function NextAfterTokenWalker2(topProd, path) {
	      var _this = _super.call(this, topProd, path) || this;
	      _this.path = path;
	      _this.nextTerminalName = "";
	      _this.nextTerminalOccurrence = 0;
	      _this.nextTerminalName = _this.path.lastTok.name;
	      _this.nextTerminalOccurrence = _this.path.lastTokOccurrence;
	      return _this;
	    }
	    NextAfterTokenWalker2.prototype.walkTerminal = function(terminal, currRest, prevRest) {
	      if (this.isAtEndOfPath && terminal.terminalType.name === this.nextTerminalName && terminal.idx === this.nextTerminalOccurrence && !this.found) {
	        var fullRest = currRest.concat(prevRest);
	        var restProd = new gast_1.Alternative({ definition: fullRest });
	        this.possibleTokTypes = (0, first_2.first)(restProd);
	        this.found = true;
	      }
	    };
	    return NextAfterTokenWalker2;
	  })(AbstractNextPossibleTokensWalker)
	);
	interpreter.NextAfterTokenWalker = NextAfterTokenWalker;
	var AbstractNextTerminalAfterProductionWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(AbstractNextTerminalAfterProductionWalker2, _super);
	    function AbstractNextTerminalAfterProductionWalker2(topRule, occurrence) {
	      var _this = _super.call(this) || this;
	      _this.topRule = topRule;
	      _this.occurrence = occurrence;
	      _this.result = {
	        token: void 0,
	        occurrence: void 0,
	        isEndOfRule: void 0
	      };
	      return _this;
	    }
	    AbstractNextTerminalAfterProductionWalker2.prototype.startWalking = function() {
	      this.walk(this.topRule);
	      return this.result;
	    };
	    return AbstractNextTerminalAfterProductionWalker2;
	  })(rest_1.RestWalker)
	);
	interpreter.AbstractNextTerminalAfterProductionWalker = AbstractNextTerminalAfterProductionWalker;
	var NextTerminalAfterManyWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(NextTerminalAfterManyWalker2, _super);
	    function NextTerminalAfterManyWalker2() {
	      return _super !== null && _super.apply(this, arguments) || this;
	    }
	    NextTerminalAfterManyWalker2.prototype.walkMany = function(manyProd, currRest, prevRest) {
	      if (manyProd.idx === this.occurrence) {
	        var firstAfterMany = (0, first_1.default)(currRest.concat(prevRest));
	        this.result.isEndOfRule = firstAfterMany === void 0;
	        if (firstAfterMany instanceof gast_1.Terminal) {
	          this.result.token = firstAfterMany.terminalType;
	          this.result.occurrence = firstAfterMany.idx;
	        }
	      } else {
	        _super.prototype.walkMany.call(this, manyProd, currRest, prevRest);
	      }
	    };
	    return NextTerminalAfterManyWalker2;
	  })(AbstractNextTerminalAfterProductionWalker)
	);
	interpreter.NextTerminalAfterManyWalker = NextTerminalAfterManyWalker;
	var NextTerminalAfterManySepWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(NextTerminalAfterManySepWalker2, _super);
	    function NextTerminalAfterManySepWalker2() {
	      return _super !== null && _super.apply(this, arguments) || this;
	    }
	    NextTerminalAfterManySepWalker2.prototype.walkManySep = function(manySepProd, currRest, prevRest) {
	      if (manySepProd.idx === this.occurrence) {
	        var firstAfterManySep = (0, first_1.default)(currRest.concat(prevRest));
	        this.result.isEndOfRule = firstAfterManySep === void 0;
	        if (firstAfterManySep instanceof gast_1.Terminal) {
	          this.result.token = firstAfterManySep.terminalType;
	          this.result.occurrence = firstAfterManySep.idx;
	        }
	      } else {
	        _super.prototype.walkManySep.call(this, manySepProd, currRest, prevRest);
	      }
	    };
	    return NextTerminalAfterManySepWalker2;
	  })(AbstractNextTerminalAfterProductionWalker)
	);
	interpreter.NextTerminalAfterManySepWalker = NextTerminalAfterManySepWalker;
	var NextTerminalAfterAtLeastOneWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(NextTerminalAfterAtLeastOneWalker2, _super);
	    function NextTerminalAfterAtLeastOneWalker2() {
	      return _super !== null && _super.apply(this, arguments) || this;
	    }
	    NextTerminalAfterAtLeastOneWalker2.prototype.walkAtLeastOne = function(atLeastOneProd, currRest, prevRest) {
	      if (atLeastOneProd.idx === this.occurrence) {
	        var firstAfterAtLeastOne = (0, first_1.default)(currRest.concat(prevRest));
	        this.result.isEndOfRule = firstAfterAtLeastOne === void 0;
	        if (firstAfterAtLeastOne instanceof gast_1.Terminal) {
	          this.result.token = firstAfterAtLeastOne.terminalType;
	          this.result.occurrence = firstAfterAtLeastOne.idx;
	        }
	      } else {
	        _super.prototype.walkAtLeastOne.call(this, atLeastOneProd, currRest, prevRest);
	      }
	    };
	    return NextTerminalAfterAtLeastOneWalker2;
	  })(AbstractNextTerminalAfterProductionWalker)
	);
	interpreter.NextTerminalAfterAtLeastOneWalker = NextTerminalAfterAtLeastOneWalker;
	var NextTerminalAfterAtLeastOneSepWalker = (
	  /** @class */
	  (function(_super) {
	    __extends(NextTerminalAfterAtLeastOneSepWalker2, _super);
	    function NextTerminalAfterAtLeastOneSepWalker2() {
	      return _super !== null && _super.apply(this, arguments) || this;
	    }
	    NextTerminalAfterAtLeastOneSepWalker2.prototype.walkAtLeastOneSep = function(atleastOneSepProd, currRest, prevRest) {
	      if (atleastOneSepProd.idx === this.occurrence) {
	        var firstAfterfirstAfterAtLeastOneSep = (0, first_1.default)(currRest.concat(prevRest));
	        this.result.isEndOfRule = firstAfterfirstAfterAtLeastOneSep === void 0;
	        if (firstAfterfirstAfterAtLeastOneSep instanceof gast_1.Terminal) {
	          this.result.token = firstAfterfirstAfterAtLeastOneSep.terminalType;
	          this.result.occurrence = firstAfterfirstAfterAtLeastOneSep.idx;
	        }
	      } else {
	        _super.prototype.walkAtLeastOneSep.call(this, atleastOneSepProd, currRest, prevRest);
	      }
	    };
	    return NextTerminalAfterAtLeastOneSepWalker2;
	  })(AbstractNextTerminalAfterProductionWalker)
	);
	interpreter.NextTerminalAfterAtLeastOneSepWalker = NextTerminalAfterAtLeastOneSepWalker;
	function possiblePathsFrom(targetDef, maxLength, currPath) {
	  if (currPath === void 0) {
	    currPath = [];
	  }
	  currPath = (0, clone_1.default)(currPath);
	  var result = [];
	  var i = 0;
	  function remainingPathWith(nextDef) {
	    return nextDef.concat((0, drop_1.default)(targetDef, i + 1));
	  }
	  function getAlternativesForProd(definition) {
	    var alternatives = possiblePathsFrom(remainingPathWith(definition), maxLength, currPath);
	    return result.concat(alternatives);
	  }
	  while (currPath.length < maxLength && i < targetDef.length) {
	    var prod = targetDef[i];
	    if (prod instanceof gast_1.Alternative) {
	      return getAlternativesForProd(prod.definition);
	    } else if (prod instanceof gast_1.NonTerminal) {
	      return getAlternativesForProd(prod.definition);
	    } else if (prod instanceof gast_1.Option) {
	      result = getAlternativesForProd(prod.definition);
	    } else if (prod instanceof gast_1.RepetitionMandatory) {
	      var newDef = prod.definition.concat([
	        new gast_1.Repetition({
	          definition: prod.definition
	        })
	      ]);
	      return getAlternativesForProd(newDef);
	    } else if (prod instanceof gast_1.RepetitionMandatoryWithSeparator) {
	      var newDef = [
	        new gast_1.Alternative({ definition: prod.definition }),
	        new gast_1.Repetition({
	          definition: [new gast_1.Terminal({ terminalType: prod.separator })].concat(prod.definition)
	        })
	      ];
	      return getAlternativesForProd(newDef);
	    } else if (prod instanceof gast_1.RepetitionWithSeparator) {
	      var newDef = prod.definition.concat([
	        new gast_1.Repetition({
	          definition: [new gast_1.Terminal({ terminalType: prod.separator })].concat(prod.definition)
	        })
	      ]);
	      result = getAlternativesForProd(newDef);
	    } else if (prod instanceof gast_1.Repetition) {
	      var newDef = prod.definition.concat([
	        new gast_1.Repetition({
	          definition: prod.definition
	        })
	      ]);
	      result = getAlternativesForProd(newDef);
	    } else if (prod instanceof gast_1.Alternation) {
	      (0, forEach_1.default)(prod.definition, function(currAlt) {
	        if ((0, isEmpty_1.default)(currAlt.definition) === false) {
	          result = getAlternativesForProd(currAlt.definition);
	        }
	      });
	      return result;
	    } else if (prod instanceof gast_1.Terminal) {
	      currPath.push(prod.terminalType);
	    } else {
	      throw Error("non exhaustive match");
	    }
	    i++;
	  }
	  result.push({
	    partialPath: currPath,
	    suffixDef: (0, drop_1.default)(targetDef, i)
	  });
	  return result;
	}
	interpreter.possiblePathsFrom = possiblePathsFrom;
	function nextPossibleTokensAfter(initialDef, tokenVector, tokMatcher, maxLookAhead) {
	  var EXIT_NON_TERMINAL = "EXIT_NONE_TERMINAL";
	  var EXIT_NON_TERMINAL_ARR = [EXIT_NON_TERMINAL];
	  var EXIT_ALTERNATIVE = "EXIT_ALTERNATIVE";
	  var foundCompletePath = false;
	  var tokenVectorLength = tokenVector.length;
	  var minimalAlternativesIndex = tokenVectorLength - maxLookAhead - 1;
	  var result = [];
	  var possiblePaths = [];
	  possiblePaths.push({
	    idx: -1,
	    def: initialDef,
	    ruleStack: [],
	    occurrenceStack: []
	  });
	  while (!(0, isEmpty_1.default)(possiblePaths)) {
	    var currPath = possiblePaths.pop();
	    if (currPath === EXIT_ALTERNATIVE) {
	      if (foundCompletePath && (0, last_1.default)(possiblePaths).idx <= minimalAlternativesIndex) {
	        possiblePaths.pop();
	      }
	      continue;
	    }
	    var currDef = currPath.def;
	    var currIdx = currPath.idx;
	    var currRuleStack = currPath.ruleStack;
	    var currOccurrenceStack = currPath.occurrenceStack;
	    if ((0, isEmpty_1.default)(currDef)) {
	      continue;
	    }
	    var prod = currDef[0];
	    if (prod === EXIT_NON_TERMINAL) {
	      var nextPath = {
	        idx: currIdx,
	        def: (0, drop_1.default)(currDef),
	        ruleStack: (0, dropRight_1.default)(currRuleStack),
	        occurrenceStack: (0, dropRight_1.default)(currOccurrenceStack)
	      };
	      possiblePaths.push(nextPath);
	    } else if (prod instanceof gast_1.Terminal) {
	      if (currIdx < tokenVectorLength - 1) {
	        var nextIdx = currIdx + 1;
	        var actualToken = tokenVector[nextIdx];
	        if (tokMatcher(actualToken, prod.terminalType)) {
	          var nextPath = {
	            idx: nextIdx,
	            def: (0, drop_1.default)(currDef),
	            ruleStack: currRuleStack,
	            occurrenceStack: currOccurrenceStack
	          };
	          possiblePaths.push(nextPath);
	        }
	      } else if (currIdx === tokenVectorLength - 1) {
	        result.push({
	          nextTokenType: prod.terminalType,
	          nextTokenOccurrence: prod.idx,
	          ruleStack: currRuleStack,
	          occurrenceStack: currOccurrenceStack
	        });
	        foundCompletePath = true;
	      } else {
	        throw Error("non exhaustive match");
	      }
	    } else if (prod instanceof gast_1.NonTerminal) {
	      var newRuleStack = (0, clone_1.default)(currRuleStack);
	      newRuleStack.push(prod.nonTerminalName);
	      var newOccurrenceStack = (0, clone_1.default)(currOccurrenceStack);
	      newOccurrenceStack.push(prod.idx);
	      var nextPath = {
	        idx: currIdx,
	        def: prod.definition.concat(EXIT_NON_TERMINAL_ARR, (0, drop_1.default)(currDef)),
	        ruleStack: newRuleStack,
	        occurrenceStack: newOccurrenceStack
	      };
	      possiblePaths.push(nextPath);
	    } else if (prod instanceof gast_1.Option) {
	      var nextPathWithout = {
	        idx: currIdx,
	        def: (0, drop_1.default)(currDef),
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPathWithout);
	      possiblePaths.push(EXIT_ALTERNATIVE);
	      var nextPathWith = {
	        idx: currIdx,
	        def: prod.definition.concat((0, drop_1.default)(currDef)),
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPathWith);
	    } else if (prod instanceof gast_1.RepetitionMandatory) {
	      var secondIteration = new gast_1.Repetition({
	        definition: prod.definition,
	        idx: prod.idx
	      });
	      var nextDef = prod.definition.concat([secondIteration], (0, drop_1.default)(currDef));
	      var nextPath = {
	        idx: currIdx,
	        def: nextDef,
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPath);
	    } else if (prod instanceof gast_1.RepetitionMandatoryWithSeparator) {
	      var separatorGast = new gast_1.Terminal({
	        terminalType: prod.separator
	      });
	      var secondIteration = new gast_1.Repetition({
	        definition: [separatorGast].concat(prod.definition),
	        idx: prod.idx
	      });
	      var nextDef = prod.definition.concat([secondIteration], (0, drop_1.default)(currDef));
	      var nextPath = {
	        idx: currIdx,
	        def: nextDef,
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPath);
	    } else if (prod instanceof gast_1.RepetitionWithSeparator) {
	      var nextPathWithout = {
	        idx: currIdx,
	        def: (0, drop_1.default)(currDef),
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPathWithout);
	      possiblePaths.push(EXIT_ALTERNATIVE);
	      var separatorGast = new gast_1.Terminal({
	        terminalType: prod.separator
	      });
	      var nthRepetition = new gast_1.Repetition({
	        definition: [separatorGast].concat(prod.definition),
	        idx: prod.idx
	      });
	      var nextDef = prod.definition.concat([nthRepetition], (0, drop_1.default)(currDef));
	      var nextPathWith = {
	        idx: currIdx,
	        def: nextDef,
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPathWith);
	    } else if (prod instanceof gast_1.Repetition) {
	      var nextPathWithout = {
	        idx: currIdx,
	        def: (0, drop_1.default)(currDef),
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPathWithout);
	      possiblePaths.push(EXIT_ALTERNATIVE);
	      var nthRepetition = new gast_1.Repetition({
	        definition: prod.definition,
	        idx: prod.idx
	      });
	      var nextDef = prod.definition.concat([nthRepetition], (0, drop_1.default)(currDef));
	      var nextPathWith = {
	        idx: currIdx,
	        def: nextDef,
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      };
	      possiblePaths.push(nextPathWith);
	    } else if (prod instanceof gast_1.Alternation) {
	      for (var i = prod.definition.length - 1; i >= 0; i--) {
	        var currAlt = prod.definition[i];
	        var currAltPath = {
	          idx: currIdx,
	          def: currAlt.definition.concat((0, drop_1.default)(currDef)),
	          ruleStack: currRuleStack,
	          occurrenceStack: currOccurrenceStack
	        };
	        possiblePaths.push(currAltPath);
	        possiblePaths.push(EXIT_ALTERNATIVE);
	      }
	    } else if (prod instanceof gast_1.Alternative) {
	      possiblePaths.push({
	        idx: currIdx,
	        def: prod.definition.concat((0, drop_1.default)(currDef)),
	        ruleStack: currRuleStack,
	        occurrenceStack: currOccurrenceStack
	      });
	    } else if (prod instanceof gast_1.Rule) {
	      possiblePaths.push(expandTopLevelRule(prod, currIdx, currRuleStack, currOccurrenceStack));
	    } else {
	      throw Error("non exhaustive match");
	    }
	  }
	  return result;
	}
	interpreter.nextPossibleTokensAfter = nextPossibleTokensAfter;
	function expandTopLevelRule(topRule, currIdx, currRuleStack, currOccurrenceStack) {
	  var newRuleStack = (0, clone_1.default)(currRuleStack);
	  newRuleStack.push(topRule.name);
	  var newCurrOccurrenceStack = (0, clone_1.default)(currOccurrenceStack);
	  newCurrOccurrenceStack.push(1);
	  return {
	    idx: currIdx,
	    def: topRule.definition,
	    ruleStack: newRuleStack,
	    occurrenceStack: newCurrOccurrenceStack
	  };
	}
	return interpreter;
}

var hasRequiredLookahead;

function requireLookahead () {
	if (hasRequiredLookahead) return lookahead;
	hasRequiredLookahead = 1;
	(function (exports$1) {
		var __extends = lookahead && lookahead.__extends || /* @__PURE__ */ (function() {
		  var extendStatics = function(d, b) {
		    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
		      d2.__proto__ = b2;
		    } || function(d2, b2) {
		      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
		    };
		    return extendStatics(d, b);
		  };
		  return function(d, b) {
		    if (typeof b !== "function" && b !== null)
		      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
		    extendStatics(d, b);
		    function __() {
		      this.constructor = d;
		    }
		    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		  };
		})();
		var __importDefault = lookahead && lookahead.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.areTokenCategoriesNotUsed = exports$1.isStrictPrefixOfPath = exports$1.containsPath = exports$1.getLookaheadPathsForOptionalProd = exports$1.getLookaheadPathsForOr = exports$1.lookAheadSequenceFromAlternatives = exports$1.buildSingleAlternativeLookaheadFunction = exports$1.buildAlternativesLookAheadFunc = exports$1.buildLookaheadFuncForOptionalProd = exports$1.buildLookaheadFuncForOr = exports$1.getLookaheadPaths = exports$1.getProdType = exports$1.PROD_TYPE = void 0;
		var isEmpty_1 = __importDefault(requireIsEmpty());
		var flatten_1 = __importDefault(requireFlatten());
		var every_1 = __importDefault(requireEvery());
		var map_1 = __importDefault(requireMap());
		var forEach_1 = __importDefault(requireForEach());
		var has_1 = __importDefault(requireHas());
		var reduce_1 = __importDefault(requireReduce());
		var interpreter_1 = requireInterpreter();
		var rest_1 = requireRest();
		var tokens_1 = requireTokens();
		var gast_1 = requireApi$2();
		var gast_2 = requireApi$2();
		var PROD_TYPE;
		(function(PROD_TYPE2) {
		  PROD_TYPE2[PROD_TYPE2["OPTION"] = 0] = "OPTION";
		  PROD_TYPE2[PROD_TYPE2["REPETITION"] = 1] = "REPETITION";
		  PROD_TYPE2[PROD_TYPE2["REPETITION_MANDATORY"] = 2] = "REPETITION_MANDATORY";
		  PROD_TYPE2[PROD_TYPE2["REPETITION_MANDATORY_WITH_SEPARATOR"] = 3] = "REPETITION_MANDATORY_WITH_SEPARATOR";
		  PROD_TYPE2[PROD_TYPE2["REPETITION_WITH_SEPARATOR"] = 4] = "REPETITION_WITH_SEPARATOR";
		  PROD_TYPE2[PROD_TYPE2["ALTERNATION"] = 5] = "ALTERNATION";
		})(PROD_TYPE = exports$1.PROD_TYPE || (exports$1.PROD_TYPE = {}));
		function getProdType(prod) {
		  if (prod instanceof gast_1.Option || prod === "Option") {
		    return PROD_TYPE.OPTION;
		  } else if (prod instanceof gast_1.Repetition || prod === "Repetition") {
		    return PROD_TYPE.REPETITION;
		  } else if (prod instanceof gast_1.RepetitionMandatory || prod === "RepetitionMandatory") {
		    return PROD_TYPE.REPETITION_MANDATORY;
		  } else if (prod instanceof gast_1.RepetitionMandatoryWithSeparator || prod === "RepetitionMandatoryWithSeparator") {
		    return PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR;
		  } else if (prod instanceof gast_1.RepetitionWithSeparator || prod === "RepetitionWithSeparator") {
		    return PROD_TYPE.REPETITION_WITH_SEPARATOR;
		  } else if (prod instanceof gast_1.Alternation || prod === "Alternation") {
		    return PROD_TYPE.ALTERNATION;
		  } else {
		    throw Error("non exhaustive match");
		  }
		}
		exports$1.getProdType = getProdType;
		function getLookaheadPaths(options) {
		  var occurrence = options.occurrence, rule = options.rule, prodType = options.prodType, maxLookahead = options.maxLookahead;
		  var type = getProdType(prodType);
		  if (type === PROD_TYPE.ALTERNATION) {
		    return getLookaheadPathsForOr(occurrence, rule, maxLookahead);
		  } else {
		    return getLookaheadPathsForOptionalProd(occurrence, rule, type, maxLookahead);
		  }
		}
		exports$1.getLookaheadPaths = getLookaheadPaths;
		function buildLookaheadFuncForOr(occurrence, ruleGrammar, maxLookahead, hasPredicates, dynamicTokensEnabled, laFuncBuilder) {
		  var lookAheadPaths = getLookaheadPathsForOr(occurrence, ruleGrammar, maxLookahead);
		  var tokenMatcher = areTokenCategoriesNotUsed(lookAheadPaths) ? tokens_1.tokenStructuredMatcherNoCategories : tokens_1.tokenStructuredMatcher;
		  return laFuncBuilder(lookAheadPaths, hasPredicates, tokenMatcher, dynamicTokensEnabled);
		}
		exports$1.buildLookaheadFuncForOr = buildLookaheadFuncForOr;
		function buildLookaheadFuncForOptionalProd(occurrence, ruleGrammar, k, dynamicTokensEnabled, prodType, lookaheadBuilder) {
		  var lookAheadPaths = getLookaheadPathsForOptionalProd(occurrence, ruleGrammar, prodType, k);
		  var tokenMatcher = areTokenCategoriesNotUsed(lookAheadPaths) ? tokens_1.tokenStructuredMatcherNoCategories : tokens_1.tokenStructuredMatcher;
		  return lookaheadBuilder(lookAheadPaths[0], tokenMatcher, dynamicTokensEnabled);
		}
		exports$1.buildLookaheadFuncForOptionalProd = buildLookaheadFuncForOptionalProd;
		function buildAlternativesLookAheadFunc(alts, hasPredicates, tokenMatcher, dynamicTokensEnabled) {
		  var numOfAlts = alts.length;
		  var areAllOneTokenLookahead = (0, every_1.default)(alts, function(currAlt) {
		    return (0, every_1.default)(currAlt, function(currPath) {
		      return currPath.length === 1;
		    });
		  });
		  if (hasPredicates) {
		    return function(orAlts) {
		      var predicates = (0, map_1.default)(orAlts, function(currAlt2) {
		        return currAlt2.GATE;
		      });
		      for (var t = 0; t < numOfAlts; t++) {
		        var currAlt = alts[t];
		        var currNumOfPaths = currAlt.length;
		        var currPredicate = predicates[t];
		        if (currPredicate !== void 0 && currPredicate.call(this) === false) {
		          continue;
		        }
		        nextPath: for (var j = 0; j < currNumOfPaths; j++) {
		          var currPath = currAlt[j];
		          var currPathLength = currPath.length;
		          for (var i = 0; i < currPathLength; i++) {
		            var nextToken = this.LA(i + 1);
		            if (tokenMatcher(nextToken, currPath[i]) === false) {
		              continue nextPath;
		            }
		          }
		          return t;
		        }
		      }
		      return void 0;
		    };
		  } else if (areAllOneTokenLookahead && !dynamicTokensEnabled) {
		    var singleTokenAlts = (0, map_1.default)(alts, function(currAlt) {
		      return (0, flatten_1.default)(currAlt);
		    });
		    var choiceToAlt_1 = (0, reduce_1.default)(singleTokenAlts, function(result, currAlt, idx) {
		      (0, forEach_1.default)(currAlt, function(currTokType) {
		        if (!(0, has_1.default)(result, currTokType.tokenTypeIdx)) {
		          result[currTokType.tokenTypeIdx] = idx;
		        }
		        (0, forEach_1.default)(currTokType.categoryMatches, function(currExtendingType) {
		          if (!(0, has_1.default)(result, currExtendingType)) {
		            result[currExtendingType] = idx;
		          }
		        });
		      });
		      return result;
		    }, {});
		    return function() {
		      var nextToken = this.LA(1);
		      return choiceToAlt_1[nextToken.tokenTypeIdx];
		    };
		  } else {
		    return function() {
		      for (var t = 0; t < numOfAlts; t++) {
		        var currAlt = alts[t];
		        var currNumOfPaths = currAlt.length;
		        nextPath: for (var j = 0; j < currNumOfPaths; j++) {
		          var currPath = currAlt[j];
		          var currPathLength = currPath.length;
		          for (var i = 0; i < currPathLength; i++) {
		            var nextToken = this.LA(i + 1);
		            if (tokenMatcher(nextToken, currPath[i]) === false) {
		              continue nextPath;
		            }
		          }
		          return t;
		        }
		      }
		      return void 0;
		    };
		  }
		}
		exports$1.buildAlternativesLookAheadFunc = buildAlternativesLookAheadFunc;
		function buildSingleAlternativeLookaheadFunction(alt, tokenMatcher, dynamicTokensEnabled) {
		  var areAllOneTokenLookahead = (0, every_1.default)(alt, function(currPath) {
		    return currPath.length === 1;
		  });
		  var numOfPaths = alt.length;
		  if (areAllOneTokenLookahead && !dynamicTokensEnabled) {
		    var singleTokensTypes = (0, flatten_1.default)(alt);
		    if (singleTokensTypes.length === 1 && (0, isEmpty_1.default)(singleTokensTypes[0].categoryMatches)) {
		      var expectedTokenType = singleTokensTypes[0];
		      var expectedTokenUniqueKey_1 = expectedTokenType.tokenTypeIdx;
		      return function() {
		        return this.LA(1).tokenTypeIdx === expectedTokenUniqueKey_1;
		      };
		    } else {
		      var choiceToAlt_2 = (0, reduce_1.default)(singleTokensTypes, function(result, currTokType, idx) {
		        result[currTokType.tokenTypeIdx] = true;
		        (0, forEach_1.default)(currTokType.categoryMatches, function(currExtendingType) {
		          result[currExtendingType] = true;
		        });
		        return result;
		      }, []);
		      return function() {
		        var nextToken = this.LA(1);
		        return choiceToAlt_2[nextToken.tokenTypeIdx] === true;
		      };
		    }
		  } else {
		    return function() {
		      nextPath: for (var j = 0; j < numOfPaths; j++) {
		        var currPath = alt[j];
		        var currPathLength = currPath.length;
		        for (var i = 0; i < currPathLength; i++) {
		          var nextToken = this.LA(i + 1);
		          if (tokenMatcher(nextToken, currPath[i]) === false) {
		            continue nextPath;
		          }
		        }
		        return true;
		      }
		      return false;
		    };
		  }
		}
		exports$1.buildSingleAlternativeLookaheadFunction = buildSingleAlternativeLookaheadFunction;
		var RestDefinitionFinderWalker = (
		  /** @class */
		  (function(_super) {
		    __extends(RestDefinitionFinderWalker2, _super);
		    function RestDefinitionFinderWalker2(topProd, targetOccurrence, targetProdType) {
		      var _this = _super.call(this) || this;
		      _this.topProd = topProd;
		      _this.targetOccurrence = targetOccurrence;
		      _this.targetProdType = targetProdType;
		      return _this;
		    }
		    RestDefinitionFinderWalker2.prototype.startWalking = function() {
		      this.walk(this.topProd);
		      return this.restDef;
		    };
		    RestDefinitionFinderWalker2.prototype.checkIsTarget = function(node, expectedProdType, currRest, prevRest) {
		      if (node.idx === this.targetOccurrence && this.targetProdType === expectedProdType) {
		        this.restDef = currRest.concat(prevRest);
		        return true;
		      }
		      return false;
		    };
		    RestDefinitionFinderWalker2.prototype.walkOption = function(optionProd, currRest, prevRest) {
		      if (!this.checkIsTarget(optionProd, PROD_TYPE.OPTION, currRest, prevRest)) {
		        _super.prototype.walkOption.call(this, optionProd, currRest, prevRest);
		      }
		    };
		    RestDefinitionFinderWalker2.prototype.walkAtLeastOne = function(atLeastOneProd, currRest, prevRest) {
		      if (!this.checkIsTarget(atLeastOneProd, PROD_TYPE.REPETITION_MANDATORY, currRest, prevRest)) {
		        _super.prototype.walkOption.call(this, atLeastOneProd, currRest, prevRest);
		      }
		    };
		    RestDefinitionFinderWalker2.prototype.walkAtLeastOneSep = function(atLeastOneSepProd, currRest, prevRest) {
		      if (!this.checkIsTarget(atLeastOneSepProd, PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR, currRest, prevRest)) {
		        _super.prototype.walkOption.call(this, atLeastOneSepProd, currRest, prevRest);
		      }
		    };
		    RestDefinitionFinderWalker2.prototype.walkMany = function(manyProd, currRest, prevRest) {
		      if (!this.checkIsTarget(manyProd, PROD_TYPE.REPETITION, currRest, prevRest)) {
		        _super.prototype.walkOption.call(this, manyProd, currRest, prevRest);
		      }
		    };
		    RestDefinitionFinderWalker2.prototype.walkManySep = function(manySepProd, currRest, prevRest) {
		      if (!this.checkIsTarget(manySepProd, PROD_TYPE.REPETITION_WITH_SEPARATOR, currRest, prevRest)) {
		        _super.prototype.walkOption.call(this, manySepProd, currRest, prevRest);
		      }
		    };
		    return RestDefinitionFinderWalker2;
		  })(rest_1.RestWalker)
		);
		var InsideDefinitionFinderVisitor = (
		  /** @class */
		  (function(_super) {
		    __extends(InsideDefinitionFinderVisitor2, _super);
		    function InsideDefinitionFinderVisitor2(targetOccurrence, targetProdType, targetRef) {
		      var _this = _super.call(this) || this;
		      _this.targetOccurrence = targetOccurrence;
		      _this.targetProdType = targetProdType;
		      _this.targetRef = targetRef;
		      _this.result = [];
		      return _this;
		    }
		    InsideDefinitionFinderVisitor2.prototype.checkIsTarget = function(node, expectedProdName) {
		      if (node.idx === this.targetOccurrence && this.targetProdType === expectedProdName && (this.targetRef === void 0 || node === this.targetRef)) {
		        this.result = node.definition;
		      }
		    };
		    InsideDefinitionFinderVisitor2.prototype.visitOption = function(node) {
		      this.checkIsTarget(node, PROD_TYPE.OPTION);
		    };
		    InsideDefinitionFinderVisitor2.prototype.visitRepetition = function(node) {
		      this.checkIsTarget(node, PROD_TYPE.REPETITION);
		    };
		    InsideDefinitionFinderVisitor2.prototype.visitRepetitionMandatory = function(node) {
		      this.checkIsTarget(node, PROD_TYPE.REPETITION_MANDATORY);
		    };
		    InsideDefinitionFinderVisitor2.prototype.visitRepetitionMandatoryWithSeparator = function(node) {
		      this.checkIsTarget(node, PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR);
		    };
		    InsideDefinitionFinderVisitor2.prototype.visitRepetitionWithSeparator = function(node) {
		      this.checkIsTarget(node, PROD_TYPE.REPETITION_WITH_SEPARATOR);
		    };
		    InsideDefinitionFinderVisitor2.prototype.visitAlternation = function(node) {
		      this.checkIsTarget(node, PROD_TYPE.ALTERNATION);
		    };
		    return InsideDefinitionFinderVisitor2;
		  })(gast_2.GAstVisitor)
		);
		function initializeArrayOfArrays(size) {
		  var result = new Array(size);
		  for (var i = 0; i < size; i++) {
		    result[i] = [];
		  }
		  return result;
		}
		function pathToHashKeys(path) {
		  var keys = [""];
		  for (var i = 0; i < path.length; i++) {
		    var tokType = path[i];
		    var longerKeys = [];
		    for (var j = 0; j < keys.length; j++) {
		      var currShorterKey = keys[j];
		      longerKeys.push(currShorterKey + "_" + tokType.tokenTypeIdx);
		      for (var t = 0; t < tokType.categoryMatches.length; t++) {
		        var categoriesKeySuffix = "_" + tokType.categoryMatches[t];
		        longerKeys.push(currShorterKey + categoriesKeySuffix);
		      }
		    }
		    keys = longerKeys;
		  }
		  return keys;
		}
		function isUniquePrefixHash(altKnownPathsKeys, searchPathKeys, idx) {
		  for (var currAltIdx = 0; currAltIdx < altKnownPathsKeys.length; currAltIdx++) {
		    if (currAltIdx === idx) {
		      continue;
		    }
		    var otherAltKnownPathsKeys = altKnownPathsKeys[currAltIdx];
		    for (var searchIdx = 0; searchIdx < searchPathKeys.length; searchIdx++) {
		      var searchKey = searchPathKeys[searchIdx];
		      if (otherAltKnownPathsKeys[searchKey] === true) {
		        return false;
		      }
		    }
		  }
		  return true;
		}
		function lookAheadSequenceFromAlternatives(altsDefs, k) {
		  var partialAlts = (0, map_1.default)(altsDefs, function(currAlt) {
		    return (0, interpreter_1.possiblePathsFrom)([currAlt], 1);
		  });
		  var finalResult = initializeArrayOfArrays(partialAlts.length);
		  var altsHashes = (0, map_1.default)(partialAlts, function(currAltPaths) {
		    var dict = {};
		    (0, forEach_1.default)(currAltPaths, function(item) {
		      var keys = pathToHashKeys(item.partialPath);
		      (0, forEach_1.default)(keys, function(currKey) {
		        dict[currKey] = true;
		      });
		    });
		    return dict;
		  });
		  var newData = partialAlts;
		  for (var pathLength = 1; pathLength <= k; pathLength++) {
		    var currDataset = newData;
		    newData = initializeArrayOfArrays(currDataset.length);
		    var _loop_1 = function(altIdx2) {
		      var currAltPathsAndSuffixes = currDataset[altIdx2];
		      for (var currPathIdx = 0; currPathIdx < currAltPathsAndSuffixes.length; currPathIdx++) {
		        var currPathPrefix = currAltPathsAndSuffixes[currPathIdx].partialPath;
		        var suffixDef = currAltPathsAndSuffixes[currPathIdx].suffixDef;
		        var prefixKeys = pathToHashKeys(currPathPrefix);
		        var isUnique = isUniquePrefixHash(altsHashes, prefixKeys, altIdx2);
		        if (isUnique || (0, isEmpty_1.default)(suffixDef) || currPathPrefix.length === k) {
		          var currAltResult = finalResult[altIdx2];
		          if (containsPath(currAltResult, currPathPrefix) === false) {
		            currAltResult.push(currPathPrefix);
		            for (var j = 0; j < prefixKeys.length; j++) {
		              var currKey = prefixKeys[j];
		              altsHashes[altIdx2][currKey] = true;
		            }
		          }
		        } else {
		          var newPartialPathsAndSuffixes = (0, interpreter_1.possiblePathsFrom)(suffixDef, pathLength + 1, currPathPrefix);
		          newData[altIdx2] = newData[altIdx2].concat(newPartialPathsAndSuffixes);
		          (0, forEach_1.default)(newPartialPathsAndSuffixes, function(item) {
		            var prefixKeys2 = pathToHashKeys(item.partialPath);
		            (0, forEach_1.default)(prefixKeys2, function(key) {
		              altsHashes[altIdx2][key] = true;
		            });
		          });
		        }
		      }
		    };
		    for (var altIdx = 0; altIdx < currDataset.length; altIdx++) {
		      _loop_1(altIdx);
		    }
		  }
		  return finalResult;
		}
		exports$1.lookAheadSequenceFromAlternatives = lookAheadSequenceFromAlternatives;
		function getLookaheadPathsForOr(occurrence, ruleGrammar, k, orProd) {
		  var visitor = new InsideDefinitionFinderVisitor(occurrence, PROD_TYPE.ALTERNATION, orProd);
		  ruleGrammar.accept(visitor);
		  return lookAheadSequenceFromAlternatives(visitor.result, k);
		}
		exports$1.getLookaheadPathsForOr = getLookaheadPathsForOr;
		function getLookaheadPathsForOptionalProd(occurrence, ruleGrammar, prodType, k) {
		  var insideDefVisitor = new InsideDefinitionFinderVisitor(occurrence, prodType);
		  ruleGrammar.accept(insideDefVisitor);
		  var insideDef = insideDefVisitor.result;
		  var afterDefWalker = new RestDefinitionFinderWalker(ruleGrammar, occurrence, prodType);
		  var afterDef = afterDefWalker.startWalking();
		  var insideFlat = new gast_1.Alternative({ definition: insideDef });
		  var afterFlat = new gast_1.Alternative({ definition: afterDef });
		  return lookAheadSequenceFromAlternatives([insideFlat, afterFlat], k);
		}
		exports$1.getLookaheadPathsForOptionalProd = getLookaheadPathsForOptionalProd;
		function containsPath(alternative, searchPath) {
		  compareOtherPath: for (var i = 0; i < alternative.length; i++) {
		    var otherPath = alternative[i];
		    if (otherPath.length !== searchPath.length) {
		      continue;
		    }
		    for (var j = 0; j < otherPath.length; j++) {
		      var searchTok = searchPath[j];
		      var otherTok = otherPath[j];
		      var matchingTokens = searchTok === otherTok || otherTok.categoryMatchesMap[searchTok.tokenTypeIdx] !== void 0;
		      if (matchingTokens === false) {
		        continue compareOtherPath;
		      }
		    }
		    return true;
		  }
		  return false;
		}
		exports$1.containsPath = containsPath;
		function isStrictPrefixOfPath(prefix, other) {
		  return prefix.length < other.length && (0, every_1.default)(prefix, function(tokType, idx) {
		    var otherTokType = other[idx];
		    return tokType === otherTokType || otherTokType.categoryMatchesMap[tokType.tokenTypeIdx];
		  });
		}
		exports$1.isStrictPrefixOfPath = isStrictPrefixOfPath;
		function areTokenCategoriesNotUsed(lookAheadPaths) {
		  return (0, every_1.default)(lookAheadPaths, function(singleAltPaths) {
		    return (0, every_1.default)(singleAltPaths, function(singlePath) {
		      return (0, every_1.default)(singlePath, function(token) {
		        return (0, isEmpty_1.default)(token.categoryMatches);
		      });
		    });
		  });
		}
		exports$1.areTokenCategoriesNotUsed = areTokenCategoriesNotUsed; 
	} (lookahead));
	return lookahead;
}

var hasRequiredChecks;

function requireChecks () {
	if (hasRequiredChecks) return checks;
	hasRequiredChecks = 1;
	var __extends = checks && checks.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __assign = checks && checks.__assign || function() {
	  __assign = Object.assign || function(t) {
	    for (var s, i = 1, n = arguments.length; i < n; i++) {
	      s = arguments[i];
	      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
	        t[p] = s[p];
	    }
	    return t;
	  };
	  return __assign.apply(this, arguments);
	};
	var __importDefault = checks && checks.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(checks, "__esModule", { value: true });
	checks.checkPrefixAlternativesAmbiguities = checks.validateSomeNonEmptyLookaheadPath = checks.validateTooManyAlts = checks.RepetitionCollector = checks.validateAmbiguousAlternationAlternatives = checks.validateEmptyOrAlternative = checks.getFirstNoneTerminal = checks.validateNoLeftRecursion = checks.validateRuleIsOverridden = checks.validateRuleDoesNotAlreadyExist = checks.OccurrenceValidationCollector = checks.identifyProductionForDuplicates = checks.validateGrammar = checks.validateLookahead = void 0;
	var first_1 = __importDefault(requireFirst());
	var isEmpty_1 = __importDefault(requireIsEmpty());
	var drop_1 = __importDefault(requireDrop());
	var flatten_1 = __importDefault(requireFlatten());
	var filter_1 = __importDefault(requireFilter());
	var reject_1 = __importDefault(requireReject());
	var difference_1 = __importDefault(requireDifference());
	var map_1 = __importDefault(requireMap());
	var forEach_1 = __importDefault(requireForEach());
	var groupBy_1 = __importDefault(requireGroupBy());
	var reduce_1 = __importDefault(requireReduce());
	var pickBy_1 = __importDefault(requirePickBy());
	var values_1 = __importDefault(requireValues());
	var includes_1 = __importDefault(requireIncludes());
	var flatMap_1 = __importDefault(requireFlatMap());
	var clone_1 = __importDefault(requireClone());
	var parser_1 = requireParser();
	var gast_1 = requireApi$2();
	var lookahead_1 = requireLookahead();
	var interpreter_1 = requireInterpreter();
	var gast_2 = requireApi$2();
	var gast_3 = requireApi$2();
	var dropRight_1 = __importDefault(requireDropRight());
	var compact_1 = __importDefault(requireCompact());
	var tokens_1 = requireTokens();
	function validateLookahead(options) {
	  var lookaheadValidationErrorMessages = options.lookaheadStrategy.validate({
	    rules: options.rules,
	    tokenTypes: options.tokenTypes,
	    grammarName: options.grammarName
	  });
	  return (0, map_1.default)(lookaheadValidationErrorMessages, function(errorMessage) {
	    return __assign({ type: parser_1.ParserDefinitionErrorType.CUSTOM_LOOKAHEAD_VALIDATION }, errorMessage);
	  });
	}
	checks.validateLookahead = validateLookahead;
	function validateGrammar(topLevels, tokenTypes, errMsgProvider, grammarName) {
	  var duplicateErrors = (0, flatMap_1.default)(topLevels, function(currTopLevel) {
	    return validateDuplicateProductions(currTopLevel, errMsgProvider);
	  });
	  var termsNamespaceConflictErrors = checkTerminalAndNoneTerminalsNameSpace(topLevels, tokenTypes, errMsgProvider);
	  var tooManyAltsErrors = (0, flatMap_1.default)(topLevels, function(curRule) {
	    return validateTooManyAlts(curRule, errMsgProvider);
	  });
	  var duplicateRulesError = (0, flatMap_1.default)(topLevels, function(curRule) {
	    return validateRuleDoesNotAlreadyExist(curRule, topLevels, grammarName, errMsgProvider);
	  });
	  return duplicateErrors.concat(termsNamespaceConflictErrors, tooManyAltsErrors, duplicateRulesError);
	}
	checks.validateGrammar = validateGrammar;
	function validateDuplicateProductions(topLevelRule, errMsgProvider) {
	  var collectorVisitor = new OccurrenceValidationCollector();
	  topLevelRule.accept(collectorVisitor);
	  var allRuleProductions = collectorVisitor.allProductions;
	  var productionGroups = (0, groupBy_1.default)(allRuleProductions, identifyProductionForDuplicates);
	  var duplicates = (0, pickBy_1.default)(productionGroups, function(currGroup) {
	    return currGroup.length > 1;
	  });
	  var errors = (0, map_1.default)((0, values_1.default)(duplicates), function(currDuplicates) {
	    var firstProd = (0, first_1.default)(currDuplicates);
	    var msg = errMsgProvider.buildDuplicateFoundError(topLevelRule, currDuplicates);
	    var dslName = (0, gast_1.getProductionDslName)(firstProd);
	    var defError = {
	      message: msg,
	      type: parser_1.ParserDefinitionErrorType.DUPLICATE_PRODUCTIONS,
	      ruleName: topLevelRule.name,
	      dslName,
	      occurrence: firstProd.idx
	    };
	    var param = getExtraProductionArgument(firstProd);
	    if (param) {
	      defError.parameter = param;
	    }
	    return defError;
	  });
	  return errors;
	}
	function identifyProductionForDuplicates(prod) {
	  return "".concat((0, gast_1.getProductionDslName)(prod), "_#_").concat(prod.idx, "_#_").concat(getExtraProductionArgument(prod));
	}
	checks.identifyProductionForDuplicates = identifyProductionForDuplicates;
	function getExtraProductionArgument(prod) {
	  if (prod instanceof gast_2.Terminal) {
	    return prod.terminalType.name;
	  } else if (prod instanceof gast_2.NonTerminal) {
	    return prod.nonTerminalName;
	  } else {
	    return "";
	  }
	}
	var OccurrenceValidationCollector = (
	  /** @class */
	  (function(_super) {
	    __extends(OccurrenceValidationCollector2, _super);
	    function OccurrenceValidationCollector2() {
	      var _this = _super !== null && _super.apply(this, arguments) || this;
	      _this.allProductions = [];
	      return _this;
	    }
	    OccurrenceValidationCollector2.prototype.visitNonTerminal = function(subrule) {
	      this.allProductions.push(subrule);
	    };
	    OccurrenceValidationCollector2.prototype.visitOption = function(option) {
	      this.allProductions.push(option);
	    };
	    OccurrenceValidationCollector2.prototype.visitRepetitionWithSeparator = function(manySep) {
	      this.allProductions.push(manySep);
	    };
	    OccurrenceValidationCollector2.prototype.visitRepetitionMandatory = function(atLeastOne) {
	      this.allProductions.push(atLeastOne);
	    };
	    OccurrenceValidationCollector2.prototype.visitRepetitionMandatoryWithSeparator = function(atLeastOneSep) {
	      this.allProductions.push(atLeastOneSep);
	    };
	    OccurrenceValidationCollector2.prototype.visitRepetition = function(many) {
	      this.allProductions.push(many);
	    };
	    OccurrenceValidationCollector2.prototype.visitAlternation = function(or) {
	      this.allProductions.push(or);
	    };
	    OccurrenceValidationCollector2.prototype.visitTerminal = function(terminal) {
	      this.allProductions.push(terminal);
	    };
	    return OccurrenceValidationCollector2;
	  })(gast_3.GAstVisitor)
	);
	checks.OccurrenceValidationCollector = OccurrenceValidationCollector;
	function validateRuleDoesNotAlreadyExist(rule, allRules, className, errMsgProvider) {
	  var errors = [];
	  var occurrences = (0, reduce_1.default)(allRules, function(result, curRule) {
	    if (curRule.name === rule.name) {
	      return result + 1;
	    }
	    return result;
	  }, 0);
	  if (occurrences > 1) {
	    var errMsg = errMsgProvider.buildDuplicateRuleNameError({
	      topLevelRule: rule,
	      grammarName: className
	    });
	    errors.push({
	      message: errMsg,
	      type: parser_1.ParserDefinitionErrorType.DUPLICATE_RULE_NAME,
	      ruleName: rule.name
	    });
	  }
	  return errors;
	}
	checks.validateRuleDoesNotAlreadyExist = validateRuleDoesNotAlreadyExist;
	function validateRuleIsOverridden(ruleName, definedRulesNames, className) {
	  var errors = [];
	  var errMsg;
	  if (!(0, includes_1.default)(definedRulesNames, ruleName)) {
	    errMsg = "Invalid rule override, rule: ->".concat(ruleName, "<- cannot be overridden in the grammar: ->").concat(className, "<-") + "as it is not defined in any of the super grammars ";
	    errors.push({
	      message: errMsg,
	      type: parser_1.ParserDefinitionErrorType.INVALID_RULE_OVERRIDE,
	      ruleName
	    });
	  }
	  return errors;
	}
	checks.validateRuleIsOverridden = validateRuleIsOverridden;
	function validateNoLeftRecursion(topRule, currRule, errMsgProvider, path) {
	  if (path === void 0) {
	    path = [];
	  }
	  var errors = [];
	  var nextNonTerminals = getFirstNoneTerminal(currRule.definition);
	  if ((0, isEmpty_1.default)(nextNonTerminals)) {
	    return [];
	  } else {
	    var ruleName = topRule.name;
	    var foundLeftRecursion = (0, includes_1.default)(nextNonTerminals, topRule);
	    if (foundLeftRecursion) {
	      errors.push({
	        message: errMsgProvider.buildLeftRecursionError({
	          topLevelRule: topRule,
	          leftRecursionPath: path
	        }),
	        type: parser_1.ParserDefinitionErrorType.LEFT_RECURSION,
	        ruleName
	      });
	    }
	    var validNextSteps = (0, difference_1.default)(nextNonTerminals, path.concat([topRule]));
	    var errorsFromNextSteps = (0, flatMap_1.default)(validNextSteps, function(currRefRule) {
	      var newPath = (0, clone_1.default)(path);
	      newPath.push(currRefRule);
	      return validateNoLeftRecursion(topRule, currRefRule, errMsgProvider, newPath);
	    });
	    return errors.concat(errorsFromNextSteps);
	  }
	}
	checks.validateNoLeftRecursion = validateNoLeftRecursion;
	function getFirstNoneTerminal(definition) {
	  var result = [];
	  if ((0, isEmpty_1.default)(definition)) {
	    return result;
	  }
	  var firstProd = (0, first_1.default)(definition);
	  if (firstProd instanceof gast_2.NonTerminal) {
	    result.push(firstProd.referencedRule);
	  } else if (firstProd instanceof gast_2.Alternative || firstProd instanceof gast_2.Option || firstProd instanceof gast_2.RepetitionMandatory || firstProd instanceof gast_2.RepetitionMandatoryWithSeparator || firstProd instanceof gast_2.RepetitionWithSeparator || firstProd instanceof gast_2.Repetition) {
	    result = result.concat(getFirstNoneTerminal(firstProd.definition));
	  } else if (firstProd instanceof gast_2.Alternation) {
	    result = (0, flatten_1.default)((0, map_1.default)(firstProd.definition, function(currSubDef) {
	      return getFirstNoneTerminal(currSubDef.definition);
	    }));
	  } else if (firstProd instanceof gast_2.Terminal) ; else {
	    throw Error("non exhaustive match");
	  }
	  var isFirstOptional = (0, gast_1.isOptionalProd)(firstProd);
	  var hasMore = definition.length > 1;
	  if (isFirstOptional && hasMore) {
	    var rest = (0, drop_1.default)(definition);
	    return result.concat(getFirstNoneTerminal(rest));
	  } else {
	    return result;
	  }
	}
	checks.getFirstNoneTerminal = getFirstNoneTerminal;
	var OrCollector = (
	  /** @class */
	  (function(_super) {
	    __extends(OrCollector2, _super);
	    function OrCollector2() {
	      var _this = _super !== null && _super.apply(this, arguments) || this;
	      _this.alternations = [];
	      return _this;
	    }
	    OrCollector2.prototype.visitAlternation = function(node) {
	      this.alternations.push(node);
	    };
	    return OrCollector2;
	  })(gast_3.GAstVisitor)
	);
	function validateEmptyOrAlternative(topLevelRule, errMsgProvider) {
	  var orCollector = new OrCollector();
	  topLevelRule.accept(orCollector);
	  var ors = orCollector.alternations;
	  var errors = (0, flatMap_1.default)(ors, function(currOr) {
	    var exceptLast = (0, dropRight_1.default)(currOr.definition);
	    return (0, flatMap_1.default)(exceptLast, function(currAlternative, currAltIdx) {
	      var possibleFirstInAlt = (0, interpreter_1.nextPossibleTokensAfter)([currAlternative], [], tokens_1.tokenStructuredMatcher, 1);
	      if ((0, isEmpty_1.default)(possibleFirstInAlt)) {
	        return [
	          {
	            message: errMsgProvider.buildEmptyAlternationError({
	              topLevelRule,
	              alternation: currOr,
	              emptyChoiceIdx: currAltIdx
	            }),
	            type: parser_1.ParserDefinitionErrorType.NONE_LAST_EMPTY_ALT,
	            ruleName: topLevelRule.name,
	            occurrence: currOr.idx,
	            alternative: currAltIdx + 1
	          }
	        ];
	      } else {
	        return [];
	      }
	    });
	  });
	  return errors;
	}
	checks.validateEmptyOrAlternative = validateEmptyOrAlternative;
	function validateAmbiguousAlternationAlternatives(topLevelRule, globalMaxLookahead, errMsgProvider) {
	  var orCollector = new OrCollector();
	  topLevelRule.accept(orCollector);
	  var ors = orCollector.alternations;
	  ors = (0, reject_1.default)(ors, function(currOr) {
	    return currOr.ignoreAmbiguities === true;
	  });
	  var errors = (0, flatMap_1.default)(ors, function(currOr) {
	    var currOccurrence = currOr.idx;
	    var actualMaxLookahead = currOr.maxLookahead || globalMaxLookahead;
	    var alternatives = (0, lookahead_1.getLookaheadPathsForOr)(currOccurrence, topLevelRule, actualMaxLookahead, currOr);
	    var altsAmbiguityErrors = checkAlternativesAmbiguities(alternatives, currOr, topLevelRule, errMsgProvider);
	    var altsPrefixAmbiguityErrors = checkPrefixAlternativesAmbiguities(alternatives, currOr, topLevelRule, errMsgProvider);
	    return altsAmbiguityErrors.concat(altsPrefixAmbiguityErrors);
	  });
	  return errors;
	}
	checks.validateAmbiguousAlternationAlternatives = validateAmbiguousAlternationAlternatives;
	var RepetitionCollector = (
	  /** @class */
	  (function(_super) {
	    __extends(RepetitionCollector2, _super);
	    function RepetitionCollector2() {
	      var _this = _super !== null && _super.apply(this, arguments) || this;
	      _this.allProductions = [];
	      return _this;
	    }
	    RepetitionCollector2.prototype.visitRepetitionWithSeparator = function(manySep) {
	      this.allProductions.push(manySep);
	    };
	    RepetitionCollector2.prototype.visitRepetitionMandatory = function(atLeastOne) {
	      this.allProductions.push(atLeastOne);
	    };
	    RepetitionCollector2.prototype.visitRepetitionMandatoryWithSeparator = function(atLeastOneSep) {
	      this.allProductions.push(atLeastOneSep);
	    };
	    RepetitionCollector2.prototype.visitRepetition = function(many) {
	      this.allProductions.push(many);
	    };
	    return RepetitionCollector2;
	  })(gast_3.GAstVisitor)
	);
	checks.RepetitionCollector = RepetitionCollector;
	function validateTooManyAlts(topLevelRule, errMsgProvider) {
	  var orCollector = new OrCollector();
	  topLevelRule.accept(orCollector);
	  var ors = orCollector.alternations;
	  var errors = (0, flatMap_1.default)(ors, function(currOr) {
	    if (currOr.definition.length > 255) {
	      return [
	        {
	          message: errMsgProvider.buildTooManyAlternativesError({
	            topLevelRule,
	            alternation: currOr
	          }),
	          type: parser_1.ParserDefinitionErrorType.TOO_MANY_ALTS,
	          ruleName: topLevelRule.name,
	          occurrence: currOr.idx
	        }
	      ];
	    } else {
	      return [];
	    }
	  });
	  return errors;
	}
	checks.validateTooManyAlts = validateTooManyAlts;
	function validateSomeNonEmptyLookaheadPath(topLevelRules, maxLookahead, errMsgProvider) {
	  var errors = [];
	  (0, forEach_1.default)(topLevelRules, function(currTopRule) {
	    var collectorVisitor = new RepetitionCollector();
	    currTopRule.accept(collectorVisitor);
	    var allRuleProductions = collectorVisitor.allProductions;
	    (0, forEach_1.default)(allRuleProductions, function(currProd) {
	      var prodType = (0, lookahead_1.getProdType)(currProd);
	      var actualMaxLookahead = currProd.maxLookahead || maxLookahead;
	      var currOccurrence = currProd.idx;
	      var paths = (0, lookahead_1.getLookaheadPathsForOptionalProd)(currOccurrence, currTopRule, prodType, actualMaxLookahead);
	      var pathsInsideProduction = paths[0];
	      if ((0, isEmpty_1.default)((0, flatten_1.default)(pathsInsideProduction))) {
	        var errMsg = errMsgProvider.buildEmptyRepetitionError({
	          topLevelRule: currTopRule,
	          repetition: currProd
	        });
	        errors.push({
	          message: errMsg,
	          type: parser_1.ParserDefinitionErrorType.NO_NON_EMPTY_LOOKAHEAD,
	          ruleName: currTopRule.name
	        });
	      }
	    });
	  });
	  return errors;
	}
	checks.validateSomeNonEmptyLookaheadPath = validateSomeNonEmptyLookaheadPath;
	function checkAlternativesAmbiguities(alternatives, alternation, rule, errMsgProvider) {
	  var foundAmbiguousPaths = [];
	  var identicalAmbiguities = (0, reduce_1.default)(alternatives, function(result, currAlt, currAltIdx) {
	    if (alternation.definition[currAltIdx].ignoreAmbiguities === true) {
	      return result;
	    }
	    (0, forEach_1.default)(currAlt, function(currPath) {
	      var altsCurrPathAppearsIn = [currAltIdx];
	      (0, forEach_1.default)(alternatives, function(currOtherAlt, currOtherAltIdx) {
	        if (currAltIdx !== currOtherAltIdx && (0, lookahead_1.containsPath)(currOtherAlt, currPath) && // ignore (skip) ambiguities with this "other" alternative
	        alternation.definition[currOtherAltIdx].ignoreAmbiguities !== true) {
	          altsCurrPathAppearsIn.push(currOtherAltIdx);
	        }
	      });
	      if (altsCurrPathAppearsIn.length > 1 && !(0, lookahead_1.containsPath)(foundAmbiguousPaths, currPath)) {
	        foundAmbiguousPaths.push(currPath);
	        result.push({
	          alts: altsCurrPathAppearsIn,
	          path: currPath
	        });
	      }
	    });
	    return result;
	  }, []);
	  var currErrors = (0, map_1.default)(identicalAmbiguities, function(currAmbDescriptor) {
	    var ambgIndices = (0, map_1.default)(currAmbDescriptor.alts, function(currAltIdx) {
	      return currAltIdx + 1;
	    });
	    var currMessage = errMsgProvider.buildAlternationAmbiguityError({
	      topLevelRule: rule,
	      alternation,
	      ambiguityIndices: ambgIndices,
	      prefixPath: currAmbDescriptor.path
	    });
	    return {
	      message: currMessage,
	      type: parser_1.ParserDefinitionErrorType.AMBIGUOUS_ALTS,
	      ruleName: rule.name,
	      occurrence: alternation.idx,
	      alternatives: currAmbDescriptor.alts
	    };
	  });
	  return currErrors;
	}
	function checkPrefixAlternativesAmbiguities(alternatives, alternation, rule, errMsgProvider) {
	  var pathsAndIndices = (0, reduce_1.default)(alternatives, function(result, currAlt, idx) {
	    var currPathsAndIdx = (0, map_1.default)(currAlt, function(currPath) {
	      return { idx, path: currPath };
	    });
	    return result.concat(currPathsAndIdx);
	  }, []);
	  var errors = (0, compact_1.default)((0, flatMap_1.default)(pathsAndIndices, function(currPathAndIdx) {
	    var alternativeGast = alternation.definition[currPathAndIdx.idx];
	    if (alternativeGast.ignoreAmbiguities === true) {
	      return [];
	    }
	    var targetIdx = currPathAndIdx.idx;
	    var targetPath = currPathAndIdx.path;
	    var prefixAmbiguitiesPathsAndIndices = (0, filter_1.default)(pathsAndIndices, function(searchPathAndIdx) {
	      return (
	        // ignore (skip) ambiguities with this "other" alternative
	        alternation.definition[searchPathAndIdx.idx].ignoreAmbiguities !== true && searchPathAndIdx.idx < targetIdx && // checking for strict prefix because identical lookaheads
	        // will be be detected using a different validation.
	        (0, lookahead_1.isStrictPrefixOfPath)(searchPathAndIdx.path, targetPath)
	      );
	    });
	    var currPathPrefixErrors = (0, map_1.default)(prefixAmbiguitiesPathsAndIndices, function(currAmbPathAndIdx) {
	      var ambgIndices = [currAmbPathAndIdx.idx + 1, targetIdx + 1];
	      var occurrence = alternation.idx === 0 ? "" : alternation.idx;
	      var message = errMsgProvider.buildAlternationPrefixAmbiguityError({
	        topLevelRule: rule,
	        alternation,
	        ambiguityIndices: ambgIndices,
	        prefixPath: currAmbPathAndIdx.path
	      });
	      return {
	        message,
	        type: parser_1.ParserDefinitionErrorType.AMBIGUOUS_PREFIX_ALTS,
	        ruleName: rule.name,
	        occurrence,
	        alternatives: ambgIndices
	      };
	    });
	    return currPathPrefixErrors;
	  }));
	  return errors;
	}
	checks.checkPrefixAlternativesAmbiguities = checkPrefixAlternativesAmbiguities;
	function checkTerminalAndNoneTerminalsNameSpace(topLevels, tokenTypes, errMsgProvider) {
	  var errors = [];
	  var tokenNames = (0, map_1.default)(tokenTypes, function(currToken) {
	    return currToken.name;
	  });
	  (0, forEach_1.default)(topLevels, function(currRule) {
	    var currRuleName = currRule.name;
	    if ((0, includes_1.default)(tokenNames, currRuleName)) {
	      var errMsg = errMsgProvider.buildNamespaceConflictError(currRule);
	      errors.push({
	        message: errMsg,
	        type: parser_1.ParserDefinitionErrorType.CONFLICT_TOKENS_RULES_NAMESPACE,
	        ruleName: currRuleName
	      });
	    }
	  });
	  return errors;
	}
	return checks;
}

var hasRequiredGast_resolver_public;

function requireGast_resolver_public () {
	if (hasRequiredGast_resolver_public) return gast_resolver_public;
	hasRequiredGast_resolver_public = 1;
	var __importDefault = gast_resolver_public && gast_resolver_public.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(gast_resolver_public, "__esModule", { value: true });
	gast_resolver_public.validateGrammar = gast_resolver_public.resolveGrammar = void 0;
	var forEach_1 = __importDefault(requireForEach());
	var defaults_1 = __importDefault(requireDefaults());
	var resolver_1 = requireResolver();
	var checks_1 = requireChecks();
	var errors_public_1 = requireErrors_public();
	function resolveGrammar(options) {
	  var actualOptions = (0, defaults_1.default)(options, {
	    errMsgProvider: errors_public_1.defaultGrammarResolverErrorProvider
	  });
	  var topRulesTable = {};
	  (0, forEach_1.default)(options.rules, function(rule) {
	    topRulesTable[rule.name] = rule;
	  });
	  return (0, resolver_1.resolveGrammar)(topRulesTable, actualOptions.errMsgProvider);
	}
	gast_resolver_public.resolveGrammar = resolveGrammar;
	function validateGrammar(options) {
	  options = (0, defaults_1.default)(options, {
	    errMsgProvider: errors_public_1.defaultGrammarValidatorErrorProvider
	  });
	  return (0, checks_1.validateGrammar)(options.rules, options.tokenTypes, options.errMsgProvider, options.grammarName);
	}
	gast_resolver_public.validateGrammar = validateGrammar;
	return gast_resolver_public;
}

var recoverable = {};

var exceptions_public = {};

var hasRequiredExceptions_public;

function requireExceptions_public () {
	if (hasRequiredExceptions_public) return exceptions_public;
	hasRequiredExceptions_public = 1;
	var __extends = exceptions_public && exceptions_public.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __importDefault = exceptions_public && exceptions_public.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(exceptions_public, "__esModule", { value: true });
	exceptions_public.EarlyExitException = exceptions_public.NotAllInputParsedException = exceptions_public.NoViableAltException = exceptions_public.MismatchedTokenException = exceptions_public.isRecognitionException = void 0;
	var includes_1 = __importDefault(requireIncludes());
	var MISMATCHED_TOKEN_EXCEPTION = "MismatchedTokenException";
	var NO_VIABLE_ALT_EXCEPTION = "NoViableAltException";
	var EARLY_EXIT_EXCEPTION = "EarlyExitException";
	var NOT_ALL_INPUT_PARSED_EXCEPTION = "NotAllInputParsedException";
	var RECOGNITION_EXCEPTION_NAMES = [
	  MISMATCHED_TOKEN_EXCEPTION,
	  NO_VIABLE_ALT_EXCEPTION,
	  EARLY_EXIT_EXCEPTION,
	  NOT_ALL_INPUT_PARSED_EXCEPTION
	];
	Object.freeze(RECOGNITION_EXCEPTION_NAMES);
	function isRecognitionException(error) {
	  return (0, includes_1.default)(RECOGNITION_EXCEPTION_NAMES, error.name);
	}
	exceptions_public.isRecognitionException = isRecognitionException;
	var RecognitionException = (
	  /** @class */
	  (function(_super) {
	    __extends(RecognitionException2, _super);
	    function RecognitionException2(message, token) {
	      var _newTarget = this.constructor;
	      var _this = _super.call(this, message) || this;
	      _this.token = token;
	      _this.resyncedTokens = [];
	      Object.setPrototypeOf(_this, _newTarget.prototype);
	      if (Error.captureStackTrace) {
	        Error.captureStackTrace(_this, _this.constructor);
	      }
	      return _this;
	    }
	    return RecognitionException2;
	  })(Error)
	);
	var MismatchedTokenException = (
	  /** @class */
	  (function(_super) {
	    __extends(MismatchedTokenException2, _super);
	    function MismatchedTokenException2(message, token, previousToken) {
	      var _this = _super.call(this, message, token) || this;
	      _this.previousToken = previousToken;
	      _this.name = MISMATCHED_TOKEN_EXCEPTION;
	      return _this;
	    }
	    return MismatchedTokenException2;
	  })(RecognitionException)
	);
	exceptions_public.MismatchedTokenException = MismatchedTokenException;
	var NoViableAltException = (
	  /** @class */
	  (function(_super) {
	    __extends(NoViableAltException2, _super);
	    function NoViableAltException2(message, token, previousToken) {
	      var _this = _super.call(this, message, token) || this;
	      _this.previousToken = previousToken;
	      _this.name = NO_VIABLE_ALT_EXCEPTION;
	      return _this;
	    }
	    return NoViableAltException2;
	  })(RecognitionException)
	);
	exceptions_public.NoViableAltException = NoViableAltException;
	var NotAllInputParsedException = (
	  /** @class */
	  (function(_super) {
	    __extends(NotAllInputParsedException2, _super);
	    function NotAllInputParsedException2(message, token) {
	      var _this = _super.call(this, message, token) || this;
	      _this.name = NOT_ALL_INPUT_PARSED_EXCEPTION;
	      return _this;
	    }
	    return NotAllInputParsedException2;
	  })(RecognitionException)
	);
	exceptions_public.NotAllInputParsedException = NotAllInputParsedException;
	var EarlyExitException = (
	  /** @class */
	  (function(_super) {
	    __extends(EarlyExitException2, _super);
	    function EarlyExitException2(message, token, previousToken) {
	      var _this = _super.call(this, message, token) || this;
	      _this.previousToken = previousToken;
	      _this.name = EARLY_EXIT_EXCEPTION;
	      return _this;
	    }
	    return EarlyExitException2;
	  })(RecognitionException)
	);
	exceptions_public.EarlyExitException = EarlyExitException;
	return exceptions_public;
}

var hasRequiredRecoverable;

function requireRecoverable () {
	if (hasRequiredRecoverable) return recoverable;
	hasRequiredRecoverable = 1;
	(function (exports$1) {
		var __extends = recoverable && recoverable.__extends || /* @__PURE__ */ (function() {
		  var extendStatics = function(d, b) {
		    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
		      d2.__proto__ = b2;
		    } || function(d2, b2) {
		      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
		    };
		    return extendStatics(d, b);
		  };
		  return function(d, b) {
		    if (typeof b !== "function" && b !== null)
		      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
		    extendStatics(d, b);
		    function __() {
		      this.constructor = d;
		    }
		    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		  };
		})();
		var __importDefault = recoverable && recoverable.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.attemptInRepetitionRecovery = exports$1.Recoverable = exports$1.InRuleRecoveryException = exports$1.IN_RULE_RECOVERY_EXCEPTION = exports$1.EOF_FOLLOW_KEY = void 0;
		var tokens_public_1 = requireTokens_public();
		var isEmpty_1 = __importDefault(requireIsEmpty());
		var dropRight_1 = __importDefault(requireDropRight());
		var flatten_1 = __importDefault(requireFlatten());
		var map_1 = __importDefault(requireMap());
		var find_1 = __importDefault(requireFind());
		var has_1 = __importDefault(requireHas());
		var includes_1 = __importDefault(requireIncludes());
		var clone_1 = __importDefault(requireClone());
		var exceptions_public_1 = requireExceptions_public();
		var constants_1 = requireConstants();
		var parser_1 = requireParser();
		exports$1.EOF_FOLLOW_KEY = {};
		exports$1.IN_RULE_RECOVERY_EXCEPTION = "InRuleRecoveryException";
		var InRuleRecoveryException = (
		  /** @class */
		  (function(_super) {
		    __extends(InRuleRecoveryException2, _super);
		    function InRuleRecoveryException2(message) {
		      var _this = _super.call(this, message) || this;
		      _this.name = exports$1.IN_RULE_RECOVERY_EXCEPTION;
		      return _this;
		    }
		    return InRuleRecoveryException2;
		  })(Error)
		);
		exports$1.InRuleRecoveryException = InRuleRecoveryException;
		var Recoverable = (
		  /** @class */
		  (function() {
		    function Recoverable2() {
		    }
		    Recoverable2.prototype.initRecoverable = function(config) {
		      this.firstAfterRepMap = {};
		      this.resyncFollows = {};
		      this.recoveryEnabled = (0, has_1.default)(config, "recoveryEnabled") ? config.recoveryEnabled : parser_1.DEFAULT_PARSER_CONFIG.recoveryEnabled;
		      if (this.recoveryEnabled) {
		        this.attemptInRepetitionRecovery = attemptInRepetitionRecovery;
		      }
		    };
		    Recoverable2.prototype.getTokenToInsert = function(tokType) {
		      var tokToInsert = (0, tokens_public_1.createTokenInstance)(tokType, "", NaN, NaN, NaN, NaN, NaN, NaN);
		      tokToInsert.isInsertedInRecovery = true;
		      return tokToInsert;
		    };
		    Recoverable2.prototype.canTokenTypeBeInsertedInRecovery = function(tokType) {
		      return true;
		    };
		    Recoverable2.prototype.canTokenTypeBeDeletedInRecovery = function(tokType) {
		      return true;
		    };
		    Recoverable2.prototype.tryInRepetitionRecovery = function(grammarRule, grammarRuleArgs, lookAheadFunc, expectedTokType) {
		      var _this = this;
		      var reSyncTokType = this.findReSyncTokenType();
		      var savedLexerState = this.exportLexerState();
		      var resyncedTokens = [];
		      var passedResyncPoint = false;
		      var nextTokenWithoutResync = this.LA(1);
		      var currToken = this.LA(1);
		      var generateErrorMessage = function() {
		        var previousToken = _this.LA(0);
		        var msg = _this.errorMessageProvider.buildMismatchTokenMessage({
		          expected: expectedTokType,
		          actual: nextTokenWithoutResync,
		          previous: previousToken,
		          ruleName: _this.getCurrRuleFullName()
		        });
		        var error = new exceptions_public_1.MismatchedTokenException(msg, nextTokenWithoutResync, _this.LA(0));
		        error.resyncedTokens = (0, dropRight_1.default)(resyncedTokens);
		        _this.SAVE_ERROR(error);
		      };
		      while (!passedResyncPoint) {
		        if (this.tokenMatcher(currToken, expectedTokType)) {
		          generateErrorMessage();
		          return;
		        } else if (lookAheadFunc.call(this)) {
		          generateErrorMessage();
		          grammarRule.apply(this, grammarRuleArgs);
		          return;
		        } else if (this.tokenMatcher(currToken, reSyncTokType)) {
		          passedResyncPoint = true;
		        } else {
		          currToken = this.SKIP_TOKEN();
		          this.addToResyncTokens(currToken, resyncedTokens);
		        }
		      }
		      this.importLexerState(savedLexerState);
		    };
		    Recoverable2.prototype.shouldInRepetitionRecoveryBeTried = function(expectTokAfterLastMatch, nextTokIdx, notStuck) {
		      if (notStuck === false) {
		        return false;
		      }
		      if (this.tokenMatcher(this.LA(1), expectTokAfterLastMatch)) {
		        return false;
		      }
		      if (this.isBackTracking()) {
		        return false;
		      }
		      if (this.canPerformInRuleRecovery(expectTokAfterLastMatch, this.getFollowsForInRuleRecovery(expectTokAfterLastMatch, nextTokIdx))) {
		        return false;
		      }
		      return true;
		    };
		    Recoverable2.prototype.getFollowsForInRuleRecovery = function(tokType, tokIdxInRule) {
		      var grammarPath = this.getCurrentGrammarPath(tokType, tokIdxInRule);
		      var follows = this.getNextPossibleTokenTypes(grammarPath);
		      return follows;
		    };
		    Recoverable2.prototype.tryInRuleRecovery = function(expectedTokType, follows) {
		      if (this.canRecoverWithSingleTokenInsertion(expectedTokType, follows)) {
		        var tokToInsert = this.getTokenToInsert(expectedTokType);
		        return tokToInsert;
		      }
		      if (this.canRecoverWithSingleTokenDeletion(expectedTokType)) {
		        var nextTok = this.SKIP_TOKEN();
		        this.consumeToken();
		        return nextTok;
		      }
		      throw new InRuleRecoveryException("sad sad panda");
		    };
		    Recoverable2.prototype.canPerformInRuleRecovery = function(expectedToken, follows) {
		      return this.canRecoverWithSingleTokenInsertion(expectedToken, follows) || this.canRecoverWithSingleTokenDeletion(expectedToken);
		    };
		    Recoverable2.prototype.canRecoverWithSingleTokenInsertion = function(expectedTokType, follows) {
		      var _this = this;
		      if (!this.canTokenTypeBeInsertedInRecovery(expectedTokType)) {
		        return false;
		      }
		      if ((0, isEmpty_1.default)(follows)) {
		        return false;
		      }
		      var mismatchedTok = this.LA(1);
		      var isMisMatchedTokInFollows = (0, find_1.default)(follows, function(possibleFollowsTokType) {
		        return _this.tokenMatcher(mismatchedTok, possibleFollowsTokType);
		      }) !== void 0;
		      return isMisMatchedTokInFollows;
		    };
		    Recoverable2.prototype.canRecoverWithSingleTokenDeletion = function(expectedTokType) {
		      if (!this.canTokenTypeBeDeletedInRecovery(expectedTokType)) {
		        return false;
		      }
		      var isNextTokenWhatIsExpected = this.tokenMatcher(this.LA(2), expectedTokType);
		      return isNextTokenWhatIsExpected;
		    };
		    Recoverable2.prototype.isInCurrentRuleReSyncSet = function(tokenTypeIdx) {
		      var followKey = this.getCurrFollowKey();
		      var currentRuleReSyncSet = this.getFollowSetFromFollowKey(followKey);
		      return (0, includes_1.default)(currentRuleReSyncSet, tokenTypeIdx);
		    };
		    Recoverable2.prototype.findReSyncTokenType = function() {
		      var allPossibleReSyncTokTypes = this.flattenFollowSet();
		      var nextToken = this.LA(1);
		      var k = 2;
		      while (true) {
		        var foundMatch = (0, find_1.default)(allPossibleReSyncTokTypes, function(resyncTokType) {
		          var canMatch = (0, tokens_public_1.tokenMatcher)(nextToken, resyncTokType);
		          return canMatch;
		        });
		        if (foundMatch !== void 0) {
		          return foundMatch;
		        }
		        nextToken = this.LA(k);
		        k++;
		      }
		    };
		    Recoverable2.prototype.getCurrFollowKey = function() {
		      if (this.RULE_STACK.length === 1) {
		        return exports$1.EOF_FOLLOW_KEY;
		      }
		      var currRuleShortName = this.getLastExplicitRuleShortName();
		      var currRuleIdx = this.getLastExplicitRuleOccurrenceIndex();
		      var prevRuleShortName = this.getPreviousExplicitRuleShortName();
		      return {
		        ruleName: this.shortRuleNameToFullName(currRuleShortName),
		        idxInCallingRule: currRuleIdx,
		        inRule: this.shortRuleNameToFullName(prevRuleShortName)
		      };
		    };
		    Recoverable2.prototype.buildFullFollowKeyStack = function() {
		      var _this = this;
		      var explicitRuleStack = this.RULE_STACK;
		      var explicitOccurrenceStack = this.RULE_OCCURRENCE_STACK;
		      return (0, map_1.default)(explicitRuleStack, function(ruleName, idx) {
		        if (idx === 0) {
		          return exports$1.EOF_FOLLOW_KEY;
		        }
		        return {
		          ruleName: _this.shortRuleNameToFullName(ruleName),
		          idxInCallingRule: explicitOccurrenceStack[idx],
		          inRule: _this.shortRuleNameToFullName(explicitRuleStack[idx - 1])
		        };
		      });
		    };
		    Recoverable2.prototype.flattenFollowSet = function() {
		      var _this = this;
		      var followStack = (0, map_1.default)(this.buildFullFollowKeyStack(), function(currKey) {
		        return _this.getFollowSetFromFollowKey(currKey);
		      });
		      return (0, flatten_1.default)(followStack);
		    };
		    Recoverable2.prototype.getFollowSetFromFollowKey = function(followKey) {
		      if (followKey === exports$1.EOF_FOLLOW_KEY) {
		        return [tokens_public_1.EOF];
		      }
		      var followName = followKey.ruleName + followKey.idxInCallingRule + constants_1.IN + followKey.inRule;
		      return this.resyncFollows[followName];
		    };
		    Recoverable2.prototype.addToResyncTokens = function(token, resyncTokens) {
		      if (!this.tokenMatcher(token, tokens_public_1.EOF)) {
		        resyncTokens.push(token);
		      }
		      return resyncTokens;
		    };
		    Recoverable2.prototype.reSyncTo = function(tokType) {
		      var resyncedTokens = [];
		      var nextTok = this.LA(1);
		      while (this.tokenMatcher(nextTok, tokType) === false) {
		        nextTok = this.SKIP_TOKEN();
		        this.addToResyncTokens(nextTok, resyncedTokens);
		      }
		      return (0, dropRight_1.default)(resyncedTokens);
		    };
		    Recoverable2.prototype.attemptInRepetitionRecovery = function(prodFunc, args, lookaheadFunc, dslMethodIdx, prodOccurrence, nextToksWalker, notStuck) {
		    };
		    Recoverable2.prototype.getCurrentGrammarPath = function(tokType, tokIdxInRule) {
		      var pathRuleStack = this.getHumanReadableRuleStack();
		      var pathOccurrenceStack = (0, clone_1.default)(this.RULE_OCCURRENCE_STACK);
		      var grammarPath = {
		        ruleStack: pathRuleStack,
		        occurrenceStack: pathOccurrenceStack,
		        lastTok: tokType,
		        lastTokOccurrence: tokIdxInRule
		      };
		      return grammarPath;
		    };
		    Recoverable2.prototype.getHumanReadableRuleStack = function() {
		      var _this = this;
		      return (0, map_1.default)(this.RULE_STACK, function(currShortName) {
		        return _this.shortRuleNameToFullName(currShortName);
		      });
		    };
		    return Recoverable2;
		  })()
		);
		exports$1.Recoverable = Recoverable;
		function attemptInRepetitionRecovery(prodFunc, args, lookaheadFunc, dslMethodIdx, prodOccurrence, nextToksWalker, notStuck) {
		  var key = this.getKeyForAutomaticLookahead(dslMethodIdx, prodOccurrence);
		  var firstAfterRepInfo = this.firstAfterRepMap[key];
		  if (firstAfterRepInfo === void 0) {
		    var currRuleName = this.getCurrRuleFullName();
		    var ruleGrammar = this.getGAstProductions()[currRuleName];
		    var walker = new nextToksWalker(ruleGrammar, prodOccurrence);
		    firstAfterRepInfo = walker.startWalking();
		    this.firstAfterRepMap[key] = firstAfterRepInfo;
		  }
		  var expectTokAfterLastMatch = firstAfterRepInfo.token;
		  var nextTokIdx = firstAfterRepInfo.occurrence;
		  var isEndOfRule = firstAfterRepInfo.isEndOfRule;
		  if (this.RULE_STACK.length === 1 && isEndOfRule && expectTokAfterLastMatch === void 0) {
		    expectTokAfterLastMatch = tokens_public_1.EOF;
		    nextTokIdx = 1;
		  }
		  if (expectTokAfterLastMatch === void 0 || nextTokIdx === void 0) {
		    return;
		  }
		  if (this.shouldInRepetitionRecoveryBeTried(expectTokAfterLastMatch, nextTokIdx, notStuck)) {
		    this.tryInRepetitionRecovery(prodFunc, args, lookaheadFunc, expectTokAfterLastMatch);
		  }
		}
		exports$1.attemptInRepetitionRecovery = attemptInRepetitionRecovery; 
	} (recoverable));
	return recoverable;
}

var looksahead = {};

var keys = {};

var hasRequiredKeys;

function requireKeys () {
	if (hasRequiredKeys) return keys;
	hasRequiredKeys = 1;
	(function (exports$1) {
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.getKeyForAutomaticLookahead = exports$1.AT_LEAST_ONE_SEP_IDX = exports$1.MANY_SEP_IDX = exports$1.AT_LEAST_ONE_IDX = exports$1.MANY_IDX = exports$1.OPTION_IDX = exports$1.OR_IDX = exports$1.BITS_FOR_ALT_IDX = exports$1.BITS_FOR_RULE_IDX = exports$1.BITS_FOR_OCCURRENCE_IDX = exports$1.BITS_FOR_METHOD_TYPE = void 0;
		exports$1.BITS_FOR_METHOD_TYPE = 4;
		exports$1.BITS_FOR_OCCURRENCE_IDX = 8;
		exports$1.BITS_FOR_RULE_IDX = 12;
		exports$1.BITS_FOR_ALT_IDX = 8;
		exports$1.OR_IDX = 1 << exports$1.BITS_FOR_OCCURRENCE_IDX;
		exports$1.OPTION_IDX = 2 << exports$1.BITS_FOR_OCCURRENCE_IDX;
		exports$1.MANY_IDX = 3 << exports$1.BITS_FOR_OCCURRENCE_IDX;
		exports$1.AT_LEAST_ONE_IDX = 4 << exports$1.BITS_FOR_OCCURRENCE_IDX;
		exports$1.MANY_SEP_IDX = 5 << exports$1.BITS_FOR_OCCURRENCE_IDX;
		exports$1.AT_LEAST_ONE_SEP_IDX = 6 << exports$1.BITS_FOR_OCCURRENCE_IDX;
		function getKeyForAutomaticLookahead(ruleIdx, dslMethodIdx, occurrence) {
		  return occurrence | dslMethodIdx | ruleIdx;
		}
		exports$1.getKeyForAutomaticLookahead = getKeyForAutomaticLookahead;
		32 - exports$1.BITS_FOR_ALT_IDX; 
	} (keys));
	return keys;
}

var llk_lookahead = {};

var hasRequiredLlk_lookahead;

function requireLlk_lookahead () {
	if (hasRequiredLlk_lookahead) return llk_lookahead;
	hasRequiredLlk_lookahead = 1;
	var __spreadArray = llk_lookahead && llk_lookahead.__spreadArray || function(to, from, pack) {
	  if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
	    if (ar || !(i in from)) {
	      if (!ar) ar = Array.prototype.slice.call(from, 0, i);
	      ar[i] = from[i];
	    }
	  }
	  return to.concat(ar || Array.prototype.slice.call(from));
	};
	var __importDefault = llk_lookahead && llk_lookahead.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(llk_lookahead, "__esModule", { value: true });
	llk_lookahead.LLkLookaheadStrategy = void 0;
	var flatMap_1 = __importDefault(requireFlatMap());
	var isEmpty_1 = __importDefault(requireIsEmpty());
	var errors_public_1 = requireErrors_public();
	var parser_1 = requireParser();
	var checks_1 = requireChecks();
	var lookahead_1 = requireLookahead();
	var LLkLookaheadStrategy = (
	  /** @class */
	  (function() {
	    function LLkLookaheadStrategy2(options) {
	      var _a;
	      this.maxLookahead = (_a = options === null || options === void 0 ? void 0 : options.maxLookahead) !== null && _a !== void 0 ? _a : parser_1.DEFAULT_PARSER_CONFIG.maxLookahead;
	    }
	    LLkLookaheadStrategy2.prototype.validate = function(options) {
	      var leftRecursionErrors = this.validateNoLeftRecursion(options.rules);
	      if ((0, isEmpty_1.default)(leftRecursionErrors)) {
	        var emptyAltErrors = this.validateEmptyOrAlternatives(options.rules);
	        var ambiguousAltsErrors = this.validateAmbiguousAlternationAlternatives(options.rules, this.maxLookahead);
	        var emptyRepetitionErrors = this.validateSomeNonEmptyLookaheadPath(options.rules, this.maxLookahead);
	        var allErrors = __spreadArray(__spreadArray(__spreadArray(__spreadArray([], leftRecursionErrors, true), emptyAltErrors, true), ambiguousAltsErrors, true), emptyRepetitionErrors, true);
	        return allErrors;
	      }
	      return leftRecursionErrors;
	    };
	    LLkLookaheadStrategy2.prototype.validateNoLeftRecursion = function(rules) {
	      return (0, flatMap_1.default)(rules, function(currTopRule) {
	        return (0, checks_1.validateNoLeftRecursion)(currTopRule, currTopRule, errors_public_1.defaultGrammarValidatorErrorProvider);
	      });
	    };
	    LLkLookaheadStrategy2.prototype.validateEmptyOrAlternatives = function(rules) {
	      return (0, flatMap_1.default)(rules, function(currTopRule) {
	        return (0, checks_1.validateEmptyOrAlternative)(currTopRule, errors_public_1.defaultGrammarValidatorErrorProvider);
	      });
	    };
	    LLkLookaheadStrategy2.prototype.validateAmbiguousAlternationAlternatives = function(rules, maxLookahead) {
	      return (0, flatMap_1.default)(rules, function(currTopRule) {
	        return (0, checks_1.validateAmbiguousAlternationAlternatives)(currTopRule, maxLookahead, errors_public_1.defaultGrammarValidatorErrorProvider);
	      });
	    };
	    LLkLookaheadStrategy2.prototype.validateSomeNonEmptyLookaheadPath = function(rules, maxLookahead) {
	      return (0, checks_1.validateSomeNonEmptyLookaheadPath)(rules, maxLookahead, errors_public_1.defaultGrammarValidatorErrorProvider);
	    };
	    LLkLookaheadStrategy2.prototype.buildLookaheadForAlternation = function(options) {
	      return (0, lookahead_1.buildLookaheadFuncForOr)(options.prodOccurrence, options.rule, options.maxLookahead, options.hasPredicates, options.dynamicTokensEnabled, lookahead_1.buildAlternativesLookAheadFunc);
	    };
	    LLkLookaheadStrategy2.prototype.buildLookaheadForOptional = function(options) {
	      return (0, lookahead_1.buildLookaheadFuncForOptionalProd)(options.prodOccurrence, options.rule, options.maxLookahead, options.dynamicTokensEnabled, (0, lookahead_1.getProdType)(options.prodType), lookahead_1.buildSingleAlternativeLookaheadFunction);
	    };
	    return LLkLookaheadStrategy2;
	  })()
	);
	llk_lookahead.LLkLookaheadStrategy = LLkLookaheadStrategy;
	return llk_lookahead;
}

var hasRequiredLooksahead;

function requireLooksahead () {
	if (hasRequiredLooksahead) return looksahead;
	hasRequiredLooksahead = 1;
	var __extends = looksahead && looksahead.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __importDefault = looksahead && looksahead.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(looksahead, "__esModule", { value: true });
	looksahead.collectMethods = looksahead.LooksAhead = void 0;
	var forEach_1 = __importDefault(requireForEach());
	var has_1 = __importDefault(requireHas());
	var parser_1 = requireParser();
	var keys_1 = requireKeys();
	var gast_1 = requireApi$2();
	var gast_2 = requireApi$2();
	var llk_lookahead_1 = requireLlk_lookahead();
	var LooksAhead = (
	  /** @class */
	  (function() {
	    function LooksAhead2() {
	    }
	    LooksAhead2.prototype.initLooksAhead = function(config) {
	      this.dynamicTokensEnabled = (0, has_1.default)(config, "dynamicTokensEnabled") ? config.dynamicTokensEnabled : parser_1.DEFAULT_PARSER_CONFIG.dynamicTokensEnabled;
	      this.maxLookahead = (0, has_1.default)(config, "maxLookahead") ? config.maxLookahead : parser_1.DEFAULT_PARSER_CONFIG.maxLookahead;
	      this.lookaheadStrategy = (0, has_1.default)(config, "lookaheadStrategy") ? config.lookaheadStrategy : new llk_lookahead_1.LLkLookaheadStrategy({ maxLookahead: this.maxLookahead });
	      this.lookAheadFuncsCache = /* @__PURE__ */ new Map();
	    };
	    LooksAhead2.prototype.preComputeLookaheadFunctions = function(rules) {
	      var _this = this;
	      (0, forEach_1.default)(rules, function(currRule) {
	        _this.TRACE_INIT("".concat(currRule.name, " Rule Lookahead"), function() {
	          var _a = collectMethods(currRule), alternation = _a.alternation, repetition = _a.repetition, option = _a.option, repetitionMandatory = _a.repetitionMandatory, repetitionMandatoryWithSeparator = _a.repetitionMandatoryWithSeparator, repetitionWithSeparator = _a.repetitionWithSeparator;
	          (0, forEach_1.default)(alternation, function(currProd) {
	            var prodIdx = currProd.idx === 0 ? "" : currProd.idx;
	            _this.TRACE_INIT("".concat((0, gast_2.getProductionDslName)(currProd)).concat(prodIdx), function() {
	              var laFunc = _this.lookaheadStrategy.buildLookaheadForAlternation({
	                prodOccurrence: currProd.idx,
	                rule: currRule,
	                maxLookahead: currProd.maxLookahead || _this.maxLookahead,
	                hasPredicates: currProd.hasPredicates,
	                dynamicTokensEnabled: _this.dynamicTokensEnabled
	              });
	              var key = (0, keys_1.getKeyForAutomaticLookahead)(_this.fullRuleNameToShort[currRule.name], keys_1.OR_IDX, currProd.idx);
	              _this.setLaFuncCache(key, laFunc);
	            });
	          });
	          (0, forEach_1.default)(repetition, function(currProd) {
	            _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.MANY_IDX, "Repetition", currProd.maxLookahead, (0, gast_2.getProductionDslName)(currProd));
	          });
	          (0, forEach_1.default)(option, function(currProd) {
	            _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.OPTION_IDX, "Option", currProd.maxLookahead, (0, gast_2.getProductionDslName)(currProd));
	          });
	          (0, forEach_1.default)(repetitionMandatory, function(currProd) {
	            _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.AT_LEAST_ONE_IDX, "RepetitionMandatory", currProd.maxLookahead, (0, gast_2.getProductionDslName)(currProd));
	          });
	          (0, forEach_1.default)(repetitionMandatoryWithSeparator, function(currProd) {
	            _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.AT_LEAST_ONE_SEP_IDX, "RepetitionMandatoryWithSeparator", currProd.maxLookahead, (0, gast_2.getProductionDslName)(currProd));
	          });
	          (0, forEach_1.default)(repetitionWithSeparator, function(currProd) {
	            _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.MANY_SEP_IDX, "RepetitionWithSeparator", currProd.maxLookahead, (0, gast_2.getProductionDslName)(currProd));
	          });
	        });
	      });
	    };
	    LooksAhead2.prototype.computeLookaheadFunc = function(rule, prodOccurrence, prodKey, prodType, prodMaxLookahead, dslMethodName) {
	      var _this = this;
	      this.TRACE_INIT("".concat(dslMethodName).concat(prodOccurrence === 0 ? "" : prodOccurrence), function() {
	        var laFunc = _this.lookaheadStrategy.buildLookaheadForOptional({
	          prodOccurrence,
	          rule,
	          maxLookahead: prodMaxLookahead || _this.maxLookahead,
	          dynamicTokensEnabled: _this.dynamicTokensEnabled,
	          prodType
	        });
	        var key = (0, keys_1.getKeyForAutomaticLookahead)(_this.fullRuleNameToShort[rule.name], prodKey, prodOccurrence);
	        _this.setLaFuncCache(key, laFunc);
	      });
	    };
	    LooksAhead2.prototype.getKeyForAutomaticLookahead = function(dslMethodIdx, occurrence) {
	      var currRuleShortName = this.getLastExplicitRuleShortName();
	      return (0, keys_1.getKeyForAutomaticLookahead)(currRuleShortName, dslMethodIdx, occurrence);
	    };
	    LooksAhead2.prototype.getLaFuncFromCache = function(key) {
	      return this.lookAheadFuncsCache.get(key);
	    };
	    LooksAhead2.prototype.setLaFuncCache = function(key, value) {
	      this.lookAheadFuncsCache.set(key, value);
	    };
	    return LooksAhead2;
	  })()
	);
	looksahead.LooksAhead = LooksAhead;
	var DslMethodsCollectorVisitor = (
	  /** @class */
	  (function(_super) {
	    __extends(DslMethodsCollectorVisitor2, _super);
	    function DslMethodsCollectorVisitor2() {
	      var _this = _super !== null && _super.apply(this, arguments) || this;
	      _this.dslMethods = {
	        option: [],
	        alternation: [],
	        repetition: [],
	        repetitionWithSeparator: [],
	        repetitionMandatory: [],
	        repetitionMandatoryWithSeparator: []
	      };
	      return _this;
	    }
	    DslMethodsCollectorVisitor2.prototype.reset = function() {
	      this.dslMethods = {
	        option: [],
	        alternation: [],
	        repetition: [],
	        repetitionWithSeparator: [],
	        repetitionMandatory: [],
	        repetitionMandatoryWithSeparator: []
	      };
	    };
	    DslMethodsCollectorVisitor2.prototype.visitOption = function(option) {
	      this.dslMethods.option.push(option);
	    };
	    DslMethodsCollectorVisitor2.prototype.visitRepetitionWithSeparator = function(manySep) {
	      this.dslMethods.repetitionWithSeparator.push(manySep);
	    };
	    DslMethodsCollectorVisitor2.prototype.visitRepetitionMandatory = function(atLeastOne) {
	      this.dslMethods.repetitionMandatory.push(atLeastOne);
	    };
	    DslMethodsCollectorVisitor2.prototype.visitRepetitionMandatoryWithSeparator = function(atLeastOneSep) {
	      this.dslMethods.repetitionMandatoryWithSeparator.push(atLeastOneSep);
	    };
	    DslMethodsCollectorVisitor2.prototype.visitRepetition = function(many) {
	      this.dslMethods.repetition.push(many);
	    };
	    DslMethodsCollectorVisitor2.prototype.visitAlternation = function(or) {
	      this.dslMethods.alternation.push(or);
	    };
	    return DslMethodsCollectorVisitor2;
	  })(gast_1.GAstVisitor)
	);
	var collectorVisitor = new DslMethodsCollectorVisitor();
	function collectMethods(rule) {
	  collectorVisitor.reset();
	  rule.accept(collectorVisitor);
	  var dslMethods = collectorVisitor.dslMethods;
	  collectorVisitor.reset();
	  return dslMethods;
	}
	looksahead.collectMethods = collectMethods;
	return looksahead;
}

var tree_builder = {};

var cst = {};

var hasRequiredCst;

function requireCst () {
	if (hasRequiredCst) return cst;
	hasRequiredCst = 1;
	Object.defineProperty(cst, "__esModule", { value: true });
	cst.addNoneTerminalToCst = cst.addTerminalToCst = cst.setNodeLocationFull = cst.setNodeLocationOnlyOffset = void 0;
	function setNodeLocationOnlyOffset(currNodeLocation, newLocationInfo) {
	  if (isNaN(currNodeLocation.startOffset) === true) {
	    currNodeLocation.startOffset = newLocationInfo.startOffset;
	    currNodeLocation.endOffset = newLocationInfo.endOffset;
	  } else if (currNodeLocation.endOffset < newLocationInfo.endOffset === true) {
	    currNodeLocation.endOffset = newLocationInfo.endOffset;
	  }
	}
	cst.setNodeLocationOnlyOffset = setNodeLocationOnlyOffset;
	function setNodeLocationFull(currNodeLocation, newLocationInfo) {
	  if (isNaN(currNodeLocation.startOffset) === true) {
	    currNodeLocation.startOffset = newLocationInfo.startOffset;
	    currNodeLocation.startColumn = newLocationInfo.startColumn;
	    currNodeLocation.startLine = newLocationInfo.startLine;
	    currNodeLocation.endOffset = newLocationInfo.endOffset;
	    currNodeLocation.endColumn = newLocationInfo.endColumn;
	    currNodeLocation.endLine = newLocationInfo.endLine;
	  } else if (currNodeLocation.endOffset < newLocationInfo.endOffset === true) {
	    currNodeLocation.endOffset = newLocationInfo.endOffset;
	    currNodeLocation.endColumn = newLocationInfo.endColumn;
	    currNodeLocation.endLine = newLocationInfo.endLine;
	  }
	}
	cst.setNodeLocationFull = setNodeLocationFull;
	function addTerminalToCst(node, token, tokenTypeName) {
	  if (node.children[tokenTypeName] === void 0) {
	    node.children[tokenTypeName] = [token];
	  } else {
	    node.children[tokenTypeName].push(token);
	  }
	}
	cst.addTerminalToCst = addTerminalToCst;
	function addNoneTerminalToCst(node, ruleName, ruleResult) {
	  if (node.children[ruleName] === void 0) {
	    node.children[ruleName] = [ruleResult];
	  } else {
	    node.children[ruleName].push(ruleResult);
	  }
	}
	cst.addNoneTerminalToCst = addNoneTerminalToCst;
	return cst;
}

var cst_visitor = {};

var lang_extensions = {};

var hasRequiredLang_extensions;

function requireLang_extensions () {
	if (hasRequiredLang_extensions) return lang_extensions;
	hasRequiredLang_extensions = 1;
	Object.defineProperty(lang_extensions, "__esModule", { value: true });
	lang_extensions.defineNameProp = void 0;
	var NAME = "name";
	function defineNameProp(obj, nameValue) {
	  Object.defineProperty(obj, NAME, {
	    enumerable: false,
	    configurable: true,
	    writable: false,
	    value: nameValue
	  });
	}
	lang_extensions.defineNameProp = defineNameProp;
	return lang_extensions;
}

var hasRequiredCst_visitor;

function requireCst_visitor () {
	if (hasRequiredCst_visitor) return cst_visitor;
	hasRequiredCst_visitor = 1;
	(function (exports$1) {
		var __importDefault = cst_visitor && cst_visitor.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.validateMissingCstMethods = exports$1.validateVisitor = exports$1.CstVisitorDefinitionError = exports$1.createBaseVisitorConstructorWithDefaults = exports$1.createBaseSemanticVisitorConstructor = exports$1.defaultVisit = void 0;
		var isEmpty_1 = __importDefault(requireIsEmpty());
		var compact_1 = __importDefault(requireCompact());
		var isArray_1 = __importDefault(requireIsArray());
		var map_1 = __importDefault(requireMap());
		var forEach_1 = __importDefault(requireForEach());
		var filter_1 = __importDefault(requireFilter());
		var keys_1 = __importDefault(requireKeys$1());
		var isFunction_1 = __importDefault(requireIsFunction());
		var isUndefined_1 = __importDefault(requireIsUndefined());
		var lang_extensions_1 = requireLang_extensions();
		function defaultVisit(ctx, param) {
		  var childrenNames = (0, keys_1.default)(ctx);
		  var childrenNamesLength = childrenNames.length;
		  for (var i = 0; i < childrenNamesLength; i++) {
		    var currChildName = childrenNames[i];
		    var currChildArray = ctx[currChildName];
		    var currChildArrayLength = currChildArray.length;
		    for (var j = 0; j < currChildArrayLength; j++) {
		      var currChild = currChildArray[j];
		      if (currChild.tokenTypeIdx === void 0) {
		        this[currChild.name](currChild.children, param);
		      }
		    }
		  }
		}
		exports$1.defaultVisit = defaultVisit;
		function createBaseSemanticVisitorConstructor(grammarName, ruleNames) {
		  var derivedConstructor = function() {
		  };
		  (0, lang_extensions_1.defineNameProp)(derivedConstructor, grammarName + "BaseSemantics");
		  var semanticProto = {
		    visit: function(cstNode, param) {
		      if ((0, isArray_1.default)(cstNode)) {
		        cstNode = cstNode[0];
		      }
		      if ((0, isUndefined_1.default)(cstNode)) {
		        return void 0;
		      }
		      return this[cstNode.name](cstNode.children, param);
		    },
		    validateVisitor: function() {
		      var semanticDefinitionErrors = validateVisitor(this, ruleNames);
		      if (!(0, isEmpty_1.default)(semanticDefinitionErrors)) {
		        var errorMessages = (0, map_1.default)(semanticDefinitionErrors, function(currDefError) {
		          return currDefError.msg;
		        });
		        throw Error("Errors Detected in CST Visitor <".concat(this.constructor.name, ">:\n	") + "".concat(errorMessages.join("\n\n").replace(/\n/g, "\n	")));
		      }
		    }
		  };
		  derivedConstructor.prototype = semanticProto;
		  derivedConstructor.prototype.constructor = derivedConstructor;
		  derivedConstructor._RULE_NAMES = ruleNames;
		  return derivedConstructor;
		}
		exports$1.createBaseSemanticVisitorConstructor = createBaseSemanticVisitorConstructor;
		function createBaseVisitorConstructorWithDefaults(grammarName, ruleNames, baseConstructor) {
		  var derivedConstructor = function() {
		  };
		  (0, lang_extensions_1.defineNameProp)(derivedConstructor, grammarName + "BaseSemanticsWithDefaults");
		  var withDefaultsProto = Object.create(baseConstructor.prototype);
		  (0, forEach_1.default)(ruleNames, function(ruleName) {
		    withDefaultsProto[ruleName] = defaultVisit;
		  });
		  derivedConstructor.prototype = withDefaultsProto;
		  derivedConstructor.prototype.constructor = derivedConstructor;
		  return derivedConstructor;
		}
		exports$1.createBaseVisitorConstructorWithDefaults = createBaseVisitorConstructorWithDefaults;
		var CstVisitorDefinitionError;
		(function(CstVisitorDefinitionError2) {
		  CstVisitorDefinitionError2[CstVisitorDefinitionError2["REDUNDANT_METHOD"] = 0] = "REDUNDANT_METHOD";
		  CstVisitorDefinitionError2[CstVisitorDefinitionError2["MISSING_METHOD"] = 1] = "MISSING_METHOD";
		})(CstVisitorDefinitionError = exports$1.CstVisitorDefinitionError || (exports$1.CstVisitorDefinitionError = {}));
		function validateVisitor(visitorInstance, ruleNames) {
		  var missingErrors = validateMissingCstMethods(visitorInstance, ruleNames);
		  return missingErrors;
		}
		exports$1.validateVisitor = validateVisitor;
		function validateMissingCstMethods(visitorInstance, ruleNames) {
		  var missingRuleNames = (0, filter_1.default)(ruleNames, function(currRuleName) {
		    return (0, isFunction_1.default)(visitorInstance[currRuleName]) === false;
		  });
		  var errors = (0, map_1.default)(missingRuleNames, function(currRuleName) {
		    return {
		      msg: "Missing visitor method: <".concat(currRuleName, "> on ").concat(visitorInstance.constructor.name, " CST Visitor."),
		      type: CstVisitorDefinitionError.MISSING_METHOD,
		      methodName: currRuleName
		    };
		  });
		  return (0, compact_1.default)(errors);
		}
		exports$1.validateMissingCstMethods = validateMissingCstMethods; 
	} (cst_visitor));
	return cst_visitor;
}

var hasRequiredTree_builder;

function requireTree_builder () {
	if (hasRequiredTree_builder) return tree_builder;
	hasRequiredTree_builder = 1;
	var __importDefault = tree_builder && tree_builder.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(tree_builder, "__esModule", { value: true });
	tree_builder.TreeBuilder = void 0;
	var cst_1 = requireCst();
	var noop_1 = __importDefault(requireNoop());
	var has_1 = __importDefault(requireHas());
	var keys_1 = __importDefault(requireKeys$1());
	var isUndefined_1 = __importDefault(requireIsUndefined());
	var cst_visitor_1 = requireCst_visitor();
	var parser_1 = requireParser();
	var TreeBuilder = (
	  /** @class */
	  (function() {
	    function TreeBuilder2() {
	    }
	    TreeBuilder2.prototype.initTreeBuilder = function(config) {
	      this.CST_STACK = [];
	      this.outputCst = config.outputCst;
	      this.nodeLocationTracking = (0, has_1.default)(config, "nodeLocationTracking") ? config.nodeLocationTracking : parser_1.DEFAULT_PARSER_CONFIG.nodeLocationTracking;
	      if (!this.outputCst) {
	        this.cstInvocationStateUpdate = noop_1.default;
	        this.cstFinallyStateUpdate = noop_1.default;
	        this.cstPostTerminal = noop_1.default;
	        this.cstPostNonTerminal = noop_1.default;
	        this.cstPostRule = noop_1.default;
	      } else {
	        if (/full/i.test(this.nodeLocationTracking)) {
	          if (this.recoveryEnabled) {
	            this.setNodeLocationFromToken = cst_1.setNodeLocationFull;
	            this.setNodeLocationFromNode = cst_1.setNodeLocationFull;
	            this.cstPostRule = noop_1.default;
	            this.setInitialNodeLocation = this.setInitialNodeLocationFullRecovery;
	          } else {
	            this.setNodeLocationFromToken = noop_1.default;
	            this.setNodeLocationFromNode = noop_1.default;
	            this.cstPostRule = this.cstPostRuleFull;
	            this.setInitialNodeLocation = this.setInitialNodeLocationFullRegular;
	          }
	        } else if (/onlyOffset/i.test(this.nodeLocationTracking)) {
	          if (this.recoveryEnabled) {
	            this.setNodeLocationFromToken = cst_1.setNodeLocationOnlyOffset;
	            this.setNodeLocationFromNode = cst_1.setNodeLocationOnlyOffset;
	            this.cstPostRule = noop_1.default;
	            this.setInitialNodeLocation = this.setInitialNodeLocationOnlyOffsetRecovery;
	          } else {
	            this.setNodeLocationFromToken = noop_1.default;
	            this.setNodeLocationFromNode = noop_1.default;
	            this.cstPostRule = this.cstPostRuleOnlyOffset;
	            this.setInitialNodeLocation = this.setInitialNodeLocationOnlyOffsetRegular;
	          }
	        } else if (/none/i.test(this.nodeLocationTracking)) {
	          this.setNodeLocationFromToken = noop_1.default;
	          this.setNodeLocationFromNode = noop_1.default;
	          this.cstPostRule = noop_1.default;
	          this.setInitialNodeLocation = noop_1.default;
	        } else {
	          throw Error('Invalid <nodeLocationTracking> config option: "'.concat(config.nodeLocationTracking, '"'));
	        }
	      }
	    };
	    TreeBuilder2.prototype.setInitialNodeLocationOnlyOffsetRecovery = function(cstNode) {
	      cstNode.location = {
	        startOffset: NaN,
	        endOffset: NaN
	      };
	    };
	    TreeBuilder2.prototype.setInitialNodeLocationOnlyOffsetRegular = function(cstNode) {
	      cstNode.location = {
	        // without error recovery the starting Location of a new CstNode is guaranteed
	        // To be the next Token's startOffset (for valid inputs).
	        // For invalid inputs there won't be any CSTOutput so this potential
	        // inaccuracy does not matter
	        startOffset: this.LA(1).startOffset,
	        endOffset: NaN
	      };
	    };
	    TreeBuilder2.prototype.setInitialNodeLocationFullRecovery = function(cstNode) {
	      cstNode.location = {
	        startOffset: NaN,
	        startLine: NaN,
	        startColumn: NaN,
	        endOffset: NaN,
	        endLine: NaN,
	        endColumn: NaN
	      };
	    };
	    TreeBuilder2.prototype.setInitialNodeLocationFullRegular = function(cstNode) {
	      var nextToken = this.LA(1);
	      cstNode.location = {
	        startOffset: nextToken.startOffset,
	        startLine: nextToken.startLine,
	        startColumn: nextToken.startColumn,
	        endOffset: NaN,
	        endLine: NaN,
	        endColumn: NaN
	      };
	    };
	    TreeBuilder2.prototype.cstInvocationStateUpdate = function(fullRuleName) {
	      var cstNode = {
	        name: fullRuleName,
	        children: /* @__PURE__ */ Object.create(null)
	      };
	      this.setInitialNodeLocation(cstNode);
	      this.CST_STACK.push(cstNode);
	    };
	    TreeBuilder2.prototype.cstFinallyStateUpdate = function() {
	      this.CST_STACK.pop();
	    };
	    TreeBuilder2.prototype.cstPostRuleFull = function(ruleCstNode) {
	      var prevToken = this.LA(0);
	      var loc = ruleCstNode.location;
	      if (loc.startOffset <= prevToken.startOffset === true) {
	        loc.endOffset = prevToken.endOffset;
	        loc.endLine = prevToken.endLine;
	        loc.endColumn = prevToken.endColumn;
	      } else {
	        loc.startOffset = NaN;
	        loc.startLine = NaN;
	        loc.startColumn = NaN;
	      }
	    };
	    TreeBuilder2.prototype.cstPostRuleOnlyOffset = function(ruleCstNode) {
	      var prevToken = this.LA(0);
	      var loc = ruleCstNode.location;
	      if (loc.startOffset <= prevToken.startOffset === true) {
	        loc.endOffset = prevToken.endOffset;
	      } else {
	        loc.startOffset = NaN;
	      }
	    };
	    TreeBuilder2.prototype.cstPostTerminal = function(key, consumedToken) {
	      var rootCst = this.CST_STACK[this.CST_STACK.length - 1];
	      (0, cst_1.addTerminalToCst)(rootCst, consumedToken, key);
	      this.setNodeLocationFromToken(rootCst.location, consumedToken);
	    };
	    TreeBuilder2.prototype.cstPostNonTerminal = function(ruleCstResult, ruleName) {
	      var preCstNode = this.CST_STACK[this.CST_STACK.length - 1];
	      (0, cst_1.addNoneTerminalToCst)(preCstNode, ruleName, ruleCstResult);
	      this.setNodeLocationFromNode(preCstNode.location, ruleCstResult.location);
	    };
	    TreeBuilder2.prototype.getBaseCstVisitorConstructor = function() {
	      if ((0, isUndefined_1.default)(this.baseCstVisitorConstructor)) {
	        var newBaseCstVisitorConstructor = (0, cst_visitor_1.createBaseSemanticVisitorConstructor)(this.className, (0, keys_1.default)(this.gastProductionsCache));
	        this.baseCstVisitorConstructor = newBaseCstVisitorConstructor;
	        return newBaseCstVisitorConstructor;
	      }
	      return this.baseCstVisitorConstructor;
	    };
	    TreeBuilder2.prototype.getBaseCstVisitorConstructorWithDefaults = function() {
	      if ((0, isUndefined_1.default)(this.baseCstVisitorWithDefaultsConstructor)) {
	        var newConstructor = (0, cst_visitor_1.createBaseVisitorConstructorWithDefaults)(this.className, (0, keys_1.default)(this.gastProductionsCache), this.getBaseCstVisitorConstructor());
	        this.baseCstVisitorWithDefaultsConstructor = newConstructor;
	        return newConstructor;
	      }
	      return this.baseCstVisitorWithDefaultsConstructor;
	    };
	    TreeBuilder2.prototype.getLastExplicitRuleShortName = function() {
	      var ruleStack = this.RULE_STACK;
	      return ruleStack[ruleStack.length - 1];
	    };
	    TreeBuilder2.prototype.getPreviousExplicitRuleShortName = function() {
	      var ruleStack = this.RULE_STACK;
	      return ruleStack[ruleStack.length - 2];
	    };
	    TreeBuilder2.prototype.getLastExplicitRuleOccurrenceIndex = function() {
	      var occurrenceStack = this.RULE_OCCURRENCE_STACK;
	      return occurrenceStack[occurrenceStack.length - 1];
	    };
	    return TreeBuilder2;
	  })()
	);
	tree_builder.TreeBuilder = TreeBuilder;
	return tree_builder;
}

var lexer_adapter = {};

var hasRequiredLexer_adapter;

function requireLexer_adapter () {
	if (hasRequiredLexer_adapter) return lexer_adapter;
	hasRequiredLexer_adapter = 1;
	Object.defineProperty(lexer_adapter, "__esModule", { value: true });
	lexer_adapter.LexerAdapter = void 0;
	var parser_1 = requireParser();
	var LexerAdapter = (
	  /** @class */
	  (function() {
	    function LexerAdapter2() {
	    }
	    LexerAdapter2.prototype.initLexerAdapter = function() {
	      this.tokVector = [];
	      this.tokVectorLength = 0;
	      this.currIdx = -1;
	    };
	    Object.defineProperty(LexerAdapter2.prototype, "input", {
	      get: function() {
	        return this.tokVector;
	      },
	      set: function(newInput) {
	        if (this.selfAnalysisDone !== true) {
	          throw Error("Missing <performSelfAnalysis> invocation at the end of the Parser's constructor.");
	        }
	        this.reset();
	        this.tokVector = newInput;
	        this.tokVectorLength = newInput.length;
	      },
	      enumerable: false,
	      configurable: true
	    });
	    LexerAdapter2.prototype.SKIP_TOKEN = function() {
	      if (this.currIdx <= this.tokVector.length - 2) {
	        this.consumeToken();
	        return this.LA(1);
	      } else {
	        return parser_1.END_OF_FILE;
	      }
	    };
	    LexerAdapter2.prototype.LA = function(howMuch) {
	      var soughtIdx = this.currIdx + howMuch;
	      if (soughtIdx < 0 || this.tokVectorLength <= soughtIdx) {
	        return parser_1.END_OF_FILE;
	      } else {
	        return this.tokVector[soughtIdx];
	      }
	    };
	    LexerAdapter2.prototype.consumeToken = function() {
	      this.currIdx++;
	    };
	    LexerAdapter2.prototype.exportLexerState = function() {
	      return this.currIdx;
	    };
	    LexerAdapter2.prototype.importLexerState = function(newState) {
	      this.currIdx = newState;
	    };
	    LexerAdapter2.prototype.resetLexerState = function() {
	      this.currIdx = -1;
	    };
	    LexerAdapter2.prototype.moveToTerminatedState = function() {
	      this.currIdx = this.tokVector.length - 1;
	    };
	    LexerAdapter2.prototype.getLexerPosition = function() {
	      return this.exportLexerState();
	    };
	    return LexerAdapter2;
	  })()
	);
	lexer_adapter.LexerAdapter = LexerAdapter;
	return lexer_adapter;
}

var recognizer_api = {};

var hasRequiredRecognizer_api;

function requireRecognizer_api () {
	if (hasRequiredRecognizer_api) return recognizer_api;
	hasRequiredRecognizer_api = 1;
	var __importDefault = recognizer_api && recognizer_api.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(recognizer_api, "__esModule", { value: true });
	recognizer_api.RecognizerApi = void 0;
	var values_1 = __importDefault(requireValues());
	var includes_1 = __importDefault(requireIncludes());
	var exceptions_public_1 = requireExceptions_public();
	var parser_1 = requireParser();
	var errors_public_1 = requireErrors_public();
	var checks_1 = requireChecks();
	var gast_1 = requireApi$2();
	var RecognizerApi = (
	  /** @class */
	  (function() {
	    function RecognizerApi2() {
	    }
	    RecognizerApi2.prototype.ACTION = function(impl) {
	      return impl.call(this);
	    };
	    RecognizerApi2.prototype.consume = function(idx, tokType, options) {
	      return this.consumeInternal(tokType, idx, options);
	    };
	    RecognizerApi2.prototype.subrule = function(idx, ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, idx, options);
	    };
	    RecognizerApi2.prototype.option = function(idx, actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, idx);
	    };
	    RecognizerApi2.prototype.or = function(idx, altsOrOpts) {
	      return this.orInternal(altsOrOpts, idx);
	    };
	    RecognizerApi2.prototype.many = function(idx, actionORMethodDef) {
	      return this.manyInternal(idx, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.atLeastOne = function(idx, actionORMethodDef) {
	      return this.atLeastOneInternal(idx, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.CONSUME = function(tokType, options) {
	      return this.consumeInternal(tokType, 0, options);
	    };
	    RecognizerApi2.prototype.CONSUME1 = function(tokType, options) {
	      return this.consumeInternal(tokType, 1, options);
	    };
	    RecognizerApi2.prototype.CONSUME2 = function(tokType, options) {
	      return this.consumeInternal(tokType, 2, options);
	    };
	    RecognizerApi2.prototype.CONSUME3 = function(tokType, options) {
	      return this.consumeInternal(tokType, 3, options);
	    };
	    RecognizerApi2.prototype.CONSUME4 = function(tokType, options) {
	      return this.consumeInternal(tokType, 4, options);
	    };
	    RecognizerApi2.prototype.CONSUME5 = function(tokType, options) {
	      return this.consumeInternal(tokType, 5, options);
	    };
	    RecognizerApi2.prototype.CONSUME6 = function(tokType, options) {
	      return this.consumeInternal(tokType, 6, options);
	    };
	    RecognizerApi2.prototype.CONSUME7 = function(tokType, options) {
	      return this.consumeInternal(tokType, 7, options);
	    };
	    RecognizerApi2.prototype.CONSUME8 = function(tokType, options) {
	      return this.consumeInternal(tokType, 8, options);
	    };
	    RecognizerApi2.prototype.CONSUME9 = function(tokType, options) {
	      return this.consumeInternal(tokType, 9, options);
	    };
	    RecognizerApi2.prototype.SUBRULE = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 0, options);
	    };
	    RecognizerApi2.prototype.SUBRULE1 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 1, options);
	    };
	    RecognizerApi2.prototype.SUBRULE2 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 2, options);
	    };
	    RecognizerApi2.prototype.SUBRULE3 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 3, options);
	    };
	    RecognizerApi2.prototype.SUBRULE4 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 4, options);
	    };
	    RecognizerApi2.prototype.SUBRULE5 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 5, options);
	    };
	    RecognizerApi2.prototype.SUBRULE6 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 6, options);
	    };
	    RecognizerApi2.prototype.SUBRULE7 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 7, options);
	    };
	    RecognizerApi2.prototype.SUBRULE8 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 8, options);
	    };
	    RecognizerApi2.prototype.SUBRULE9 = function(ruleToCall, options) {
	      return this.subruleInternal(ruleToCall, 9, options);
	    };
	    RecognizerApi2.prototype.OPTION = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 0);
	    };
	    RecognizerApi2.prototype.OPTION1 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 1);
	    };
	    RecognizerApi2.prototype.OPTION2 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 2);
	    };
	    RecognizerApi2.prototype.OPTION3 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 3);
	    };
	    RecognizerApi2.prototype.OPTION4 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 4);
	    };
	    RecognizerApi2.prototype.OPTION5 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 5);
	    };
	    RecognizerApi2.prototype.OPTION6 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 6);
	    };
	    RecognizerApi2.prototype.OPTION7 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 7);
	    };
	    RecognizerApi2.prototype.OPTION8 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 8);
	    };
	    RecognizerApi2.prototype.OPTION9 = function(actionORMethodDef) {
	      return this.optionInternal(actionORMethodDef, 9);
	    };
	    RecognizerApi2.prototype.OR = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 0);
	    };
	    RecognizerApi2.prototype.OR1 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 1);
	    };
	    RecognizerApi2.prototype.OR2 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 2);
	    };
	    RecognizerApi2.prototype.OR3 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 3);
	    };
	    RecognizerApi2.prototype.OR4 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 4);
	    };
	    RecognizerApi2.prototype.OR5 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 5);
	    };
	    RecognizerApi2.prototype.OR6 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 6);
	    };
	    RecognizerApi2.prototype.OR7 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 7);
	    };
	    RecognizerApi2.prototype.OR8 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 8);
	    };
	    RecognizerApi2.prototype.OR9 = function(altsOrOpts) {
	      return this.orInternal(altsOrOpts, 9);
	    };
	    RecognizerApi2.prototype.MANY = function(actionORMethodDef) {
	      this.manyInternal(0, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY1 = function(actionORMethodDef) {
	      this.manyInternal(1, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY2 = function(actionORMethodDef) {
	      this.manyInternal(2, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY3 = function(actionORMethodDef) {
	      this.manyInternal(3, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY4 = function(actionORMethodDef) {
	      this.manyInternal(4, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY5 = function(actionORMethodDef) {
	      this.manyInternal(5, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY6 = function(actionORMethodDef) {
	      this.manyInternal(6, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY7 = function(actionORMethodDef) {
	      this.manyInternal(7, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY8 = function(actionORMethodDef) {
	      this.manyInternal(8, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY9 = function(actionORMethodDef) {
	      this.manyInternal(9, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.MANY_SEP = function(options) {
	      this.manySepFirstInternal(0, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP1 = function(options) {
	      this.manySepFirstInternal(1, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP2 = function(options) {
	      this.manySepFirstInternal(2, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP3 = function(options) {
	      this.manySepFirstInternal(3, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP4 = function(options) {
	      this.manySepFirstInternal(4, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP5 = function(options) {
	      this.manySepFirstInternal(5, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP6 = function(options) {
	      this.manySepFirstInternal(6, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP7 = function(options) {
	      this.manySepFirstInternal(7, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP8 = function(options) {
	      this.manySepFirstInternal(8, options);
	    };
	    RecognizerApi2.prototype.MANY_SEP9 = function(options) {
	      this.manySepFirstInternal(9, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE = function(actionORMethodDef) {
	      this.atLeastOneInternal(0, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE1 = function(actionORMethodDef) {
	      return this.atLeastOneInternal(1, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE2 = function(actionORMethodDef) {
	      this.atLeastOneInternal(2, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE3 = function(actionORMethodDef) {
	      this.atLeastOneInternal(3, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE4 = function(actionORMethodDef) {
	      this.atLeastOneInternal(4, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE5 = function(actionORMethodDef) {
	      this.atLeastOneInternal(5, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE6 = function(actionORMethodDef) {
	      this.atLeastOneInternal(6, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE7 = function(actionORMethodDef) {
	      this.atLeastOneInternal(7, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE8 = function(actionORMethodDef) {
	      this.atLeastOneInternal(8, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE9 = function(actionORMethodDef) {
	      this.atLeastOneInternal(9, actionORMethodDef);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP = function(options) {
	      this.atLeastOneSepFirstInternal(0, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP1 = function(options) {
	      this.atLeastOneSepFirstInternal(1, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP2 = function(options) {
	      this.atLeastOneSepFirstInternal(2, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP3 = function(options) {
	      this.atLeastOneSepFirstInternal(3, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP4 = function(options) {
	      this.atLeastOneSepFirstInternal(4, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP5 = function(options) {
	      this.atLeastOneSepFirstInternal(5, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP6 = function(options) {
	      this.atLeastOneSepFirstInternal(6, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP7 = function(options) {
	      this.atLeastOneSepFirstInternal(7, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP8 = function(options) {
	      this.atLeastOneSepFirstInternal(8, options);
	    };
	    RecognizerApi2.prototype.AT_LEAST_ONE_SEP9 = function(options) {
	      this.atLeastOneSepFirstInternal(9, options);
	    };
	    RecognizerApi2.prototype.RULE = function(name, implementation, config) {
	      if (config === void 0) {
	        config = parser_1.DEFAULT_RULE_CONFIG;
	      }
	      if ((0, includes_1.default)(this.definedRulesNames, name)) {
	        var errMsg = errors_public_1.defaultGrammarValidatorErrorProvider.buildDuplicateRuleNameError({
	          topLevelRule: name,
	          grammarName: this.className
	        });
	        var error = {
	          message: errMsg,
	          type: parser_1.ParserDefinitionErrorType.DUPLICATE_RULE_NAME,
	          ruleName: name
	        };
	        this.definitionErrors.push(error);
	      }
	      this.definedRulesNames.push(name);
	      var ruleImplementation = this.defineRule(name, implementation, config);
	      this[name] = ruleImplementation;
	      return ruleImplementation;
	    };
	    RecognizerApi2.prototype.OVERRIDE_RULE = function(name, impl, config) {
	      if (config === void 0) {
	        config = parser_1.DEFAULT_RULE_CONFIG;
	      }
	      var ruleErrors = (0, checks_1.validateRuleIsOverridden)(name, this.definedRulesNames, this.className);
	      this.definitionErrors = this.definitionErrors.concat(ruleErrors);
	      var ruleImplementation = this.defineRule(name, impl, config);
	      this[name] = ruleImplementation;
	      return ruleImplementation;
	    };
	    RecognizerApi2.prototype.BACKTRACK = function(grammarRule, args) {
	      return function() {
	        this.isBackTrackingStack.push(1);
	        var orgState = this.saveRecogState();
	        try {
	          grammarRule.apply(this, args);
	          return true;
	        } catch (e) {
	          if ((0, exceptions_public_1.isRecognitionException)(e)) {
	            return false;
	          } else {
	            throw e;
	          }
	        } finally {
	          this.reloadRecogState(orgState);
	          this.isBackTrackingStack.pop();
	        }
	      };
	    };
	    RecognizerApi2.prototype.getGAstProductions = function() {
	      return this.gastProductionsCache;
	    };
	    RecognizerApi2.prototype.getSerializedGastProductions = function() {
	      return (0, gast_1.serializeGrammar)((0, values_1.default)(this.gastProductionsCache));
	    };
	    return RecognizerApi2;
	  })()
	);
	recognizer_api.RecognizerApi = RecognizerApi;
	return recognizer_api;
}

var recognizer_engine = {};

var hasRequiredRecognizer_engine;

function requireRecognizer_engine () {
	if (hasRequiredRecognizer_engine) return recognizer_engine;
	hasRequiredRecognizer_engine = 1;
	var __importDefault = recognizer_engine && recognizer_engine.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(recognizer_engine, "__esModule", { value: true });
	recognizer_engine.RecognizerEngine = void 0;
	var isEmpty_1 = __importDefault(requireIsEmpty());
	var isArray_1 = __importDefault(requireIsArray());
	var flatten_1 = __importDefault(requireFlatten());
	var every_1 = __importDefault(requireEvery());
	var uniq_1 = __importDefault(requireUniq());
	var isObject_1 = __importDefault(requireIsObject());
	var has_1 = __importDefault(requireHas());
	var values_1 = __importDefault(requireValues());
	var reduce_1 = __importDefault(requireReduce());
	var clone_1 = __importDefault(requireClone());
	var keys_1 = requireKeys();
	var exceptions_public_1 = requireExceptions_public();
	var lookahead_1 = requireLookahead();
	var interpreter_1 = requireInterpreter();
	var parser_1 = requireParser();
	var recoverable_1 = requireRecoverable();
	var tokens_public_1 = requireTokens_public();
	var tokens_1 = requireTokens();
	var RecognizerEngine = (
	  /** @class */
	  (function() {
	    function RecognizerEngine2() {
	    }
	    RecognizerEngine2.prototype.initRecognizerEngine = function(tokenVocabulary, config) {
	      this.className = this.constructor.name;
	      this.shortRuleNameToFull = {};
	      this.fullRuleNameToShort = {};
	      this.ruleShortNameIdx = 256;
	      this.tokenMatcher = tokens_1.tokenStructuredMatcherNoCategories;
	      this.subruleIdx = 0;
	      this.definedRulesNames = [];
	      this.tokensMap = {};
	      this.isBackTrackingStack = [];
	      this.RULE_STACK = [];
	      this.RULE_OCCURRENCE_STACK = [];
	      this.gastProductionsCache = {};
	      if ((0, has_1.default)(config, "serializedGrammar")) {
	        throw Error("The Parser's configuration can no longer contain a <serializedGrammar> property.\n	See: https://chevrotain.io/docs/changes/BREAKING_CHANGES.html#_6-0-0\n	For Further details.");
	      }
	      if ((0, isArray_1.default)(tokenVocabulary)) {
	        if ((0, isEmpty_1.default)(tokenVocabulary)) {
	          throw Error("A Token Vocabulary cannot be empty.\n	Note that the first argument for the parser constructor\n	is no longer a Token vector (since v4.0).");
	        }
	        if (typeof tokenVocabulary[0].startOffset === "number") {
	          throw Error("The Parser constructor no longer accepts a token vector as the first argument.\n	See: https://chevrotain.io/docs/changes/BREAKING_CHANGES.html#_4-0-0\n	For Further details.");
	        }
	      }
	      if ((0, isArray_1.default)(tokenVocabulary)) {
	        this.tokensMap = (0, reduce_1.default)(tokenVocabulary, function(acc, tokType) {
	          acc[tokType.name] = tokType;
	          return acc;
	        }, {});
	      } else if ((0, has_1.default)(tokenVocabulary, "modes") && (0, every_1.default)((0, flatten_1.default)((0, values_1.default)(tokenVocabulary.modes)), tokens_1.isTokenType)) {
	        var allTokenTypes_1 = (0, flatten_1.default)((0, values_1.default)(tokenVocabulary.modes));
	        var uniqueTokens = (0, uniq_1.default)(allTokenTypes_1);
	        this.tokensMap = (0, reduce_1.default)(uniqueTokens, function(acc, tokType) {
	          acc[tokType.name] = tokType;
	          return acc;
	        }, {});
	      } else if ((0, isObject_1.default)(tokenVocabulary)) {
	        this.tokensMap = (0, clone_1.default)(tokenVocabulary);
	      } else {
	        throw new Error("<tokensDictionary> argument must be An Array of Token constructors, A dictionary of Token constructors or an IMultiModeLexerDefinition");
	      }
	      this.tokensMap["EOF"] = tokens_public_1.EOF;
	      var allTokenTypes = (0, has_1.default)(tokenVocabulary, "modes") ? (0, flatten_1.default)((0, values_1.default)(tokenVocabulary.modes)) : (0, values_1.default)(tokenVocabulary);
	      var noTokenCategoriesUsed = (0, every_1.default)(allTokenTypes, function(tokenConstructor) {
	        return (0, isEmpty_1.default)(tokenConstructor.categoryMatches);
	      });
	      this.tokenMatcher = noTokenCategoriesUsed ? tokens_1.tokenStructuredMatcherNoCategories : tokens_1.tokenStructuredMatcher;
	      (0, tokens_1.augmentTokenTypes)((0, values_1.default)(this.tokensMap));
	    };
	    RecognizerEngine2.prototype.defineRule = function(ruleName, impl, config) {
	      if (this.selfAnalysisDone) {
	        throw Error("Grammar rule <".concat(ruleName, "> may not be defined after the 'performSelfAnalysis' method has been called'\n") + "Make sure that all grammar rule definitions are done before 'performSelfAnalysis' is called.");
	      }
	      var resyncEnabled = (0, has_1.default)(config, "resyncEnabled") ? config.resyncEnabled : parser_1.DEFAULT_RULE_CONFIG.resyncEnabled;
	      var recoveryValueFunc = (0, has_1.default)(config, "recoveryValueFunc") ? config.recoveryValueFunc : parser_1.DEFAULT_RULE_CONFIG.recoveryValueFunc;
	      var shortName = this.ruleShortNameIdx << keys_1.BITS_FOR_METHOD_TYPE + keys_1.BITS_FOR_OCCURRENCE_IDX;
	      this.ruleShortNameIdx++;
	      this.shortRuleNameToFull[shortName] = ruleName;
	      this.fullRuleNameToShort[ruleName] = shortName;
	      var invokeRuleWithTry;
	      if (this.outputCst === true) {
	        invokeRuleWithTry = function invokeRuleWithTry2() {
	          var args = [];
	          for (var _i = 0; _i < arguments.length; _i++) {
	            args[_i] = arguments[_i];
	          }
	          try {
	            this.ruleInvocationStateUpdate(shortName, ruleName, this.subruleIdx);
	            impl.apply(this, args);
	            var cst = this.CST_STACK[this.CST_STACK.length - 1];
	            this.cstPostRule(cst);
	            return cst;
	          } catch (e) {
	            return this.invokeRuleCatch(e, resyncEnabled, recoveryValueFunc);
	          } finally {
	            this.ruleFinallyStateUpdate();
	          }
	        };
	      } else {
	        invokeRuleWithTry = function invokeRuleWithTryCst() {
	          var args = [];
	          for (var _i = 0; _i < arguments.length; _i++) {
	            args[_i] = arguments[_i];
	          }
	          try {
	            this.ruleInvocationStateUpdate(shortName, ruleName, this.subruleIdx);
	            return impl.apply(this, args);
	          } catch (e) {
	            return this.invokeRuleCatch(e, resyncEnabled, recoveryValueFunc);
	          } finally {
	            this.ruleFinallyStateUpdate();
	          }
	        };
	      }
	      var wrappedGrammarRule = Object.assign(invokeRuleWithTry, { ruleName, originalGrammarAction: impl });
	      return wrappedGrammarRule;
	    };
	    RecognizerEngine2.prototype.invokeRuleCatch = function(e, resyncEnabledConfig, recoveryValueFunc) {
	      var isFirstInvokedRule = this.RULE_STACK.length === 1;
	      var reSyncEnabled = resyncEnabledConfig && !this.isBackTracking() && this.recoveryEnabled;
	      if ((0, exceptions_public_1.isRecognitionException)(e)) {
	        var recogError = e;
	        if (reSyncEnabled) {
	          var reSyncTokType = this.findReSyncTokenType();
	          if (this.isInCurrentRuleReSyncSet(reSyncTokType)) {
	            recogError.resyncedTokens = this.reSyncTo(reSyncTokType);
	            if (this.outputCst) {
	              var partialCstResult = this.CST_STACK[this.CST_STACK.length - 1];
	              partialCstResult.recoveredNode = true;
	              return partialCstResult;
	            } else {
	              return recoveryValueFunc(e);
	            }
	          } else {
	            if (this.outputCst) {
	              var partialCstResult = this.CST_STACK[this.CST_STACK.length - 1];
	              partialCstResult.recoveredNode = true;
	              recogError.partialCstResult = partialCstResult;
	            }
	            throw recogError;
	          }
	        } else if (isFirstInvokedRule) {
	          this.moveToTerminatedState();
	          return recoveryValueFunc(e);
	        } else {
	          throw recogError;
	        }
	      } else {
	        throw e;
	      }
	    };
	    RecognizerEngine2.prototype.optionInternal = function(actionORMethodDef, occurrence) {
	      var key = this.getKeyForAutomaticLookahead(keys_1.OPTION_IDX, occurrence);
	      return this.optionInternalLogic(actionORMethodDef, occurrence, key);
	    };
	    RecognizerEngine2.prototype.optionInternalLogic = function(actionORMethodDef, occurrence, key) {
	      var _this = this;
	      var lookAheadFunc = this.getLaFuncFromCache(key);
	      var action;
	      if (typeof actionORMethodDef !== "function") {
	        action = actionORMethodDef.DEF;
	        var predicate_1 = actionORMethodDef.GATE;
	        if (predicate_1 !== void 0) {
	          var orgLookaheadFunction_1 = lookAheadFunc;
	          lookAheadFunc = function() {
	            return predicate_1.call(_this) && orgLookaheadFunction_1.call(_this);
	          };
	        }
	      } else {
	        action = actionORMethodDef;
	      }
	      if (lookAheadFunc.call(this) === true) {
	        return action.call(this);
	      }
	      return void 0;
	    };
	    RecognizerEngine2.prototype.atLeastOneInternal = function(prodOccurrence, actionORMethodDef) {
	      var laKey = this.getKeyForAutomaticLookahead(keys_1.AT_LEAST_ONE_IDX, prodOccurrence);
	      return this.atLeastOneInternalLogic(prodOccurrence, actionORMethodDef, laKey);
	    };
	    RecognizerEngine2.prototype.atLeastOneInternalLogic = function(prodOccurrence, actionORMethodDef, key) {
	      var _this = this;
	      var lookAheadFunc = this.getLaFuncFromCache(key);
	      var action;
	      if (typeof actionORMethodDef !== "function") {
	        action = actionORMethodDef.DEF;
	        var predicate_2 = actionORMethodDef.GATE;
	        if (predicate_2 !== void 0) {
	          var orgLookaheadFunction_2 = lookAheadFunc;
	          lookAheadFunc = function() {
	            return predicate_2.call(_this) && orgLookaheadFunction_2.call(_this);
	          };
	        }
	      } else {
	        action = actionORMethodDef;
	      }
	      if (lookAheadFunc.call(this) === true) {
	        var notStuck = this.doSingleRepetition(action);
	        while (lookAheadFunc.call(this) === true && notStuck === true) {
	          notStuck = this.doSingleRepetition(action);
	        }
	      } else {
	        throw this.raiseEarlyExitException(prodOccurrence, lookahead_1.PROD_TYPE.REPETITION_MANDATORY, actionORMethodDef.ERR_MSG);
	      }
	      this.attemptInRepetitionRecovery(this.atLeastOneInternal, [prodOccurrence, actionORMethodDef], lookAheadFunc, keys_1.AT_LEAST_ONE_IDX, prodOccurrence, interpreter_1.NextTerminalAfterAtLeastOneWalker);
	    };
	    RecognizerEngine2.prototype.atLeastOneSepFirstInternal = function(prodOccurrence, options) {
	      var laKey = this.getKeyForAutomaticLookahead(keys_1.AT_LEAST_ONE_SEP_IDX, prodOccurrence);
	      this.atLeastOneSepFirstInternalLogic(prodOccurrence, options, laKey);
	    };
	    RecognizerEngine2.prototype.atLeastOneSepFirstInternalLogic = function(prodOccurrence, options, key) {
	      var _this = this;
	      var action = options.DEF;
	      var separator = options.SEP;
	      var firstIterationLookaheadFunc = this.getLaFuncFromCache(key);
	      if (firstIterationLookaheadFunc.call(this) === true) {
	        action.call(this);
	        var separatorLookAheadFunc = function() {
	          return _this.tokenMatcher(_this.LA(1), separator);
	        };
	        while (this.tokenMatcher(this.LA(1), separator) === true) {
	          this.CONSUME(separator);
	          action.call(this);
	        }
	        this.attemptInRepetitionRecovery(this.repetitionSepSecondInternal, [
	          prodOccurrence,
	          separator,
	          separatorLookAheadFunc,
	          action,
	          interpreter_1.NextTerminalAfterAtLeastOneSepWalker
	        ], separatorLookAheadFunc, keys_1.AT_LEAST_ONE_SEP_IDX, prodOccurrence, interpreter_1.NextTerminalAfterAtLeastOneSepWalker);
	      } else {
	        throw this.raiseEarlyExitException(prodOccurrence, lookahead_1.PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR, options.ERR_MSG);
	      }
	    };
	    RecognizerEngine2.prototype.manyInternal = function(prodOccurrence, actionORMethodDef) {
	      var laKey = this.getKeyForAutomaticLookahead(keys_1.MANY_IDX, prodOccurrence);
	      return this.manyInternalLogic(prodOccurrence, actionORMethodDef, laKey);
	    };
	    RecognizerEngine2.prototype.manyInternalLogic = function(prodOccurrence, actionORMethodDef, key) {
	      var _this = this;
	      var lookaheadFunction = this.getLaFuncFromCache(key);
	      var action;
	      if (typeof actionORMethodDef !== "function") {
	        action = actionORMethodDef.DEF;
	        var predicate_3 = actionORMethodDef.GATE;
	        if (predicate_3 !== void 0) {
	          var orgLookaheadFunction_3 = lookaheadFunction;
	          lookaheadFunction = function() {
	            return predicate_3.call(_this) && orgLookaheadFunction_3.call(_this);
	          };
	        }
	      } else {
	        action = actionORMethodDef;
	      }
	      var notStuck = true;
	      while (lookaheadFunction.call(this) === true && notStuck === true) {
	        notStuck = this.doSingleRepetition(action);
	      }
	      this.attemptInRepetitionRecovery(
	        this.manyInternal,
	        [prodOccurrence, actionORMethodDef],
	        lookaheadFunction,
	        keys_1.MANY_IDX,
	        prodOccurrence,
	        interpreter_1.NextTerminalAfterManyWalker,
	        // The notStuck parameter is only relevant when "attemptInRepetitionRecovery"
	        // is invoked from manyInternal, in the MANY_SEP case and AT_LEAST_ONE[_SEP]
	        // An infinite loop cannot occur as:
	        // - Either the lookahead is guaranteed to consume something (Single Token Separator)
	        // - AT_LEAST_ONE by definition is guaranteed to consume something (or error out).
	        notStuck
	      );
	    };
	    RecognizerEngine2.prototype.manySepFirstInternal = function(prodOccurrence, options) {
	      var laKey = this.getKeyForAutomaticLookahead(keys_1.MANY_SEP_IDX, prodOccurrence);
	      this.manySepFirstInternalLogic(prodOccurrence, options, laKey);
	    };
	    RecognizerEngine2.prototype.manySepFirstInternalLogic = function(prodOccurrence, options, key) {
	      var _this = this;
	      var action = options.DEF;
	      var separator = options.SEP;
	      var firstIterationLaFunc = this.getLaFuncFromCache(key);
	      if (firstIterationLaFunc.call(this) === true) {
	        action.call(this);
	        var separatorLookAheadFunc = function() {
	          return _this.tokenMatcher(_this.LA(1), separator);
	        };
	        while (this.tokenMatcher(this.LA(1), separator) === true) {
	          this.CONSUME(separator);
	          action.call(this);
	        }
	        this.attemptInRepetitionRecovery(this.repetitionSepSecondInternal, [
	          prodOccurrence,
	          separator,
	          separatorLookAheadFunc,
	          action,
	          interpreter_1.NextTerminalAfterManySepWalker
	        ], separatorLookAheadFunc, keys_1.MANY_SEP_IDX, prodOccurrence, interpreter_1.NextTerminalAfterManySepWalker);
	      }
	    };
	    RecognizerEngine2.prototype.repetitionSepSecondInternal = function(prodOccurrence, separator, separatorLookAheadFunc, action, nextTerminalAfterWalker) {
	      while (separatorLookAheadFunc()) {
	        this.CONSUME(separator);
	        action.call(this);
	      }
	      this.attemptInRepetitionRecovery(this.repetitionSepSecondInternal, [
	        prodOccurrence,
	        separator,
	        separatorLookAheadFunc,
	        action,
	        nextTerminalAfterWalker
	      ], separatorLookAheadFunc, keys_1.AT_LEAST_ONE_SEP_IDX, prodOccurrence, nextTerminalAfterWalker);
	    };
	    RecognizerEngine2.prototype.doSingleRepetition = function(action) {
	      var beforeIteration = this.getLexerPosition();
	      action.call(this);
	      var afterIteration = this.getLexerPosition();
	      return afterIteration > beforeIteration;
	    };
	    RecognizerEngine2.prototype.orInternal = function(altsOrOpts, occurrence) {
	      var laKey = this.getKeyForAutomaticLookahead(keys_1.OR_IDX, occurrence);
	      var alts = (0, isArray_1.default)(altsOrOpts) ? altsOrOpts : altsOrOpts.DEF;
	      var laFunc = this.getLaFuncFromCache(laKey);
	      var altIdxToTake = laFunc.call(this, alts);
	      if (altIdxToTake !== void 0) {
	        var chosenAlternative = alts[altIdxToTake];
	        return chosenAlternative.ALT.call(this);
	      }
	      this.raiseNoAltException(occurrence, altsOrOpts.ERR_MSG);
	    };
	    RecognizerEngine2.prototype.ruleFinallyStateUpdate = function() {
	      this.RULE_STACK.pop();
	      this.RULE_OCCURRENCE_STACK.pop();
	      this.cstFinallyStateUpdate();
	      if (this.RULE_STACK.length === 0 && this.isAtEndOfInput() === false) {
	        var firstRedundantTok = this.LA(1);
	        var errMsg = this.errorMessageProvider.buildNotAllInputParsedMessage({
	          firstRedundant: firstRedundantTok,
	          ruleName: this.getCurrRuleFullName()
	        });
	        this.SAVE_ERROR(new exceptions_public_1.NotAllInputParsedException(errMsg, firstRedundantTok));
	      }
	    };
	    RecognizerEngine2.prototype.subruleInternal = function(ruleToCall, idx, options) {
	      var ruleResult;
	      try {
	        var args = options !== void 0 ? options.ARGS : void 0;
	        this.subruleIdx = idx;
	        ruleResult = ruleToCall.apply(this, args);
	        this.cstPostNonTerminal(ruleResult, options !== void 0 && options.LABEL !== void 0 ? options.LABEL : ruleToCall.ruleName);
	        return ruleResult;
	      } catch (e) {
	        throw this.subruleInternalError(e, options, ruleToCall.ruleName);
	      }
	    };
	    RecognizerEngine2.prototype.subruleInternalError = function(e, options, ruleName) {
	      if ((0, exceptions_public_1.isRecognitionException)(e) && e.partialCstResult !== void 0) {
	        this.cstPostNonTerminal(e.partialCstResult, options !== void 0 && options.LABEL !== void 0 ? options.LABEL : ruleName);
	        delete e.partialCstResult;
	      }
	      throw e;
	    };
	    RecognizerEngine2.prototype.consumeInternal = function(tokType, idx, options) {
	      var consumedToken;
	      try {
	        var nextToken = this.LA(1);
	        if (this.tokenMatcher(nextToken, tokType) === true) {
	          this.consumeToken();
	          consumedToken = nextToken;
	        } else {
	          this.consumeInternalError(tokType, nextToken, options);
	        }
	      } catch (eFromConsumption) {
	        consumedToken = this.consumeInternalRecovery(tokType, idx, eFromConsumption);
	      }
	      this.cstPostTerminal(options !== void 0 && options.LABEL !== void 0 ? options.LABEL : tokType.name, consumedToken);
	      return consumedToken;
	    };
	    RecognizerEngine2.prototype.consumeInternalError = function(tokType, nextToken, options) {
	      var msg;
	      var previousToken = this.LA(0);
	      if (options !== void 0 && options.ERR_MSG) {
	        msg = options.ERR_MSG;
	      } else {
	        msg = this.errorMessageProvider.buildMismatchTokenMessage({
	          expected: tokType,
	          actual: nextToken,
	          previous: previousToken,
	          ruleName: this.getCurrRuleFullName()
	        });
	      }
	      throw this.SAVE_ERROR(new exceptions_public_1.MismatchedTokenException(msg, nextToken, previousToken));
	    };
	    RecognizerEngine2.prototype.consumeInternalRecovery = function(tokType, idx, eFromConsumption) {
	      if (this.recoveryEnabled && // TODO: more robust checking of the exception type. Perhaps Typescript extending expressions?
	      eFromConsumption.name === "MismatchedTokenException" && !this.isBackTracking()) {
	        var follows = this.getFollowsForInRuleRecovery(tokType, idx);
	        try {
	          return this.tryInRuleRecovery(tokType, follows);
	        } catch (eFromInRuleRecovery) {
	          if (eFromInRuleRecovery.name === recoverable_1.IN_RULE_RECOVERY_EXCEPTION) {
	            throw eFromConsumption;
	          } else {
	            throw eFromInRuleRecovery;
	          }
	        }
	      } else {
	        throw eFromConsumption;
	      }
	    };
	    RecognizerEngine2.prototype.saveRecogState = function() {
	      var savedErrors = this.errors;
	      var savedRuleStack = (0, clone_1.default)(this.RULE_STACK);
	      return {
	        errors: savedErrors,
	        lexerState: this.exportLexerState(),
	        RULE_STACK: savedRuleStack,
	        CST_STACK: this.CST_STACK
	      };
	    };
	    RecognizerEngine2.prototype.reloadRecogState = function(newState) {
	      this.errors = newState.errors;
	      this.importLexerState(newState.lexerState);
	      this.RULE_STACK = newState.RULE_STACK;
	    };
	    RecognizerEngine2.prototype.ruleInvocationStateUpdate = function(shortName, fullName, idxInCallingRule) {
	      this.RULE_OCCURRENCE_STACK.push(idxInCallingRule);
	      this.RULE_STACK.push(shortName);
	      this.cstInvocationStateUpdate(fullName);
	    };
	    RecognizerEngine2.prototype.isBackTracking = function() {
	      return this.isBackTrackingStack.length !== 0;
	    };
	    RecognizerEngine2.prototype.getCurrRuleFullName = function() {
	      var shortName = this.getLastExplicitRuleShortName();
	      return this.shortRuleNameToFull[shortName];
	    };
	    RecognizerEngine2.prototype.shortRuleNameToFullName = function(shortName) {
	      return this.shortRuleNameToFull[shortName];
	    };
	    RecognizerEngine2.prototype.isAtEndOfInput = function() {
	      return this.tokenMatcher(this.LA(1), tokens_public_1.EOF);
	    };
	    RecognizerEngine2.prototype.reset = function() {
	      this.resetLexerState();
	      this.subruleIdx = 0;
	      this.isBackTrackingStack = [];
	      this.errors = [];
	      this.RULE_STACK = [];
	      this.CST_STACK = [];
	      this.RULE_OCCURRENCE_STACK = [];
	    };
	    return RecognizerEngine2;
	  })()
	);
	recognizer_engine.RecognizerEngine = RecognizerEngine;
	return recognizer_engine;
}

var error_handler = {};

var hasRequiredError_handler;

function requireError_handler () {
	if (hasRequiredError_handler) return error_handler;
	hasRequiredError_handler = 1;
	var __importDefault = error_handler && error_handler.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(error_handler, "__esModule", { value: true });
	error_handler.ErrorHandler = void 0;
	var exceptions_public_1 = requireExceptions_public();
	var has_1 = __importDefault(requireHas());
	var clone_1 = __importDefault(requireClone());
	var lookahead_1 = requireLookahead();
	var parser_1 = requireParser();
	var ErrorHandler = (
	  /** @class */
	  (function() {
	    function ErrorHandler2() {
	    }
	    ErrorHandler2.prototype.initErrorHandler = function(config) {
	      this._errors = [];
	      this.errorMessageProvider = (0, has_1.default)(config, "errorMessageProvider") ? config.errorMessageProvider : parser_1.DEFAULT_PARSER_CONFIG.errorMessageProvider;
	    };
	    ErrorHandler2.prototype.SAVE_ERROR = function(error) {
	      if ((0, exceptions_public_1.isRecognitionException)(error)) {
	        error.context = {
	          ruleStack: this.getHumanReadableRuleStack(),
	          ruleOccurrenceStack: (0, clone_1.default)(this.RULE_OCCURRENCE_STACK)
	        };
	        this._errors.push(error);
	        return error;
	      } else {
	        throw Error("Trying to save an Error which is not a RecognitionException");
	      }
	    };
	    Object.defineProperty(ErrorHandler2.prototype, "errors", {
	      get: function() {
	        return (0, clone_1.default)(this._errors);
	      },
	      set: function(newErrors) {
	        this._errors = newErrors;
	      },
	      enumerable: false,
	      configurable: true
	    });
	    ErrorHandler2.prototype.raiseEarlyExitException = function(occurrence, prodType, userDefinedErrMsg) {
	      var ruleName = this.getCurrRuleFullName();
	      var ruleGrammar = this.getGAstProductions()[ruleName];
	      var lookAheadPathsPerAlternative = (0, lookahead_1.getLookaheadPathsForOptionalProd)(occurrence, ruleGrammar, prodType, this.maxLookahead);
	      var insideProdPaths = lookAheadPathsPerAlternative[0];
	      var actualTokens = [];
	      for (var i = 1; i <= this.maxLookahead; i++) {
	        actualTokens.push(this.LA(i));
	      }
	      var msg = this.errorMessageProvider.buildEarlyExitMessage({
	        expectedIterationPaths: insideProdPaths,
	        actual: actualTokens,
	        previous: this.LA(0),
	        customUserDescription: userDefinedErrMsg,
	        ruleName
	      });
	      throw this.SAVE_ERROR(new exceptions_public_1.EarlyExitException(msg, this.LA(1), this.LA(0)));
	    };
	    ErrorHandler2.prototype.raiseNoAltException = function(occurrence, errMsgTypes) {
	      var ruleName = this.getCurrRuleFullName();
	      var ruleGrammar = this.getGAstProductions()[ruleName];
	      var lookAheadPathsPerAlternative = (0, lookahead_1.getLookaheadPathsForOr)(occurrence, ruleGrammar, this.maxLookahead);
	      var actualTokens = [];
	      for (var i = 1; i <= this.maxLookahead; i++) {
	        actualTokens.push(this.LA(i));
	      }
	      var previousToken = this.LA(0);
	      var errMsg = this.errorMessageProvider.buildNoViableAltMessage({
	        expectedPathsPerAlt: lookAheadPathsPerAlternative,
	        actual: actualTokens,
	        previous: previousToken,
	        customUserDescription: errMsgTypes,
	        ruleName: this.getCurrRuleFullName()
	      });
	      throw this.SAVE_ERROR(new exceptions_public_1.NoViableAltException(errMsg, this.LA(1), previousToken));
	    };
	    return ErrorHandler2;
	  })()
	);
	error_handler.ErrorHandler = ErrorHandler;
	return error_handler;
}

var context_assist = {};

var hasRequiredContext_assist;

function requireContext_assist () {
	if (hasRequiredContext_assist) return context_assist;
	hasRequiredContext_assist = 1;
	var __importDefault = context_assist && context_assist.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(context_assist, "__esModule", { value: true });
	context_assist.ContentAssist = void 0;
	var interpreter_1 = requireInterpreter();
	var first_1 = __importDefault(requireFirst());
	var isUndefined_1 = __importDefault(requireIsUndefined());
	var ContentAssist = (
	  /** @class */
	  (function() {
	    function ContentAssist2() {
	    }
	    ContentAssist2.prototype.initContentAssist = function() {
	    };
	    ContentAssist2.prototype.computeContentAssist = function(startRuleName, precedingInput) {
	      var startRuleGast = this.gastProductionsCache[startRuleName];
	      if ((0, isUndefined_1.default)(startRuleGast)) {
	        throw Error("Rule ->".concat(startRuleName, "<- does not exist in this grammar."));
	      }
	      return (0, interpreter_1.nextPossibleTokensAfter)([startRuleGast], precedingInput, this.tokenMatcher, this.maxLookahead);
	    };
	    ContentAssist2.prototype.getNextPossibleTokenTypes = function(grammarPath) {
	      var topRuleName = (0, first_1.default)(grammarPath.ruleStack);
	      var gastProductions = this.getGAstProductions();
	      var topProduction = gastProductions[topRuleName];
	      var nextPossibleTokenTypes = new interpreter_1.NextAfterTokenWalker(topProduction, grammarPath).startWalking();
	      return nextPossibleTokenTypes;
	    };
	    return ContentAssist2;
	  })()
	);
	context_assist.ContentAssist = ContentAssist;
	return context_assist;
}

var gast_recorder = {};

var hasRequiredGast_recorder;

function requireGast_recorder () {
	if (hasRequiredGast_recorder) return gast_recorder;
	hasRequiredGast_recorder = 1;
	var __importDefault = gast_recorder && gast_recorder.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(gast_recorder, "__esModule", { value: true });
	gast_recorder.GastRecorder = void 0;
	var last_1 = __importDefault(requireLast());
	var isArray_1 = __importDefault(requireIsArray());
	var some_1 = __importDefault(requireSome());
	var forEach_1 = __importDefault(requireForEach());
	var isFunction_1 = __importDefault(requireIsFunction());
	var has_1 = __importDefault(requireHas());
	var gast_1 = requireApi$2();
	var lexer_public_1 = requireLexer_public();
	var tokens_1 = requireTokens();
	var tokens_public_1 = requireTokens_public();
	var parser_1 = requireParser();
	var keys_1 = requireKeys();
	var RECORDING_NULL_OBJECT = {
	  description: "This Object indicates the Parser is during Recording Phase"
	};
	Object.freeze(RECORDING_NULL_OBJECT);
	var HANDLE_SEPARATOR = true;
	var MAX_METHOD_IDX = Math.pow(2, keys_1.BITS_FOR_OCCURRENCE_IDX) - 1;
	var RFT = (0, tokens_public_1.createToken)({ name: "RECORDING_PHASE_TOKEN", pattern: lexer_public_1.Lexer.NA });
	(0, tokens_1.augmentTokenTypes)([RFT]);
	var RECORDING_PHASE_TOKEN = (0, tokens_public_1.createTokenInstance)(
	  RFT,
	  "This IToken indicates the Parser is in Recording Phase\n	See: https://chevrotain.io/docs/guide/internals.html#grammar-recording for details",
	  // Using "-1" instead of NaN (as in EOF) because an actual number is less likely to
	  // cause errors if the output of LA or CONSUME would be (incorrectly) used during the recording phase.
	  -1,
	  -1,
	  -1,
	  -1,
	  -1,
	  -1
	);
	Object.freeze(RECORDING_PHASE_TOKEN);
	var RECORDING_PHASE_CSTNODE = {
	  name: "This CSTNode indicates the Parser is in Recording Phase\n	See: https://chevrotain.io/docs/guide/internals.html#grammar-recording for details",
	  children: {}
	};
	var GastRecorder = (
	  /** @class */
	  (function() {
	    function GastRecorder2() {
	    }
	    GastRecorder2.prototype.initGastRecorder = function(config) {
	      this.recordingProdStack = [];
	      this.RECORDING_PHASE = false;
	    };
	    GastRecorder2.prototype.enableRecording = function() {
	      var _this = this;
	      this.RECORDING_PHASE = true;
	      this.TRACE_INIT("Enable Recording", function() {
	        var _loop_1 = function(i2) {
	          var idx = i2 > 0 ? i2 : "";
	          _this["CONSUME".concat(idx)] = function(arg1, arg2) {
	            return this.consumeInternalRecord(arg1, i2, arg2);
	          };
	          _this["SUBRULE".concat(idx)] = function(arg1, arg2) {
	            return this.subruleInternalRecord(arg1, i2, arg2);
	          };
	          _this["OPTION".concat(idx)] = function(arg1) {
	            return this.optionInternalRecord(arg1, i2);
	          };
	          _this["OR".concat(idx)] = function(arg1) {
	            return this.orInternalRecord(arg1, i2);
	          };
	          _this["MANY".concat(idx)] = function(arg1) {
	            this.manyInternalRecord(i2, arg1);
	          };
	          _this["MANY_SEP".concat(idx)] = function(arg1) {
	            this.manySepFirstInternalRecord(i2, arg1);
	          };
	          _this["AT_LEAST_ONE".concat(idx)] = function(arg1) {
	            this.atLeastOneInternalRecord(i2, arg1);
	          };
	          _this["AT_LEAST_ONE_SEP".concat(idx)] = function(arg1) {
	            this.atLeastOneSepFirstInternalRecord(i2, arg1);
	          };
	        };
	        for (var i = 0; i < 10; i++) {
	          _loop_1(i);
	        }
	        _this["consume"] = function(idx, arg1, arg2) {
	          return this.consumeInternalRecord(arg1, idx, arg2);
	        };
	        _this["subrule"] = function(idx, arg1, arg2) {
	          return this.subruleInternalRecord(arg1, idx, arg2);
	        };
	        _this["option"] = function(idx, arg1) {
	          return this.optionInternalRecord(arg1, idx);
	        };
	        _this["or"] = function(idx, arg1) {
	          return this.orInternalRecord(arg1, idx);
	        };
	        _this["many"] = function(idx, arg1) {
	          this.manyInternalRecord(idx, arg1);
	        };
	        _this["atLeastOne"] = function(idx, arg1) {
	          this.atLeastOneInternalRecord(idx, arg1);
	        };
	        _this.ACTION = _this.ACTION_RECORD;
	        _this.BACKTRACK = _this.BACKTRACK_RECORD;
	        _this.LA = _this.LA_RECORD;
	      });
	    };
	    GastRecorder2.prototype.disableRecording = function() {
	      var _this = this;
	      this.RECORDING_PHASE = false;
	      this.TRACE_INIT("Deleting Recording methods", function() {
	        var that = _this;
	        for (var i = 0; i < 10; i++) {
	          var idx = i > 0 ? i : "";
	          delete that["CONSUME".concat(idx)];
	          delete that["SUBRULE".concat(idx)];
	          delete that["OPTION".concat(idx)];
	          delete that["OR".concat(idx)];
	          delete that["MANY".concat(idx)];
	          delete that["MANY_SEP".concat(idx)];
	          delete that["AT_LEAST_ONE".concat(idx)];
	          delete that["AT_LEAST_ONE_SEP".concat(idx)];
	        }
	        delete that["consume"];
	        delete that["subrule"];
	        delete that["option"];
	        delete that["or"];
	        delete that["many"];
	        delete that["atLeastOne"];
	        delete that.ACTION;
	        delete that.BACKTRACK;
	        delete that.LA;
	      });
	    };
	    GastRecorder2.prototype.ACTION_RECORD = function(impl) {
	    };
	    GastRecorder2.prototype.BACKTRACK_RECORD = function(grammarRule, args) {
	      return function() {
	        return true;
	      };
	    };
	    GastRecorder2.prototype.LA_RECORD = function(howMuch) {
	      return parser_1.END_OF_FILE;
	    };
	    GastRecorder2.prototype.topLevelRuleRecord = function(name, def) {
	      try {
	        var newTopLevelRule = new gast_1.Rule({ definition: [], name });
	        newTopLevelRule.name = name;
	        this.recordingProdStack.push(newTopLevelRule);
	        def.call(this);
	        this.recordingProdStack.pop();
	        return newTopLevelRule;
	      } catch (originalError) {
	        if (originalError.KNOWN_RECORDER_ERROR !== true) {
	          try {
	            originalError.message = originalError.message + '\n	 This error was thrown during the "grammar recording phase" For more info see:\n	https://chevrotain.io/docs/guide/internals.html#grammar-recording';
	          } catch (mutabilityError) {
	            throw originalError;
	          }
	        }
	        throw originalError;
	      }
	    };
	    GastRecorder2.prototype.optionInternalRecord = function(actionORMethodDef, occurrence) {
	      return recordProd.call(this, gast_1.Option, actionORMethodDef, occurrence);
	    };
	    GastRecorder2.prototype.atLeastOneInternalRecord = function(occurrence, actionORMethodDef) {
	      recordProd.call(this, gast_1.RepetitionMandatory, actionORMethodDef, occurrence);
	    };
	    GastRecorder2.prototype.atLeastOneSepFirstInternalRecord = function(occurrence, options) {
	      recordProd.call(this, gast_1.RepetitionMandatoryWithSeparator, options, occurrence, HANDLE_SEPARATOR);
	    };
	    GastRecorder2.prototype.manyInternalRecord = function(occurrence, actionORMethodDef) {
	      recordProd.call(this, gast_1.Repetition, actionORMethodDef, occurrence);
	    };
	    GastRecorder2.prototype.manySepFirstInternalRecord = function(occurrence, options) {
	      recordProd.call(this, gast_1.RepetitionWithSeparator, options, occurrence, HANDLE_SEPARATOR);
	    };
	    GastRecorder2.prototype.orInternalRecord = function(altsOrOpts, occurrence) {
	      return recordOrProd.call(this, altsOrOpts, occurrence);
	    };
	    GastRecorder2.prototype.subruleInternalRecord = function(ruleToCall, occurrence, options) {
	      assertMethodIdxIsValid(occurrence);
	      if (!ruleToCall || (0, has_1.default)(ruleToCall, "ruleName") === false) {
	        var error = new Error("<SUBRULE".concat(getIdxSuffix(occurrence), "> argument is invalid") + " expecting a Parser method reference but got: <".concat(JSON.stringify(ruleToCall), ">") + "\n inside top level rule: <".concat(this.recordingProdStack[0].name, ">"));
	        error.KNOWN_RECORDER_ERROR = true;
	        throw error;
	      }
	      var prevProd = (0, last_1.default)(this.recordingProdStack);
	      var ruleName = ruleToCall.ruleName;
	      var newNoneTerminal = new gast_1.NonTerminal({
	        idx: occurrence,
	        nonTerminalName: ruleName,
	        label: options === null || options === void 0 ? void 0 : options.LABEL,
	        // The resolving of the `referencedRule` property will be done once all the Rule's GASTs have been created
	        referencedRule: void 0
	      });
	      prevProd.definition.push(newNoneTerminal);
	      return this.outputCst ? RECORDING_PHASE_CSTNODE : RECORDING_NULL_OBJECT;
	    };
	    GastRecorder2.prototype.consumeInternalRecord = function(tokType, occurrence, options) {
	      assertMethodIdxIsValid(occurrence);
	      if (!(0, tokens_1.hasShortKeyProperty)(tokType)) {
	        var error = new Error("<CONSUME".concat(getIdxSuffix(occurrence), "> argument is invalid") + " expecting a TokenType reference but got: <".concat(JSON.stringify(tokType), ">") + "\n inside top level rule: <".concat(this.recordingProdStack[0].name, ">"));
	        error.KNOWN_RECORDER_ERROR = true;
	        throw error;
	      }
	      var prevProd = (0, last_1.default)(this.recordingProdStack);
	      var newNoneTerminal = new gast_1.Terminal({
	        idx: occurrence,
	        terminalType: tokType,
	        label: options === null || options === void 0 ? void 0 : options.LABEL
	      });
	      prevProd.definition.push(newNoneTerminal);
	      return RECORDING_PHASE_TOKEN;
	    };
	    return GastRecorder2;
	  })()
	);
	gast_recorder.GastRecorder = GastRecorder;
	function recordProd(prodConstructor, mainProdArg, occurrence, handleSep) {
	  if (handleSep === void 0) {
	    handleSep = false;
	  }
	  assertMethodIdxIsValid(occurrence);
	  var prevProd = (0, last_1.default)(this.recordingProdStack);
	  var grammarAction = (0, isFunction_1.default)(mainProdArg) ? mainProdArg : mainProdArg.DEF;
	  var newProd = new prodConstructor({ definition: [], idx: occurrence });
	  if (handleSep) {
	    newProd.separator = mainProdArg.SEP;
	  }
	  if ((0, has_1.default)(mainProdArg, "MAX_LOOKAHEAD")) {
	    newProd.maxLookahead = mainProdArg.MAX_LOOKAHEAD;
	  }
	  this.recordingProdStack.push(newProd);
	  grammarAction.call(this);
	  prevProd.definition.push(newProd);
	  this.recordingProdStack.pop();
	  return RECORDING_NULL_OBJECT;
	}
	function recordOrProd(mainProdArg, occurrence) {
	  var _this = this;
	  assertMethodIdxIsValid(occurrence);
	  var prevProd = (0, last_1.default)(this.recordingProdStack);
	  var hasOptions = (0, isArray_1.default)(mainProdArg) === false;
	  var alts = hasOptions === false ? mainProdArg : mainProdArg.DEF;
	  var newOrProd = new gast_1.Alternation({
	    definition: [],
	    idx: occurrence,
	    ignoreAmbiguities: hasOptions && mainProdArg.IGNORE_AMBIGUITIES === true
	  });
	  if ((0, has_1.default)(mainProdArg, "MAX_LOOKAHEAD")) {
	    newOrProd.maxLookahead = mainProdArg.MAX_LOOKAHEAD;
	  }
	  var hasPredicates = (0, some_1.default)(alts, function(currAlt) {
	    return (0, isFunction_1.default)(currAlt.GATE);
	  });
	  newOrProd.hasPredicates = hasPredicates;
	  prevProd.definition.push(newOrProd);
	  (0, forEach_1.default)(alts, function(currAlt) {
	    var currAltFlat = new gast_1.Alternative({ definition: [] });
	    newOrProd.definition.push(currAltFlat);
	    if ((0, has_1.default)(currAlt, "IGNORE_AMBIGUITIES")) {
	      currAltFlat.ignoreAmbiguities = currAlt.IGNORE_AMBIGUITIES;
	    } else if ((0, has_1.default)(currAlt, "GATE")) {
	      currAltFlat.ignoreAmbiguities = true;
	    }
	    _this.recordingProdStack.push(currAltFlat);
	    currAlt.ALT.call(_this);
	    _this.recordingProdStack.pop();
	  });
	  return RECORDING_NULL_OBJECT;
	}
	function getIdxSuffix(idx) {
	  return idx === 0 ? "" : "".concat(idx);
	}
	function assertMethodIdxIsValid(idx) {
	  if (idx < 0 || idx > MAX_METHOD_IDX) {
	    var error = new Error(
	      // The stack trace will contain all the needed details
	      "Invalid DSL Method idx value: <".concat(idx, ">\n	") + "Idx value must be a none negative value smaller than ".concat(MAX_METHOD_IDX + 1)
	    );
	    error.KNOWN_RECORDER_ERROR = true;
	    throw error;
	  }
	}
	return gast_recorder;
}

var perf_tracer = {};

var hasRequiredPerf_tracer;

function requirePerf_tracer () {
	if (hasRequiredPerf_tracer) return perf_tracer;
	hasRequiredPerf_tracer = 1;
	var __importDefault = perf_tracer && perf_tracer.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(perf_tracer, "__esModule", { value: true });
	perf_tracer.PerformanceTracer = void 0;
	var has_1 = __importDefault(requireHas());
	var utils_1 = requireApi$3();
	var parser_1 = requireParser();
	var PerformanceTracer = (
	  /** @class */
	  (function() {
	    function PerformanceTracer2() {
	    }
	    PerformanceTracer2.prototype.initPerformanceTracer = function(config) {
	      if ((0, has_1.default)(config, "traceInitPerf")) {
	        var userTraceInitPerf = config.traceInitPerf;
	        var traceIsNumber = typeof userTraceInitPerf === "number";
	        this.traceInitMaxIdent = traceIsNumber ? userTraceInitPerf : Infinity;
	        this.traceInitPerf = traceIsNumber ? userTraceInitPerf > 0 : userTraceInitPerf;
	      } else {
	        this.traceInitMaxIdent = 0;
	        this.traceInitPerf = parser_1.DEFAULT_PARSER_CONFIG.traceInitPerf;
	      }
	      this.traceInitIndent = -1;
	    };
	    PerformanceTracer2.prototype.TRACE_INIT = function(phaseDesc, phaseImpl) {
	      if (this.traceInitPerf === true) {
	        this.traceInitIndent++;
	        var indent = new Array(this.traceInitIndent + 1).join("	");
	        if (this.traceInitIndent < this.traceInitMaxIdent) {
	          console.log("".concat(indent, "--> <").concat(phaseDesc, ">"));
	        }
	        var _a = (0, utils_1.timer)(phaseImpl), time = _a.time, value = _a.value;
	        var traceMethod = time > 10 ? console.warn : console.log;
	        if (this.traceInitIndent < this.traceInitMaxIdent) {
	          traceMethod("".concat(indent, "<-- <").concat(phaseDesc, "> time: ").concat(time, "ms"));
	        }
	        this.traceInitIndent--;
	        return value;
	      } else {
	        return phaseImpl();
	      }
	    };
	    return PerformanceTracer2;
	  })()
	);
	perf_tracer.PerformanceTracer = PerformanceTracer;
	return perf_tracer;
}

var apply_mixins = {};

var hasRequiredApply_mixins;

function requireApply_mixins () {
	if (hasRequiredApply_mixins) return apply_mixins;
	hasRequiredApply_mixins = 1;
	Object.defineProperty(apply_mixins, "__esModule", { value: true });
	apply_mixins.applyMixins = void 0;
	function applyMixins(derivedCtor, baseCtors) {
	  baseCtors.forEach(function(baseCtor) {
	    var baseProto = baseCtor.prototype;
	    Object.getOwnPropertyNames(baseProto).forEach(function(propName) {
	      if (propName === "constructor") {
	        return;
	      }
	      var basePropDescriptor = Object.getOwnPropertyDescriptor(baseProto, propName);
	      if (basePropDescriptor && (basePropDescriptor.get || basePropDescriptor.set)) {
	        Object.defineProperty(derivedCtor.prototype, propName, basePropDescriptor);
	      } else {
	        derivedCtor.prototype[propName] = baseCtor.prototype[propName];
	      }
	    });
	  });
	}
	apply_mixins.applyMixins = applyMixins;
	return apply_mixins;
}

var hasRequiredParser;

function requireParser () {
	if (hasRequiredParser) return parser;
	hasRequiredParser = 1;
	(function (exports$1) {
		var __extends = parser && parser.__extends || /* @__PURE__ */ (function() {
		  var extendStatics = function(d, b) {
		    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
		      d2.__proto__ = b2;
		    } || function(d2, b2) {
		      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
		    };
		    return extendStatics(d, b);
		  };
		  return function(d, b) {
		    if (typeof b !== "function" && b !== null)
		      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
		    extendStatics(d, b);
		    function __() {
		      this.constructor = d;
		    }
		    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
		  };
		})();
		var __importDefault = parser && parser.__importDefault || function(mod) {
		  return mod && mod.__esModule ? mod : { "default": mod };
		};
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.EmbeddedActionsParser = exports$1.CstParser = exports$1.Parser = exports$1.EMPTY_ALT = exports$1.ParserDefinitionErrorType = exports$1.DEFAULT_RULE_CONFIG = exports$1.DEFAULT_PARSER_CONFIG = exports$1.END_OF_FILE = void 0;
		var isEmpty_1 = __importDefault(requireIsEmpty());
		var map_1 = __importDefault(requireMap());
		var forEach_1 = __importDefault(requireForEach());
		var values_1 = __importDefault(requireValues());
		var has_1 = __importDefault(requireHas());
		var clone_1 = __importDefault(requireClone());
		var utils_1 = requireApi$3();
		var follow_1 = requireFollow();
		var tokens_public_1 = requireTokens_public();
		var errors_public_1 = requireErrors_public();
		var gast_resolver_public_1 = requireGast_resolver_public();
		var recoverable_1 = requireRecoverable();
		var looksahead_1 = requireLooksahead();
		var tree_builder_1 = requireTree_builder();
		var lexer_adapter_1 = requireLexer_adapter();
		var recognizer_api_1 = requireRecognizer_api();
		var recognizer_engine_1 = requireRecognizer_engine();
		var error_handler_1 = requireError_handler();
		var context_assist_1 = requireContext_assist();
		var gast_recorder_1 = requireGast_recorder();
		var perf_tracer_1 = requirePerf_tracer();
		var apply_mixins_1 = requireApply_mixins();
		var checks_1 = requireChecks();
		exports$1.END_OF_FILE = (0, tokens_public_1.createTokenInstance)(tokens_public_1.EOF, "", NaN, NaN, NaN, NaN, NaN, NaN);
		Object.freeze(exports$1.END_OF_FILE);
		exports$1.DEFAULT_PARSER_CONFIG = Object.freeze({
		  recoveryEnabled: false,
		  maxLookahead: 3,
		  dynamicTokensEnabled: false,
		  outputCst: true,
		  errorMessageProvider: errors_public_1.defaultParserErrorProvider,
		  nodeLocationTracking: "none",
		  traceInitPerf: false,
		  skipValidations: false
		});
		exports$1.DEFAULT_RULE_CONFIG = Object.freeze({
		  recoveryValueFunc: function() {
		    return void 0;
		  },
		  resyncEnabled: true
		});
		(function(ParserDefinitionErrorType2) {
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["INVALID_RULE_NAME"] = 0] = "INVALID_RULE_NAME";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["DUPLICATE_RULE_NAME"] = 1] = "DUPLICATE_RULE_NAME";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["INVALID_RULE_OVERRIDE"] = 2] = "INVALID_RULE_OVERRIDE";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["DUPLICATE_PRODUCTIONS"] = 3] = "DUPLICATE_PRODUCTIONS";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["UNRESOLVED_SUBRULE_REF"] = 4] = "UNRESOLVED_SUBRULE_REF";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["LEFT_RECURSION"] = 5] = "LEFT_RECURSION";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["NONE_LAST_EMPTY_ALT"] = 6] = "NONE_LAST_EMPTY_ALT";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["AMBIGUOUS_ALTS"] = 7] = "AMBIGUOUS_ALTS";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["CONFLICT_TOKENS_RULES_NAMESPACE"] = 8] = "CONFLICT_TOKENS_RULES_NAMESPACE";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["INVALID_TOKEN_NAME"] = 9] = "INVALID_TOKEN_NAME";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["NO_NON_EMPTY_LOOKAHEAD"] = 10] = "NO_NON_EMPTY_LOOKAHEAD";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["AMBIGUOUS_PREFIX_ALTS"] = 11] = "AMBIGUOUS_PREFIX_ALTS";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["TOO_MANY_ALTS"] = 12] = "TOO_MANY_ALTS";
		  ParserDefinitionErrorType2[ParserDefinitionErrorType2["CUSTOM_LOOKAHEAD_VALIDATION"] = 13] = "CUSTOM_LOOKAHEAD_VALIDATION";
		})(exports$1.ParserDefinitionErrorType || (exports$1.ParserDefinitionErrorType = {}));
		function EMPTY_ALT(value) {
		  if (value === void 0) {
		    value = void 0;
		  }
		  return function() {
		    return value;
		  };
		}
		exports$1.EMPTY_ALT = EMPTY_ALT;
		var Parser = (
		  /** @class */
		  (function() {
		    function Parser2(tokenVocabulary, config) {
		      this.definitionErrors = [];
		      this.selfAnalysisDone = false;
		      var that = this;
		      that.initErrorHandler(config);
		      that.initLexerAdapter();
		      that.initLooksAhead(config);
		      that.initRecognizerEngine(tokenVocabulary, config);
		      that.initRecoverable(config);
		      that.initTreeBuilder(config);
		      that.initContentAssist();
		      that.initGastRecorder(config);
		      that.initPerformanceTracer(config);
		      if ((0, has_1.default)(config, "ignoredIssues")) {
		        throw new Error("The <ignoredIssues> IParserConfig property has been deprecated.\n	Please use the <IGNORE_AMBIGUITIES> flag on the relevant DSL method instead.\n	See: https://chevrotain.io/docs/guide/resolving_grammar_errors.html#IGNORING_AMBIGUITIES\n	For further details.");
		      }
		      this.skipValidations = (0, has_1.default)(config, "skipValidations") ? config.skipValidations : exports$1.DEFAULT_PARSER_CONFIG.skipValidations;
		    }
		    Parser2.performSelfAnalysis = function(parserInstance) {
		      throw Error("The **static** `performSelfAnalysis` method has been deprecated.	\nUse the **instance** method with the same name instead.");
		    };
		    Parser2.prototype.performSelfAnalysis = function() {
		      var _this = this;
		      this.TRACE_INIT("performSelfAnalysis", function() {
		        var defErrorsMsgs;
		        _this.selfAnalysisDone = true;
		        var className = _this.className;
		        _this.TRACE_INIT("toFastProps", function() {
		          (0, utils_1.toFastProperties)(_this);
		        });
		        _this.TRACE_INIT("Grammar Recording", function() {
		          try {
		            _this.enableRecording();
		            (0, forEach_1.default)(_this.definedRulesNames, function(currRuleName) {
		              var wrappedRule = _this[currRuleName];
		              var originalGrammarAction = wrappedRule["originalGrammarAction"];
		              var recordedRuleGast;
		              _this.TRACE_INIT("".concat(currRuleName, " Rule"), function() {
		                recordedRuleGast = _this.topLevelRuleRecord(currRuleName, originalGrammarAction);
		              });
		              _this.gastProductionsCache[currRuleName] = recordedRuleGast;
		            });
		          } finally {
		            _this.disableRecording();
		          }
		        });
		        var resolverErrors = [];
		        _this.TRACE_INIT("Grammar Resolving", function() {
		          resolverErrors = (0, gast_resolver_public_1.resolveGrammar)({
		            rules: (0, values_1.default)(_this.gastProductionsCache)
		          });
		          _this.definitionErrors = _this.definitionErrors.concat(resolverErrors);
		        });
		        _this.TRACE_INIT("Grammar Validations", function() {
		          if ((0, isEmpty_1.default)(resolverErrors) && _this.skipValidations === false) {
		            var validationErrors = (0, gast_resolver_public_1.validateGrammar)({
		              rules: (0, values_1.default)(_this.gastProductionsCache),
		              tokenTypes: (0, values_1.default)(_this.tokensMap),
		              errMsgProvider: errors_public_1.defaultGrammarValidatorErrorProvider,
		              grammarName: className
		            });
		            var lookaheadValidationErrors = (0, checks_1.validateLookahead)({
		              lookaheadStrategy: _this.lookaheadStrategy,
		              rules: (0, values_1.default)(_this.gastProductionsCache),
		              tokenTypes: (0, values_1.default)(_this.tokensMap),
		              grammarName: className
		            });
		            _this.definitionErrors = _this.definitionErrors.concat(validationErrors, lookaheadValidationErrors);
		          }
		        });
		        if ((0, isEmpty_1.default)(_this.definitionErrors)) {
		          if (_this.recoveryEnabled) {
		            _this.TRACE_INIT("computeAllProdsFollows", function() {
		              var allFollows = (0, follow_1.computeAllProdsFollows)((0, values_1.default)(_this.gastProductionsCache));
		              _this.resyncFollows = allFollows;
		            });
		          }
		          _this.TRACE_INIT("ComputeLookaheadFunctions", function() {
		            var _a, _b;
		            (_b = (_a = _this.lookaheadStrategy).initialize) === null || _b === void 0 ? void 0 : _b.call(_a, {
		              rules: (0, values_1.default)(_this.gastProductionsCache)
		            });
		            _this.preComputeLookaheadFunctions((0, values_1.default)(_this.gastProductionsCache));
		          });
		        }
		        if (!Parser2.DEFER_DEFINITION_ERRORS_HANDLING && !(0, isEmpty_1.default)(_this.definitionErrors)) {
		          defErrorsMsgs = (0, map_1.default)(_this.definitionErrors, function(defError) {
		            return defError.message;
		          });
		          throw new Error("Parser Definition Errors detected:\n ".concat(defErrorsMsgs.join("\n-------------------------------\n")));
		        }
		      });
		    };
		    Parser2.DEFER_DEFINITION_ERRORS_HANDLING = false;
		    return Parser2;
		  })()
		);
		exports$1.Parser = Parser;
		(0, apply_mixins_1.applyMixins)(Parser, [
		  recoverable_1.Recoverable,
		  looksahead_1.LooksAhead,
		  tree_builder_1.TreeBuilder,
		  lexer_adapter_1.LexerAdapter,
		  recognizer_engine_1.RecognizerEngine,
		  recognizer_api_1.RecognizerApi,
		  error_handler_1.ErrorHandler,
		  context_assist_1.ContentAssist,
		  gast_recorder_1.GastRecorder,
		  perf_tracer_1.PerformanceTracer
		]);
		var CstParser = (
		  /** @class */
		  (function(_super) {
		    __extends(CstParser2, _super);
		    function CstParser2(tokenVocabulary, config) {
		      if (config === void 0) {
		        config = exports$1.DEFAULT_PARSER_CONFIG;
		      }
		      var configClone = (0, clone_1.default)(config);
		      configClone.outputCst = true;
		      return _super.call(this, tokenVocabulary, configClone) || this;
		    }
		    return CstParser2;
		  })(Parser)
		);
		exports$1.CstParser = CstParser;
		var EmbeddedActionsParser = (
		  /** @class */
		  (function(_super) {
		    __extends(EmbeddedActionsParser2, _super);
		    function EmbeddedActionsParser2(tokenVocabulary, config) {
		      if (config === void 0) {
		        config = exports$1.DEFAULT_PARSER_CONFIG;
		      }
		      var configClone = (0, clone_1.default)(config);
		      configClone.outputCst = false;
		      return _super.call(this, tokenVocabulary, configClone) || this;
		    }
		    return EmbeddedActionsParser2;
		  })(Parser)
		);
		exports$1.EmbeddedActionsParser = EmbeddedActionsParser; 
	} (parser));
	return parser;
}

var api = {};

var model = {};

var hasRequiredModel;

function requireModel () {
	if (hasRequiredModel) return model;
	hasRequiredModel = 1;
	var __extends = model && model.__extends || /* @__PURE__ */ (function() {
	  var extendStatics = function(d, b) {
	    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
	      d2.__proto__ = b2;
	    } || function(d2, b2) {
	      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
	    };
	    return extendStatics(d, b);
	  };
	  return function(d, b) {
	    if (typeof b !== "function" && b !== null)
	      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	    extendStatics(d, b);
	    function __() {
	      this.constructor = d;
	    }
	    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
	  };
	})();
	var __importDefault = model && model.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(model, "__esModule", { value: true });
	model.buildModel = void 0;
	var gast_1 = requireApi$2();
	var map_1 = __importDefault(requireMap());
	var flatten_1 = __importDefault(requireFlatten());
	var values_1 = __importDefault(requireValues());
	var some_1 = __importDefault(requireSome());
	var groupBy_1 = __importDefault(requireGroupBy());
	var assign_1 = __importDefault(requireAssign());
	function buildModel(productions) {
	  var generator = new CstNodeDefinitionGenerator();
	  var allRules = (0, values_1.default)(productions);
	  return (0, map_1.default)(allRules, function(rule) {
	    return generator.visitRule(rule);
	  });
	}
	model.buildModel = buildModel;
	var CstNodeDefinitionGenerator = (
	  /** @class */
	  (function(_super) {
	    __extends(CstNodeDefinitionGenerator2, _super);
	    function CstNodeDefinitionGenerator2() {
	      return _super !== null && _super.apply(this, arguments) || this;
	    }
	    CstNodeDefinitionGenerator2.prototype.visitRule = function(node) {
	      var rawElements = this.visitEach(node.definition);
	      var grouped = (0, groupBy_1.default)(rawElements, function(el) {
	        return el.propertyName;
	      });
	      var properties = (0, map_1.default)(grouped, function(group, propertyName) {
	        var allNullable = !(0, some_1.default)(group, function(el) {
	          return !el.canBeNull;
	        });
	        var propertyType = group[0].type;
	        if (group.length > 1) {
	          propertyType = (0, map_1.default)(group, function(g) {
	            return g.type;
	          });
	        }
	        return {
	          name: propertyName,
	          type: propertyType,
	          optional: allNullable
	        };
	      });
	      return {
	        name: node.name,
	        properties
	      };
	    };
	    CstNodeDefinitionGenerator2.prototype.visitAlternative = function(node) {
	      return this.visitEachAndOverrideWith(node.definition, { canBeNull: true });
	    };
	    CstNodeDefinitionGenerator2.prototype.visitOption = function(node) {
	      return this.visitEachAndOverrideWith(node.definition, { canBeNull: true });
	    };
	    CstNodeDefinitionGenerator2.prototype.visitRepetition = function(node) {
	      return this.visitEachAndOverrideWith(node.definition, { canBeNull: true });
	    };
	    CstNodeDefinitionGenerator2.prototype.visitRepetitionMandatory = function(node) {
	      return this.visitEach(node.definition);
	    };
	    CstNodeDefinitionGenerator2.prototype.visitRepetitionMandatoryWithSeparator = function(node) {
	      return this.visitEach(node.definition).concat({
	        propertyName: node.separator.name,
	        canBeNull: true,
	        type: getType(node.separator)
	      });
	    };
	    CstNodeDefinitionGenerator2.prototype.visitRepetitionWithSeparator = function(node) {
	      return this.visitEachAndOverrideWith(node.definition, {
	        canBeNull: true
	      }).concat({
	        propertyName: node.separator.name,
	        canBeNull: true,
	        type: getType(node.separator)
	      });
	    };
	    CstNodeDefinitionGenerator2.prototype.visitAlternation = function(node) {
	      return this.visitEachAndOverrideWith(node.definition, { canBeNull: true });
	    };
	    CstNodeDefinitionGenerator2.prototype.visitTerminal = function(node) {
	      return [
	        {
	          propertyName: node.label || node.terminalType.name,
	          canBeNull: false,
	          type: getType(node)
	        }
	      ];
	    };
	    CstNodeDefinitionGenerator2.prototype.visitNonTerminal = function(node) {
	      return [
	        {
	          propertyName: node.label || node.nonTerminalName,
	          canBeNull: false,
	          type: getType(node)
	        }
	      ];
	    };
	    CstNodeDefinitionGenerator2.prototype.visitEachAndOverrideWith = function(definition, override) {
	      return (0, map_1.default)(this.visitEach(definition), function(definition2) {
	        return (0, assign_1.default)({}, definition2, override);
	      });
	    };
	    CstNodeDefinitionGenerator2.prototype.visitEach = function(definition) {
	      var _this = this;
	      return (0, flatten_1.default)((0, map_1.default)(definition, function(definition2) {
	        return _this.visit(definition2);
	      }));
	    };
	    return CstNodeDefinitionGenerator2;
	  })(gast_1.GAstVisitor)
	);
	function getType(production) {
	  if (production instanceof gast_1.NonTerminal) {
	    return {
	      kind: "rule",
	      name: production.referencedRule.name
	    };
	  }
	  return { kind: "token" };
	}
	return model;
}

var generate$1 = {};

var _castSlice;
var hasRequired_castSlice;

function require_castSlice () {
	if (hasRequired_castSlice) return _castSlice;
	hasRequired_castSlice = 1;
	var baseSlice = require_baseSlice();
	function castSlice(array, start, end) {
	  var length = array.length;
	  end = end === void 0 ? length : end;
	  return !start && end >= length ? array : baseSlice(array, start, end);
	}
	_castSlice = castSlice;
	return _castSlice;
}

var _hasUnicode;
var hasRequired_hasUnicode;

function require_hasUnicode () {
	if (hasRequired_hasUnicode) return _hasUnicode;
	hasRequired_hasUnicode = 1;
	var rsAstralRange = "\\ud800-\\udfff", rsComboMarksRange = "\\u0300-\\u036f", reComboHalfMarksRange = "\\ufe20-\\ufe2f", rsComboSymbolsRange = "\\u20d0-\\u20ff", rsComboRange = rsComboMarksRange + reComboHalfMarksRange + rsComboSymbolsRange, rsVarRange = "\\ufe0e\\ufe0f";
	var rsZWJ = "\\u200d";
	var reHasUnicode = RegExp("[" + rsZWJ + rsAstralRange + rsComboRange + rsVarRange + "]");
	function hasUnicode(string) {
	  return reHasUnicode.test(string);
	}
	_hasUnicode = hasUnicode;
	return _hasUnicode;
}

var _asciiToArray;
var hasRequired_asciiToArray;

function require_asciiToArray () {
	if (hasRequired_asciiToArray) return _asciiToArray;
	hasRequired_asciiToArray = 1;
	function asciiToArray(string) {
	  return string.split("");
	}
	_asciiToArray = asciiToArray;
	return _asciiToArray;
}

var _unicodeToArray;
var hasRequired_unicodeToArray;

function require_unicodeToArray () {
	if (hasRequired_unicodeToArray) return _unicodeToArray;
	hasRequired_unicodeToArray = 1;
	var rsAstralRange = "\\ud800-\\udfff", rsComboMarksRange = "\\u0300-\\u036f", reComboHalfMarksRange = "\\ufe20-\\ufe2f", rsComboSymbolsRange = "\\u20d0-\\u20ff", rsComboRange = rsComboMarksRange + reComboHalfMarksRange + rsComboSymbolsRange, rsVarRange = "\\ufe0e\\ufe0f";
	var rsAstral = "[" + rsAstralRange + "]", rsCombo = "[" + rsComboRange + "]", rsFitz = "\\ud83c[\\udffb-\\udfff]", rsModifier = "(?:" + rsCombo + "|" + rsFitz + ")", rsNonAstral = "[^" + rsAstralRange + "]", rsRegional = "(?:\\ud83c[\\udde6-\\uddff]){2}", rsSurrPair = "[\\ud800-\\udbff][\\udc00-\\udfff]", rsZWJ = "\\u200d";
	var reOptMod = rsModifier + "?", rsOptVar = "[" + rsVarRange + "]?", rsOptJoin = "(?:" + rsZWJ + "(?:" + [rsNonAstral, rsRegional, rsSurrPair].join("|") + ")" + rsOptVar + reOptMod + ")*", rsSeq = rsOptVar + reOptMod + rsOptJoin, rsSymbol = "(?:" + [rsNonAstral + rsCombo + "?", rsCombo, rsRegional, rsSurrPair, rsAstral].join("|") + ")";
	var reUnicode = RegExp(rsFitz + "(?=" + rsFitz + ")|" + rsSymbol + rsSeq, "g");
	function unicodeToArray(string) {
	  return string.match(reUnicode) || [];
	}
	_unicodeToArray = unicodeToArray;
	return _unicodeToArray;
}

var _stringToArray;
var hasRequired_stringToArray;

function require_stringToArray () {
	if (hasRequired_stringToArray) return _stringToArray;
	hasRequired_stringToArray = 1;
	var asciiToArray = require_asciiToArray(), hasUnicode = require_hasUnicode(), unicodeToArray = require_unicodeToArray();
	function stringToArray(string) {
	  return hasUnicode(string) ? unicodeToArray(string) : asciiToArray(string);
	}
	_stringToArray = stringToArray;
	return _stringToArray;
}

var _createCaseFirst;
var hasRequired_createCaseFirst;

function require_createCaseFirst () {
	if (hasRequired_createCaseFirst) return _createCaseFirst;
	hasRequired_createCaseFirst = 1;
	var castSlice = require_castSlice(), hasUnicode = require_hasUnicode(), stringToArray = require_stringToArray(), toString = requireToString();
	function createCaseFirst(methodName) {
	  return function(string) {
	    string = toString(string);
	    var strSymbols = hasUnicode(string) ? stringToArray(string) : void 0;
	    var chr = strSymbols ? strSymbols[0] : string.charAt(0);
	    var trailing = strSymbols ? castSlice(strSymbols, 1).join("") : string.slice(1);
	    return chr[methodName]() + trailing;
	  };
	}
	_createCaseFirst = createCaseFirst;
	return _createCaseFirst;
}

var upperFirst_1;
var hasRequiredUpperFirst;

function requireUpperFirst () {
	if (hasRequiredUpperFirst) return upperFirst_1;
	hasRequiredUpperFirst = 1;
	var createCaseFirst = require_createCaseFirst();
	var upperFirst = createCaseFirst("toUpperCase");
	upperFirst_1 = upperFirst;
	return upperFirst_1;
}

var hasRequiredGenerate;

function requireGenerate () {
	if (hasRequiredGenerate) return generate$1;
	hasRequiredGenerate = 1;
	var __importDefault = generate$1 && generate$1.__importDefault || function(mod) {
	  return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(generate$1, "__esModule", { value: true });
	generate$1.genDts = void 0;
	var flatten_1 = __importDefault(requireFlatten());
	var isArray_1 = __importDefault(requireIsArray());
	var map_1 = __importDefault(requireMap());
	var reduce_1 = __importDefault(requireReduce());
	var uniq_1 = __importDefault(requireUniq());
	var upperFirst_1 = __importDefault(requireUpperFirst());
	function genDts(model, options) {
	  var contentParts = [];
	  contentParts = contentParts.concat('import type { CstNode, ICstVisitor, IToken } from "chevrotain";');
	  contentParts = contentParts.concat((0, flatten_1.default)((0, map_1.default)(model, function(node) {
	    return genCstNodeTypes(node);
	  })));
	  if (options.includeVisitorInterface) {
	    contentParts = contentParts.concat(genVisitor(options.visitorInterfaceName, model));
	  }
	  return contentParts.join("\n\n") + "\n";
	}
	generate$1.genDts = genDts;
	function genCstNodeTypes(node) {
	  var nodeCstInterface = genNodeInterface(node);
	  var nodeChildrenInterface = genNodeChildrenType(node);
	  return [nodeCstInterface, nodeChildrenInterface];
	}
	function genNodeInterface(node) {
	  var nodeInterfaceName = getNodeInterfaceName(node.name);
	  var childrenTypeName = getNodeChildrenTypeName(node.name);
	  return "export interface ".concat(nodeInterfaceName, ' extends CstNode {\n  name: "').concat(node.name, '";\n  children: ').concat(childrenTypeName, ";\n}");
	}
	function genNodeChildrenType(node) {
	  var typeName = getNodeChildrenTypeName(node.name);
	  return "export type ".concat(typeName, " = {\n  ").concat((0, map_1.default)(node.properties, function(property) {
	    return genChildProperty(property);
	  }).join("\n  "), "\n};");
	}
	function genChildProperty(prop) {
	  var typeName = buildTypeString(prop.type);
	  return "".concat(prop.name).concat(prop.optional ? "?" : "", ": ").concat(typeName, "[];");
	}
	function genVisitor(name, nodes) {
	  return "export interface ".concat(name, "<IN, OUT> extends ICstVisitor<IN, OUT> {\n  ").concat((0, map_1.default)(nodes, function(node) {
	    return genVisitorFunction(node);
	  }).join("\n  "), "\n}");
	}
	function genVisitorFunction(node) {
	  var childrenTypeName = getNodeChildrenTypeName(node.name);
	  return "".concat(node.name, "(children: ").concat(childrenTypeName, ", param?: IN): OUT;");
	}
	function buildTypeString(type) {
	  if ((0, isArray_1.default)(type)) {
	    var typeNames = (0, uniq_1.default)((0, map_1.default)(type, function(t) {
	      return getTypeString(t);
	    }));
	    var typeString = (0, reduce_1.default)(typeNames, function(sum, t) {
	      return sum + " | " + t;
	    });
	    return "(" + typeString + ")";
	  } else {
	    return getTypeString(type);
	  }
	}
	function getTypeString(type) {
	  if (type.kind === "token") {
	    return "IToken";
	  }
	  return getNodeInterfaceName(type.name);
	}
	function getNodeInterfaceName(ruleName) {
	  return (0, upperFirst_1.default)(ruleName) + "CstNode";
	}
	function getNodeChildrenTypeName(ruleName) {
	  return (0, upperFirst_1.default)(ruleName) + "CstChildren";
	}
	return generate$1;
}

var hasRequiredApi$1;

function requireApi$1 () {
	if (hasRequiredApi$1) return api;
	hasRequiredApi$1 = 1;
	var __assign = api && api.__assign || function() {
	  __assign = Object.assign || function(t) {
	    for (var s, i = 1, n = arguments.length; i < n; i++) {
	      s = arguments[i];
	      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
	        t[p] = s[p];
	    }
	    return t;
	  };
	  return __assign.apply(this, arguments);
	};
	Object.defineProperty(api, "__esModule", { value: true });
	api.generateCstDts = void 0;
	var model_1 = requireModel();
	var generate_1 = requireGenerate();
	var defaultOptions = {
	  includeVisitorInterface: true,
	  visitorInterfaceName: "ICstNodeVisitor"
	};
	function generateCstDts(productions, options) {
	  var effectiveOptions = __assign(__assign({}, defaultOptions), options);
	  var model = (0, model_1.buildModel)(productions);
	  return (0, generate_1.genDts)(model, effectiveOptions);
	}
	api.generateCstDts = generateCstDts;
	return api;
}

var render_public = {};

var hasRequiredRender_public;

function requireRender_public () {
	if (hasRequiredRender_public) return render_public;
	hasRequiredRender_public = 1;
	Object.defineProperty(render_public, "__esModule", { value: true });
	render_public.createSyntaxDiagramsCode = void 0;
	var version_1 = requireVersion();
	function createSyntaxDiagramsCode(grammar, _a) {
	  var _b = _a === void 0 ? {} : _a, _c = _b.resourceBase, resourceBase = _c === void 0 ? "https://unpkg.com/chevrotain@".concat(version_1.VERSION, "/diagrams/") : _c, _d = _b.css, css = _d === void 0 ? "https://unpkg.com/chevrotain@".concat(version_1.VERSION, "/diagrams/diagrams.css") : _d;
	  var header = '\n<!-- This is a generated file -->\n<!DOCTYPE html>\n<meta charset="utf-8">\n<style>\n  body {\n    background-color: hsl(30, 20%, 95%)\n  }\n</style>\n\n';
	  var cssHtml = "\n<link rel='stylesheet' href='".concat(css, "'>\n");
	  var scripts = "\n<script src='".concat(resourceBase, "vendor/railroad-diagrams.js'><\/script>\n<script src='").concat(resourceBase, "src/diagrams_builder.js'><\/script>\n<script src='").concat(resourceBase, "src/diagrams_behavior.js'><\/script>\n<script src='").concat(resourceBase, "src/main.js'><\/script>\n");
	  var diagramsDiv = '\n<div id="diagrams" align="center"></div>    \n';
	  var serializedGrammar = "\n<script>\n    window.serializedGrammar = ".concat(JSON.stringify(grammar, null, "  "), ";\n<\/script>\n");
	  var initLogic = '\n<script>\n    var diagramsDiv = document.getElementById("diagrams");\n    main.drawDiagramsFromSerializedGrammar(serializedGrammar, diagramsDiv);\n<\/script>\n';
	  return header + cssHtml + scripts + diagramsDiv + serializedGrammar + initLogic;
	}
	render_public.createSyntaxDiagramsCode = createSyntaxDiagramsCode;
	return render_public;
}

var hasRequiredApi;

function requireApi () {
	if (hasRequiredApi) return api$3;
	hasRequiredApi = 1;
	(function (exports$1) {
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.Parser = exports$1.createSyntaxDiagramsCode = exports$1.clearCache = exports$1.generateCstDts = exports$1.GAstVisitor = exports$1.serializeProduction = exports$1.serializeGrammar = exports$1.Terminal = exports$1.Rule = exports$1.RepetitionWithSeparator = exports$1.RepetitionMandatoryWithSeparator = exports$1.RepetitionMandatory = exports$1.Repetition = exports$1.Option = exports$1.NonTerminal = exports$1.Alternative = exports$1.Alternation = exports$1.defaultLexerErrorProvider = exports$1.NoViableAltException = exports$1.NotAllInputParsedException = exports$1.MismatchedTokenException = exports$1.isRecognitionException = exports$1.EarlyExitException = exports$1.defaultParserErrorProvider = exports$1.LLkLookaheadStrategy = exports$1.getLookaheadPaths = exports$1.tokenName = exports$1.tokenMatcher = exports$1.tokenLabel = exports$1.EOF = exports$1.createTokenInstance = exports$1.createToken = exports$1.LexerDefinitionErrorType = exports$1.Lexer = exports$1.EMPTY_ALT = exports$1.ParserDefinitionErrorType = exports$1.EmbeddedActionsParser = exports$1.CstParser = exports$1.VERSION = void 0;
		var version_1 = requireVersion();
		Object.defineProperty(exports$1, "VERSION", { enumerable: true, get: function() {
		  return version_1.VERSION;
		} });
		var parser_1 = requireParser();
		Object.defineProperty(exports$1, "CstParser", { enumerable: true, get: function() {
		  return parser_1.CstParser;
		} });
		Object.defineProperty(exports$1, "EmbeddedActionsParser", { enumerable: true, get: function() {
		  return parser_1.EmbeddedActionsParser;
		} });
		Object.defineProperty(exports$1, "ParserDefinitionErrorType", { enumerable: true, get: function() {
		  return parser_1.ParserDefinitionErrorType;
		} });
		Object.defineProperty(exports$1, "EMPTY_ALT", { enumerable: true, get: function() {
		  return parser_1.EMPTY_ALT;
		} });
		var lexer_public_1 = requireLexer_public();
		Object.defineProperty(exports$1, "Lexer", { enumerable: true, get: function() {
		  return lexer_public_1.Lexer;
		} });
		Object.defineProperty(exports$1, "LexerDefinitionErrorType", { enumerable: true, get: function() {
		  return lexer_public_1.LexerDefinitionErrorType;
		} });
		var tokens_public_1 = requireTokens_public();
		Object.defineProperty(exports$1, "createToken", { enumerable: true, get: function() {
		  return tokens_public_1.createToken;
		} });
		Object.defineProperty(exports$1, "createTokenInstance", { enumerable: true, get: function() {
		  return tokens_public_1.createTokenInstance;
		} });
		Object.defineProperty(exports$1, "EOF", { enumerable: true, get: function() {
		  return tokens_public_1.EOF;
		} });
		Object.defineProperty(exports$1, "tokenLabel", { enumerable: true, get: function() {
		  return tokens_public_1.tokenLabel;
		} });
		Object.defineProperty(exports$1, "tokenMatcher", { enumerable: true, get: function() {
		  return tokens_public_1.tokenMatcher;
		} });
		Object.defineProperty(exports$1, "tokenName", { enumerable: true, get: function() {
		  return tokens_public_1.tokenName;
		} });
		var lookahead_1 = requireLookahead();
		Object.defineProperty(exports$1, "getLookaheadPaths", { enumerable: true, get: function() {
		  return lookahead_1.getLookaheadPaths;
		} });
		var llk_lookahead_1 = requireLlk_lookahead();
		Object.defineProperty(exports$1, "LLkLookaheadStrategy", { enumerable: true, get: function() {
		  return llk_lookahead_1.LLkLookaheadStrategy;
		} });
		var errors_public_1 = requireErrors_public();
		Object.defineProperty(exports$1, "defaultParserErrorProvider", { enumerable: true, get: function() {
		  return errors_public_1.defaultParserErrorProvider;
		} });
		var exceptions_public_1 = requireExceptions_public();
		Object.defineProperty(exports$1, "EarlyExitException", { enumerable: true, get: function() {
		  return exceptions_public_1.EarlyExitException;
		} });
		Object.defineProperty(exports$1, "isRecognitionException", { enumerable: true, get: function() {
		  return exceptions_public_1.isRecognitionException;
		} });
		Object.defineProperty(exports$1, "MismatchedTokenException", { enumerable: true, get: function() {
		  return exceptions_public_1.MismatchedTokenException;
		} });
		Object.defineProperty(exports$1, "NotAllInputParsedException", { enumerable: true, get: function() {
		  return exceptions_public_1.NotAllInputParsedException;
		} });
		Object.defineProperty(exports$1, "NoViableAltException", { enumerable: true, get: function() {
		  return exceptions_public_1.NoViableAltException;
		} });
		var lexer_errors_public_1 = requireLexer_errors_public();
		Object.defineProperty(exports$1, "defaultLexerErrorProvider", { enumerable: true, get: function() {
		  return lexer_errors_public_1.defaultLexerErrorProvider;
		} });
		var gast_1 = requireApi$2();
		Object.defineProperty(exports$1, "Alternation", { enumerable: true, get: function() {
		  return gast_1.Alternation;
		} });
		Object.defineProperty(exports$1, "Alternative", { enumerable: true, get: function() {
		  return gast_1.Alternative;
		} });
		Object.defineProperty(exports$1, "NonTerminal", { enumerable: true, get: function() {
		  return gast_1.NonTerminal;
		} });
		Object.defineProperty(exports$1, "Option", { enumerable: true, get: function() {
		  return gast_1.Option;
		} });
		Object.defineProperty(exports$1, "Repetition", { enumerable: true, get: function() {
		  return gast_1.Repetition;
		} });
		Object.defineProperty(exports$1, "RepetitionMandatory", { enumerable: true, get: function() {
		  return gast_1.RepetitionMandatory;
		} });
		Object.defineProperty(exports$1, "RepetitionMandatoryWithSeparator", { enumerable: true, get: function() {
		  return gast_1.RepetitionMandatoryWithSeparator;
		} });
		Object.defineProperty(exports$1, "RepetitionWithSeparator", { enumerable: true, get: function() {
		  return gast_1.RepetitionWithSeparator;
		} });
		Object.defineProperty(exports$1, "Rule", { enumerable: true, get: function() {
		  return gast_1.Rule;
		} });
		Object.defineProperty(exports$1, "Terminal", { enumerable: true, get: function() {
		  return gast_1.Terminal;
		} });
		var gast_2 = requireApi$2();
		Object.defineProperty(exports$1, "serializeGrammar", { enumerable: true, get: function() {
		  return gast_2.serializeGrammar;
		} });
		Object.defineProperty(exports$1, "serializeProduction", { enumerable: true, get: function() {
		  return gast_2.serializeProduction;
		} });
		Object.defineProperty(exports$1, "GAstVisitor", { enumerable: true, get: function() {
		  return gast_2.GAstVisitor;
		} });
		var cst_dts_gen_1 = requireApi$1();
		Object.defineProperty(exports$1, "generateCstDts", { enumerable: true, get: function() {
		  return cst_dts_gen_1.generateCstDts;
		} });
		function clearCache() {
		  console.warn("The clearCache function was 'soft' removed from the Chevrotain API.\n	 It performs no action other than printing this message.\n	 Please avoid using it as it will be completely removed in the future");
		}
		exports$1.clearCache = clearCache;
		var render_public_1 = requireRender_public();
		Object.defineProperty(exports$1, "createSyntaxDiagramsCode", { enumerable: true, get: function() {
		  return render_public_1.createSyntaxDiagramsCode;
		} });
		var Parser = (
		  /** @class */
		  /* @__PURE__ */ (function() {
		    function Parser2() {
		      throw new Error("The Parser class has been deprecated, use CstParser or EmbeddedActionsParser instead.	\nSee: https://chevrotain.io/docs/changes/BREAKING_CHANGES.html#_7-0-0");
		    }
		    return Parser2;
		  })()
		);
		exports$1.Parser = Parser; 
	} (api$3));
	return api$3;
}

var apiExports = requireApi();
var mod = /*@__PURE__*/getDefaultExportFromCjs(apiExports);

mod.Alternation;
mod.Alternative;
const CstParser = mod.CstParser;
mod.EMPTY_ALT;
mod.EOF;
mod.EarlyExitException;
mod.EmbeddedActionsParser;
mod.GAstVisitor;
mod.LLkLookaheadStrategy;
const Lexer = mod.Lexer;
mod.LexerDefinitionErrorType;
mod.MismatchedTokenException;
mod.NoViableAltException;
mod.NonTerminal;
mod.NotAllInputParsedException;
mod.Option;
mod.Parser;
mod.ParserDefinitionErrorType;
mod.Repetition;
mod.RepetitionMandatory;
mod.RepetitionMandatoryWithSeparator;
mod.RepetitionWithSeparator;
mod.Rule;
mod.Terminal;
mod.VERSION;
mod.clearCache;
mod.createSyntaxDiagramsCode;
const createToken = mod.createToken;
mod.createTokenInstance;
mod.defaultLexerErrorProvider;
mod.defaultParserErrorProvider;
mod.generateCstDts;
mod.getLookaheadPaths;
mod.isRecognitionException;
mod.serializeGrammar;
mod.serializeProduction;
mod.tokenLabel;
mod.tokenMatcher;
mod.tokenName;

var dist = {};

var hasRequiredDist;

function requireDist () {
	if (hasRequiredDist) return dist;
	hasRequiredDist = 1;
	(function (exports$1) {
		Object.defineProperty(exports$1, "__esModule", { value: true });
		exports$1.lilconfigSync = exports$1.lilconfig = exports$1.defaultLoaders = void 0;
		const path = require$$0;
		const fs = require$$1;
		const os = require$$2;
		const fsReadFileAsync = fs.promises.readFile;
		function getDefaultSearchPlaces(name) {
		  return [
		    "package.json",
		    `.${name}rc.json`,
		    `.${name}rc.js`,
		    `.${name}rc.cjs`,
		    `.config/${name}rc`,
		    `.config/${name}rc.json`,
		    `.config/${name}rc.js`,
		    `.config/${name}rc.cjs`,
		    `${name}.config.js`,
		    `${name}.config.cjs`
		  ];
		}
		function getSearchPaths(startDir, stopDir) {
		  return startDir.split(path.sep).reduceRight((acc, _, ind, arr) => {
		    const currentPath = arr.slice(0, ind + 1).join(path.sep);
		    if (!acc.passedStopDir)
		      acc.searchPlaces.push(currentPath || path.sep);
		    if (currentPath === stopDir)
		      acc.passedStopDir = true;
		    return acc;
		  }, { searchPlaces: [], passedStopDir: false }).searchPlaces;
		}
		exports$1.defaultLoaders = Object.freeze({
		  ".js": require,
		  ".json": require,
		  ".cjs": require,
		  noExt(_, content) {
		    return JSON.parse(content);
		  }
		});
		function getExtDesc(ext) {
		  return ext === "noExt" ? "files without extensions" : `extension "${ext}"`;
		}
		function getOptions(name, options = {}) {
		  const conf = {
		    stopDir: os.homedir(),
		    searchPlaces: getDefaultSearchPlaces(name),
		    ignoreEmptySearchPlaces: true,
		    transform: (x) => x,
		    packageProp: [name],
		    ...options,
		    loaders: { ...exports$1.defaultLoaders, ...options.loaders }
		  };
		  conf.searchPlaces.forEach((place) => {
		    const key = path.extname(place) || "noExt";
		    const loader = conf.loaders[key];
		    if (!loader) {
		      throw new Error(`No loader specified for ${getExtDesc(key)}, so searchPlaces item "${place}" is invalid`);
		    }
		    if (typeof loader !== "function") {
		      throw new Error(`loader for ${getExtDesc(key)} is not a function (type provided: "${typeof loader}"), so searchPlaces item "${place}" is invalid`);
		    }
		  });
		  return conf;
		}
		function getPackageProp(props, obj) {
		  if (typeof props === "string" && props in obj)
		    return obj[props];
		  return (Array.isArray(props) ? props : props.split(".")).reduce((acc, prop) => acc === void 0 ? acc : acc[prop], obj) || null;
		}
		function getSearchItems(searchPlaces, searchPaths) {
		  return searchPaths.reduce((acc, searchPath) => {
		    searchPlaces.forEach((sp) => acc.push({
		      searchPlace: sp,
		      filepath: path.join(searchPath, sp),
		      loaderKey: path.extname(sp) || "noExt"
		    }));
		    return acc;
		  }, []);
		}
		function validateFilePath(filepath) {
		  if (!filepath)
		    throw new Error("load must pass a non-empty string");
		}
		function validateLoader(loader, ext) {
		  if (!loader)
		    throw new Error(`No loader specified for extension "${ext}"`);
		  if (typeof loader !== "function")
		    throw new Error("loader is not a function");
		}
		function lilconfig(name, options) {
		  const { ignoreEmptySearchPlaces, loaders, packageProp, searchPlaces, stopDir, transform } = getOptions(name, options);
		  return {
		    async search(searchFrom = process.cwd()) {
		      const searchPaths = getSearchPaths(searchFrom, stopDir);
		      const result = {
		        config: null,
		        filepath: ""
		      };
		      const searchItems = getSearchItems(searchPlaces, searchPaths);
		      for (const { searchPlace, filepath, loaderKey } of searchItems) {
		        try {
		          await fs.promises.access(filepath);
		        } catch (_a) {
		          continue;
		        }
		        const content = String(await fsReadFileAsync(filepath));
		        const loader = loaders[loaderKey];
		        if (searchPlace === "package.json") {
		          const pkg = await loader(filepath, content);
		          const maybeConfig = getPackageProp(packageProp, pkg);
		          if (maybeConfig != null) {
		            result.config = maybeConfig;
		            result.filepath = filepath;
		            break;
		          }
		          continue;
		        }
		        const isEmpty = content.trim() === "";
		        if (isEmpty && ignoreEmptySearchPlaces)
		          continue;
		        if (isEmpty) {
		          result.isEmpty = true;
		          result.config = void 0;
		        } else {
		          validateLoader(loader, loaderKey);
		          result.config = await loader(filepath, content);
		        }
		        result.filepath = filepath;
		        break;
		      }
		      if (result.filepath === "" && result.config === null)
		        return transform(null);
		      return transform(result);
		    },
		    async load(filepath) {
		      validateFilePath(filepath);
		      const absPath = path.resolve(process.cwd(), filepath);
		      const { base, ext } = path.parse(absPath);
		      const loaderKey = ext || "noExt";
		      const loader = loaders[loaderKey];
		      validateLoader(loader, loaderKey);
		      const content = String(await fsReadFileAsync(absPath));
		      if (base === "package.json") {
		        const pkg = await loader(absPath, content);
		        return transform({
		          config: getPackageProp(packageProp, pkg),
		          filepath: absPath
		        });
		      }
		      const result = {
		        config: null,
		        filepath: absPath
		      };
		      const isEmpty = content.trim() === "";
		      if (isEmpty && ignoreEmptySearchPlaces)
		        return transform({
		          config: void 0,
		          filepath: absPath,
		          isEmpty: true
		        });
		      result.config = isEmpty ? void 0 : await loader(absPath, content);
		      return transform(isEmpty ? { ...result, isEmpty, config: void 0 } : result);
		    }
		  };
		}
		exports$1.lilconfig = lilconfig;
		function lilconfigSync(name, options) {
		  const { ignoreEmptySearchPlaces, loaders, packageProp, searchPlaces, stopDir, transform } = getOptions(name, options);
		  return {
		    search(searchFrom = process.cwd()) {
		      const searchPaths = getSearchPaths(searchFrom, stopDir);
		      const result = {
		        config: null,
		        filepath: ""
		      };
		      const searchItems = getSearchItems(searchPlaces, searchPaths);
		      for (const { searchPlace, filepath, loaderKey } of searchItems) {
		        try {
		          fs.accessSync(filepath);
		        } catch (_a) {
		          continue;
		        }
		        const loader = loaders[loaderKey];
		        const content = String(fs.readFileSync(filepath));
		        if (searchPlace === "package.json") {
		          const pkg = loader(filepath, content);
		          const maybeConfig = getPackageProp(packageProp, pkg);
		          if (maybeConfig != null) {
		            result.config = maybeConfig;
		            result.filepath = filepath;
		            break;
		          }
		          continue;
		        }
		        const isEmpty = content.trim() === "";
		        if (isEmpty && ignoreEmptySearchPlaces)
		          continue;
		        if (isEmpty) {
		          result.isEmpty = true;
		          result.config = void 0;
		        } else {
		          validateLoader(loader, loaderKey);
		          result.config = loader(filepath, content);
		        }
		        result.filepath = filepath;
		        break;
		      }
		      if (result.filepath === "" && result.config === null)
		        return transform(null);
		      return transform(result);
		    },
		    load(filepath) {
		      validateFilePath(filepath);
		      const absPath = path.resolve(process.cwd(), filepath);
		      const { base, ext } = path.parse(absPath);
		      const loaderKey = ext || "noExt";
		      const loader = loaders[loaderKey];
		      validateLoader(loader, loaderKey);
		      const content = String(fs.readFileSync(absPath));
		      if (base === "package.json") {
		        const pkg = loader(absPath, content);
		        return transform({
		          config: getPackageProp(packageProp, pkg),
		          filepath: absPath
		        });
		      }
		      const result = {
		        config: null,
		        filepath: absPath
		      };
		      const isEmpty = content.trim() === "";
		      if (isEmpty && ignoreEmptySearchPlaces)
		        return transform({
		          filepath: absPath,
		          config: void 0,
		          isEmpty: true
		        });
		      result.config = isEmpty ? void 0 : loader(absPath, content);
		      return transform(isEmpty ? { ...result, isEmpty, config: void 0 } : result);
		    }
		  };
		}
		exports$1.lilconfigSync = lilconfigSync; 
	} (dist));
	return dist;
}

var distExports = requireDist();

function _inheritsLoose(subClass, superClass) {
  subClass.prototype = Object.create(superClass.prototype);
  subClass.prototype.constructor = subClass;
  _setPrototypeOf(subClass, superClass);
}
function _setPrototypeOf(o, p) {
  _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf2(o2, p2) {
    o2.__proto__ = p2;
    return o2;
  };
  return _setPrototypeOf(o, p);
}
function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;
  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }
  return target;
}
var Identifier = /* @__PURE__ */ createToken({
  name: "Identifier",
  pattern: /[a-zA-Z][\w-]*/
});
var Datasource = /* @__PURE__ */ createToken({
  name: "Datasource",
  pattern: /datasource/,
  push_mode: "block"
});
var Generator = /* @__PURE__ */ createToken({
  name: "Generator",
  pattern: /generator/,
  push_mode: "block"
});
var Model = /* @__PURE__ */ createToken({
  name: "Model",
  pattern: /model/,
  push_mode: "block"
});
var View = /* @__PURE__ */ createToken({
  name: "View",
  pattern: /view/,
  push_mode: "block"
});
var Enum = /* @__PURE__ */ createToken({
  name: "Enum",
  pattern: /enum/,
  push_mode: "block"
});
var Type = /* @__PURE__ */ createToken({
  name: "Type",
  pattern: /type/,
  push_mode: "block"
});
var True = /* @__PURE__ */ createToken({
  name: "True",
  pattern: /true/,
  longer_alt: Identifier
});
var False = /* @__PURE__ */ createToken({
  name: "False",
  pattern: /false/,
  longer_alt: Identifier
});
var Null = /* @__PURE__ */ createToken({
  name: "Null",
  pattern: /null/,
  longer_alt: Identifier
});
var Comment = /* @__PURE__ */ createToken({
  name: "Comment",
  pattern: Lexer.NA
});
var DocComment = /* @__PURE__ */ createToken({
  name: "DocComment",
  pattern: /\/\/\/[ \t]*(.*)/,
  categories: [Comment]
});
var LineComment = /* @__PURE__ */ createToken({
  name: "LineComment",
  pattern: /\/\/[ \t]*(.*)/,
  categories: [Comment]
});
var Attribute = /* @__PURE__ */ createToken({
  name: "Attribute",
  pattern: Lexer.NA
});
var BlockAttribute = /* @__PURE__ */ createToken({
  name: "BlockAttribute",
  pattern: /@@/,
  label: "'@@'",
  categories: [Attribute]
});
var FieldAttribute = /* @__PURE__ */ createToken({
  name: "FieldAttribute",
  pattern: /@/,
  label: "'@'",
  categories: [Attribute]
});
var Dot = /* @__PURE__ */ createToken({
  name: "Dot",
  pattern: /\./,
  label: "'.'"
});
var QuestionMark = /* @__PURE__ */ createToken({
  name: "QuestionMark",
  pattern: /\?/,
  label: "'?'"
});
var LCurly = /* @__PURE__ */ createToken({
  name: "LCurly",
  pattern: /{/,
  label: "'{'"
});
var RCurly = /* @__PURE__ */ createToken({
  name: "RCurly",
  pattern: /}/,
  label: "'}'",
  pop_mode: true
});
var LRound = /* @__PURE__ */ createToken({
  name: "LRound",
  pattern: /\(/,
  label: "'('"
});
var RRound = /* @__PURE__ */ createToken({
  name: "RRound",
  pattern: /\)/,
  label: "')'"
});
var LSquare = /* @__PURE__ */ createToken({
  name: "LSquare",
  pattern: /\[/,
  label: "'['"
});
var RSquare = /* @__PURE__ */ createToken({
  name: "RSquare",
  pattern: /\]/,
  label: "']'"
});
var Comma = /* @__PURE__ */ createToken({
  name: "Comma",
  pattern: /,/,
  label: "','"
});
var Colon = /* @__PURE__ */ createToken({
  name: "Colon",
  pattern: /:/,
  label: "':'"
});
var Equals = /* @__PURE__ */ createToken({
  name: "Equals",
  pattern: /=/,
  label: "'='"
});
var StringLiteral = /* @__PURE__ */ createToken({
  name: "StringLiteral",
  pattern: /"(:?[^\\"\n\r]|\\(:?[bfnrtv"\\/]|u[0-9a-fA-F]{4}))*"/
});
var NumberLiteral = /* @__PURE__ */ createToken({
  name: "NumberLiteral",
  pattern: /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/
});
var WhiteSpace = /* @__PURE__ */ createToken({
  name: "WhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED
});
var LineBreak = /* @__PURE__ */ createToken({
  name: "LineBreak",
  pattern: /\n|\r\n/,
  line_breaks: true,
  label: "LineBreak"
});
var naTokens = [Comment, DocComment, LineComment, LineBreak, WhiteSpace];
var multiModeTokens = {
  modes: {
    global: /* @__PURE__ */ [].concat(naTokens, [Datasource, Generator, Model, View, Enum, Type]),
    block: /* @__PURE__ */ [].concat(naTokens, [Attribute, BlockAttribute, FieldAttribute, Dot, QuestionMark, LCurly, RCurly, LSquare, RSquare, LRound, RRound, Comma, Colon, Equals, True, False, Null, StringLiteral, NumberLiteral, Identifier])
  },
  defaultMode: "global"
};
var PrismaLexer = /* @__PURE__ */ new Lexer(multiModeTokens);
var schemaObjects = ["model", "view", "type"];
function isOneOfSchemaObjects(obj, schemas) {
  return obj != null && "type" in obj && schemas.includes(obj.type);
}
function isSchemaObject(obj) {
  return isOneOfSchemaObjects(obj, schemaObjects);
}
var fieldObjects = ["field", "enumerator"];
function isSchemaField(field) {
  return field != null && "type" in field && fieldObjects.includes(field.type);
}
function isToken(node) {
  return "image" in node[0];
}
function appendLocationData(data) {
  for (var _len = arguments.length, tokens = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
    tokens[_key - 1] = arguments[_key];
  }
  var location = tokens.reduce(function(memo, token) {
    if (!token) return memo;
    var _memo$endColumn = memo.endColumn, endColumn = _memo$endColumn === void 0 ? -Infinity : _memo$endColumn, _memo$endLine = memo.endLine, endLine = _memo$endLine === void 0 ? -Infinity : _memo$endLine, _memo$endOffset = memo.endOffset, endOffset = _memo$endOffset === void 0 ? -Infinity : _memo$endOffset, _memo$startColumn = memo.startColumn, startColumn = _memo$startColumn === void 0 ? Infinity : _memo$startColumn, _memo$startLine = memo.startLine, startLine = _memo$startLine === void 0 ? Infinity : _memo$startLine, _memo$startOffset = memo.startOffset, startOffset = _memo$startOffset === void 0 ? Infinity : _memo$startOffset;
    if (token.startLine != null && token.startLine < startLine) memo.startLine = token.startLine;
    if (token.startColumn != null && token.startColumn < startColumn) memo.startColumn = token.startColumn;
    if (token.startOffset != null && token.startOffset < startOffset) memo.startOffset = token.startOffset;
    if (token.endLine != null && token.endLine > endLine) memo.endLine = token.endLine;
    if (token.endColumn != null && token.endColumn > endColumn) memo.endColumn = token.endColumn;
    if (token.endOffset != null && token.endOffset > endOffset) memo.endOffset = token.endOffset;
    return memo;
  }, {});
  return Object.assign(data, {
    location
  });
}
var defaultConfig = {
  parser: {
    nodeLocationTracking: "none"
  }
};
var config;
function getConfig() {
  if (config != null) return config;
  var result = distExports.lilconfigSync("prisma-ast").search();
  return config = Object.assign(defaultConfig, result == null ? void 0 : result.config);
}
var PrismaParser = /* @__PURE__ */ (function(_CstParser) {
  _inheritsLoose(PrismaParser2, _CstParser);
  function PrismaParser2(config2) {
    var _this;
    _this = _CstParser.call(this, multiModeTokens, config2) || this;
    _this.config = void 0;
    _this["break"] = _this.RULE("break", function() {
      _this.CONSUME1(LineBreak);
      _this.CONSUME2(LineBreak);
    });
    _this.keyedArg = _this.RULE("keyedArg", function() {
      _this.CONSUME(Identifier, {
        LABEL: "keyName"
      });
      _this.CONSUME(Colon);
      _this.SUBRULE(_this.value);
    });
    _this.array = _this.RULE("array", function() {
      _this.CONSUME(LSquare);
      _this.MANY_SEP({
        SEP: Comma,
        DEF: function DEF() {
          _this.SUBRULE(_this.value);
        }
      });
      _this.CONSUME(RSquare);
    });
    _this.func = _this.RULE("func", function() {
      _this.CONSUME(Identifier, {
        LABEL: "funcName"
      });
      _this.CONSUME(LRound);
      _this.MANY_SEP({
        SEP: Comma,
        DEF: function DEF() {
          _this.OR([{
            ALT: function ALT() {
              return _this.SUBRULE(_this.keyedArg);
            }
          }, {
            ALT: function ALT() {
              return _this.SUBRULE(_this.value);
            }
          }]);
        }
      });
      _this.CONSUME(RRound);
    });
    _this.value = _this.RULE("value", function() {
      _this.OR([{
        ALT: function ALT() {
          return _this.CONSUME(StringLiteral, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(NumberLiteral, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.SUBRULE(_this.array, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.SUBRULE(_this.func, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(True, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(False, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Null, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Identifier, {
            LABEL: "value"
          });
        }
      }]);
    });
    _this.property = _this.RULE("property", function() {
      _this.CONSUME(Identifier, {
        LABEL: "propertyName"
      });
      _this.CONSUME(Equals);
      _this.SUBRULE(_this.value, {
        LABEL: "propertyValue"
      });
    });
    _this.assignment = _this.RULE("assignment", function() {
      _this.CONSUME(Identifier, {
        LABEL: "assignmentName"
      });
      _this.CONSUME(Equals);
      _this.SUBRULE(_this.value, {
        LABEL: "assignmentValue"
      });
    });
    _this.field = _this.RULE("field", function() {
      _this.CONSUME(Identifier, {
        LABEL: "fieldName"
      });
      _this.SUBRULE(_this.value, {
        LABEL: "fieldType"
      });
      _this.OPTION1(function() {
        _this.OR([{
          ALT: function ALT() {
            _this.CONSUME(LSquare, {
              LABEL: "array"
            });
            _this.CONSUME(RSquare, {
              LABEL: "array"
            });
          }
        }, {
          ALT: function ALT() {
            return _this.CONSUME(QuestionMark, {
              LABEL: "optional"
            });
          }
        }]);
      });
      _this.MANY(function() {
        _this.SUBRULE(_this.fieldAttribute, {
          LABEL: "attributeList"
        });
      });
      _this.OPTION2(function() {
        _this.CONSUME(Comment, {
          LABEL: "comment"
        });
      });
    });
    _this.block = _this.RULE("block", function(options) {
      if (options === void 0) {
        options = {};
      }
      var _options = options, componentType = _options.componentType;
      var isEnum = componentType === "enum";
      var isObject = componentType === "model" || componentType === "view" || componentType === "type";
      _this.CONSUME(LCurly);
      _this.CONSUME1(LineBreak);
      _this.MANY(function() {
        _this.OR([{
          ALT: function ALT() {
            return _this.SUBRULE(_this.comment, {
              LABEL: "list"
            });
          }
        }, {
          GATE: function GATE() {
            return isObject;
          },
          ALT: function ALT() {
            return _this.SUBRULE(_this.property, {
              LABEL: "list"
            });
          }
        }, {
          ALT: function ALT() {
            return _this.SUBRULE(_this.blockAttribute, {
              LABEL: "list"
            });
          }
        }, {
          GATE: function GATE() {
            return isObject;
          },
          ALT: function ALT() {
            return _this.SUBRULE(_this.field, {
              LABEL: "list"
            });
          }
        }, {
          GATE: function GATE() {
            return isEnum;
          },
          ALT: function ALT() {
            return _this.SUBRULE(_this["enum"], {
              LABEL: "list"
            });
          }
        }, {
          GATE: function GATE() {
            return !isObject;
          },
          ALT: function ALT() {
            return _this.SUBRULE(_this.assignment, {
              LABEL: "list"
            });
          }
        }, {
          ALT: function ALT() {
            return _this.SUBRULE(_this["break"], {
              LABEL: "list"
            });
          }
        }, {
          ALT: function ALT() {
            return _this.CONSUME2(LineBreak);
          }
        }]);
      });
      _this.CONSUME(RCurly);
    });
    _this["enum"] = _this.RULE("enum", function() {
      _this.CONSUME(Identifier, {
        LABEL: "enumName"
      });
      _this.MANY(function() {
        _this.SUBRULE(_this.fieldAttribute, {
          LABEL: "attributeList"
        });
      });
      _this.OPTION(function() {
        _this.CONSUME(Comment, {
          LABEL: "comment"
        });
      });
    });
    _this.fieldAttribute = _this.RULE("fieldAttribute", function() {
      _this.CONSUME(FieldAttribute, {
        LABEL: "fieldAttribute"
      });
      _this.OR([{
        ALT: function ALT() {
          _this.CONSUME1(Identifier, {
            LABEL: "groupName"
          });
          _this.CONSUME(Dot);
          _this.CONSUME2(Identifier, {
            LABEL: "attributeName"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Identifier, {
            LABEL: "attributeName"
          });
        }
      }]);
      _this.OPTION(function() {
        _this.CONSUME(LRound);
        _this.MANY_SEP({
          SEP: Comma,
          DEF: function DEF() {
            _this.SUBRULE(_this.attributeArg);
          }
        });
        _this.CONSUME(RRound);
      });
    });
    _this.blockAttribute = _this.RULE("blockAttribute", function() {
      _this.CONSUME(BlockAttribute, {
        LABEL: "blockAttribute"
      }), _this.OR([{
        ALT: function ALT() {
          _this.CONSUME1(Identifier, {
            LABEL: "groupName"
          });
          _this.CONSUME(Dot);
          _this.CONSUME2(Identifier, {
            LABEL: "attributeName"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Identifier, {
            LABEL: "attributeName"
          });
        }
      }]);
      _this.OPTION(function() {
        _this.CONSUME(LRound);
        _this.MANY_SEP({
          SEP: Comma,
          DEF: function DEF() {
            _this.SUBRULE(_this.attributeArg);
          }
        });
        _this.CONSUME(RRound);
      });
    });
    _this.attributeArg = _this.RULE("attributeArg", function() {
      _this.OR([{
        ALT: function ALT() {
          return _this.SUBRULE(_this.keyedArg, {
            LABEL: "value"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.SUBRULE(_this.value, {
            LABEL: "value"
          });
        }
      }]);
    });
    _this.component = _this.RULE("component", function() {
      var type = _this.OR1([{
        ALT: function ALT() {
          return _this.CONSUME(Datasource, {
            LABEL: "type"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Generator, {
            LABEL: "type"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Model, {
            LABEL: "type"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(View, {
            LABEL: "type"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Enum, {
            LABEL: "type"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Type, {
            LABEL: "type"
          });
        }
      }]);
      _this.OR2([{
        ALT: function ALT() {
          _this.CONSUME1(Identifier, {
            LABEL: "groupName"
          });
          _this.CONSUME(Dot);
          _this.CONSUME2(Identifier, {
            LABEL: "componentName"
          });
        }
      }, {
        ALT: function ALT() {
          return _this.CONSUME(Identifier, {
            LABEL: "componentName"
          });
        }
      }]);
      _this.SUBRULE(_this.block, {
        ARGS: [{
          componentType: type.image
        }]
      });
    });
    _this.comment = _this.RULE("comment", function() {
      _this.CONSUME(Comment, {
        LABEL: "text"
      });
    });
    _this.schema = _this.RULE("schema", function() {
      _this.MANY(function() {
        _this.OR([{
          ALT: function ALT() {
            return _this.SUBRULE(_this.comment, {
              LABEL: "list"
            });
          }
        }, {
          ALT: function ALT() {
            return _this.SUBRULE(_this.component, {
              LABEL: "list"
            });
          }
        }, {
          ALT: function ALT() {
            return _this.SUBRULE(_this["break"], {
              LABEL: "list"
            });
          }
        }, {
          ALT: function ALT() {
            return _this.CONSUME(LineBreak);
          }
        }]);
      });
    });
    _this.performSelfAnalysis();
    _this.config = config2;
    return _this;
  }
  return PrismaParser2;
})(CstParser);
var defaultParser = /* @__PURE__ */ new PrismaParser(getConfig().parser);
var VisitorClassFactory = function VisitorClassFactory2(parser) {
  var BasePrismaVisitor = parser.getBaseCstVisitorConstructorWithDefaults();
  return /* @__PURE__ */ (function(_BasePrismaVisitor) {
    _inheritsLoose(PrismaVisitor, _BasePrismaVisitor);
    function PrismaVisitor() {
      var _this;
      _this = _BasePrismaVisitor.call(this) || this;
      _this.validateVisitor();
      return _this;
    }
    var _proto = PrismaVisitor.prototype;
    _proto.schema = function schema(ctx) {
      var _ctx$list, _this2 = this;
      var list = ((_ctx$list = ctx.list) == null ? void 0 : _ctx$list.map(function(item) {
        return _this2.visit([item]);
      })) || [];
      return {
        type: "schema",
        list
      };
    };
    _proto.component = function component(ctx) {
      var _ctx$type = ctx.type, type = _ctx$type[0];
      var _ctx$componentName = ctx.componentName, name = _ctx$componentName[0];
      var list = this.visit(ctx.block);
      var data = (function() {
        switch (type.image) {
          case "datasource":
            return {
              type: "datasource",
              name: name.image,
              assignments: list
            };
          case "generator":
            return {
              type: "generator",
              name: name.image,
              assignments: list
            };
          case "model":
            return {
              type: "model",
              name: name.image,
              properties: list
            };
          case "view":
            return {
              type: "view",
              name: name.image,
              properties: list
            };
          case "enum":
            return {
              type: "enum",
              name: name.image,
              enumerators: list
            };
          case "type":
            return {
              type: "type",
              name: name.image,
              properties: list
            };
          default:
            throw new Error("Unexpected block type: " + type);
        }
      })();
      return this.maybeAppendLocationData(data, type, name);
    };
    _proto["break"] = function _break() {
      return {
        type: "break"
      };
    };
    _proto.comment = function comment(ctx) {
      var _ctx$text = ctx.text, comment2 = _ctx$text[0];
      var data = {
        type: "comment",
        text: comment2.image
      };
      return this.maybeAppendLocationData(data, comment2);
    };
    _proto.block = function block(ctx) {
      var _ctx$list2, _this3 = this;
      return (_ctx$list2 = ctx.list) == null ? void 0 : _ctx$list2.map(function(item) {
        return _this3.visit([item]);
      });
    };
    _proto.assignment = function assignment(ctx) {
      var value = this.visit(ctx.assignmentValue);
      var _ctx$assignmentName = ctx.assignmentName, key = _ctx$assignmentName[0];
      var data = {
        type: "assignment",
        key: key.image,
        value
      };
      return this.maybeAppendLocationData(data, key);
    };
    _proto.field = function field(ctx) {
      var _ctx$attributeList, _this4 = this, _ctx$comment, _ctx$optional, _ctx$array;
      var fieldType = this.visit(ctx.fieldType);
      var _ctx$fieldName = ctx.fieldName, name = _ctx$fieldName[0];
      var attributes = (_ctx$attributeList = ctx.attributeList) == null ? void 0 : _ctx$attributeList.map(function(item) {
        return _this4.visit([item]);
      });
      var comment = (_ctx$comment = ctx.comment) == null || (_ctx$comment = _ctx$comment[0]) == null ? void 0 : _ctx$comment.image;
      var data = {
        type: "field",
        name: name.image,
        fieldType,
        array: ctx.array != null,
        optional: ctx.optional != null,
        attributes,
        comment
      };
      return this.maybeAppendLocationData(data, name, (_ctx$optional = ctx.optional) == null ? void 0 : _ctx$optional[0], (_ctx$array = ctx.array) == null ? void 0 : _ctx$array[0]);
    };
    _proto.fieldAttribute = function fieldAttribute(ctx) {
      var _ctx$attributeArg, _this5 = this;
      var _ctx$attributeName = ctx.attributeName, name = _ctx$attributeName[0];
      var _ref = ctx.groupName || [{}], group = _ref[0];
      var args = (_ctx$attributeArg = ctx.attributeArg) == null ? void 0 : _ctx$attributeArg.map(function(attr) {
        return _this5.visit(attr);
      });
      var data = {
        type: "attribute",
        name: name.image,
        kind: "field",
        group: group.image,
        args
      };
      return this.maybeAppendLocationData.apply(this, [data, name].concat(ctx.fieldAttribute, [group]));
    };
    _proto.blockAttribute = function blockAttribute(ctx) {
      var _ctx$attributeArg2, _this6 = this;
      var _ctx$attributeName2 = ctx.attributeName, name = _ctx$attributeName2[0];
      var _ref2 = ctx.groupName || [{}], group = _ref2[0];
      var args = (_ctx$attributeArg2 = ctx.attributeArg) == null ? void 0 : _ctx$attributeArg2.map(function(attr) {
        return _this6.visit(attr);
      });
      var data = {
        type: "attribute",
        name: name.image,
        kind: "object",
        group: group.image,
        args
      };
      return this.maybeAppendLocationData.apply(this, [data, name].concat(ctx.blockAttribute, [group]));
    };
    _proto.attributeArg = function attributeArg(ctx) {
      var value = this.visit(ctx.value);
      return {
        type: "attributeArgument",
        value
      };
    };
    _proto.func = function func(ctx) {
      var _ctx$value, _this7 = this, _ctx$keyedArg;
      var _ctx$funcName = ctx.funcName, name = _ctx$funcName[0];
      var params = (_ctx$value = ctx.value) == null ? void 0 : _ctx$value.map(function(item) {
        return _this7.visit([item]);
      });
      var keyedParams = (_ctx$keyedArg = ctx.keyedArg) == null ? void 0 : _ctx$keyedArg.map(function(item) {
        return _this7.visit([item]);
      });
      var pars = (params || keyedParams) && [].concat(params != null ? params : [], keyedParams != null ? keyedParams : []);
      var data = {
        type: "function",
        name: name.image,
        params: pars
      };
      return this.maybeAppendLocationData(data, name);
    };
    _proto.array = function array(ctx) {
      var _ctx$value2, _this8 = this;
      var args = (_ctx$value2 = ctx.value) == null ? void 0 : _ctx$value2.map(function(item) {
        return _this8.visit([item]);
      });
      return {
        type: "array",
        args
      };
    };
    _proto.keyedArg = function keyedArg(ctx) {
      var _ctx$keyName = ctx.keyName, key = _ctx$keyName[0];
      var value = this.visit(ctx.value);
      var data = {
        type: "keyValue",
        key: key.image,
        value
      };
      return this.maybeAppendLocationData(data, key);
    };
    _proto.value = function value(ctx) {
      if (isToken(ctx.value)) {
        var _ctx$value3 = ctx.value, image = _ctx$value3[0].image;
        return image;
      }
      return this.visit(ctx.value);
    };
    _proto["enum"] = function _enum(ctx) {
      var _ctx$attributeList2, _this9 = this, _ctx$comment2;
      var _ctx$enumName = ctx.enumName, name = _ctx$enumName[0];
      var attributes = (_ctx$attributeList2 = ctx.attributeList) == null ? void 0 : _ctx$attributeList2.map(function(item) {
        return _this9.visit([item]);
      });
      var comment = (_ctx$comment2 = ctx.comment) == null || (_ctx$comment2 = _ctx$comment2[0]) == null ? void 0 : _ctx$comment2.image;
      var data = {
        type: "enumerator",
        name: name.image,
        attributes,
        comment
      };
      return this.maybeAppendLocationData(data, name);
    };
    _proto.maybeAppendLocationData = function maybeAppendLocationData(data) {
      if (parser.config.nodeLocationTracking === "none") return data;
      for (var _len = arguments.length, tokens = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        tokens[_key - 1] = arguments[_key];
      }
      return appendLocationData.apply(void 0, [data].concat(tokens));
    };
    return PrismaVisitor;
  })(BasePrismaVisitor);
};
var DefaultVisitorClass = /* @__PURE__ */ VisitorClassFactory(defaultParser);
var defaultVisitor = /* @__PURE__ */ new DefaultVisitorClass();
function getSchema(source, options) {
  var _options$parser, _options$visitor;
  var lexingResult = PrismaLexer.tokenize(source);
  var parser = (_options$parser = void 0 ) != null ? _options$parser : defaultParser;
  parser.input = lexingResult.tokens;
  var cstNode = parser.schema();
  if (parser.errors.length > 0) throw parser.errors[0];
  var visitor = (_options$visitor = void 0 ) != null ? _options$visitor : defaultVisitor;
  return visitor.visit(cstNode);
}
var unsorted = ["break", "comment"];
var defaultSortOrder = ["generator", "datasource", "model", "view", "enum", "break", "comment"];
var schemaSorter = function schemaSorter2(schema, locales, sortOrder) {
  if (sortOrder === void 0) {
    sortOrder = defaultSortOrder;
  }
  return function(a, b) {
    var aUnsorted = unsorted.indexOf(a.type) !== -1;
    var bUnsorted = unsorted.indexOf(b.type) !== -1;
    if (aUnsorted !== bUnsorted) {
      return schema.list.indexOf(a) - schema.list.indexOf(b);
    }
    if (sortOrder !== defaultSortOrder) sortOrder = sortOrder.concat(defaultSortOrder);
    var typeIndex = sortOrder.indexOf(a.type) - sortOrder.indexOf(b.type);
    if (typeIndex !== 0) return typeIndex;
    if ("name" in a && "name" in b) return a.name.localeCompare(b.name, locales);
    return 0;
  };
};
function printSchema(schema, options) {
  if (options === void 0) {
    options = {};
  }
  var _options = options, _options$sort = _options.sort, sort = _options$sort === void 0 ? false : _options$sort, _options$locales = _options.locales, locales = _options$locales === void 0 ? void 0 : _options$locales, _options$sortOrder = _options.sortOrder, sortOrder = _options$sortOrder === void 0 ? void 0 : _options$sortOrder;
  var blocks = schema.list;
  if (sort) {
    blocks = schema.list = blocks.filter(function(block) {
      return block.type !== "break";
    });
    var sorter = schemaSorter(schema, locales, sortOrder);
    blocks.sort(sorter);
  }
  return blocks.map(printBlock).filter(Boolean).join(EOL).replace(/(\r?\n\s*){3,}/g, EOL + EOL) + EOL;
}
function printBlock(block) {
  switch (block.type) {
    case "comment":
      return printComment(block);
    case "datasource":
      return printDatasource(block);
    case "enum":
      return printEnum(block);
    case "generator":
      return printGenerator(block);
    case "model":
    case "view":
    case "type":
      return printObject(block);
    case "break":
      return printBreak();
    default:
      throw new Error("Unrecognized block type");
  }
}
function printComment(comment) {
  return comment.text;
}
function printBreak() {
  return EOL;
}
function printDatasource(db) {
  var children = computeAssignmentFormatting(db.assignments);
  return "\ndatasource " + db.name + " {\n  " + children + "\n}";
}
function printEnum(enumerator) {
  var list = enumerator.enumerators;
  var children = list.filter(Boolean).map(printEnumerator).join(EOL + "  ").replace(/(\r?\n\s*){3,}/g, EOL + EOL + "  ");
  return "\nenum " + enumerator.name + " {\n  " + children + "\n}";
}
function printEnumerator(enumerator) {
  switch (enumerator.type) {
    case "enumerator": {
      var attrs = enumerator.attributes ? enumerator.attributes.map(printAttribute) : [];
      return [enumerator.name].concat(attrs, [enumerator.comment]).filter(Boolean).join(" ");
    }
    case "attribute":
      return printAttribute(enumerator);
    case "comment":
      return printComment(enumerator);
    case "break":
      return printBreak();
    default:
      throw new Error("Unexpected enumerator type");
  }
}
function printGenerator(generator) {
  var children = computeAssignmentFormatting(generator.assignments);
  return "\ngenerator " + generator.name + " {\n  " + children + "\n}";
}
function printObject(object) {
  var _props;
  var props = [].concat(object.properties);
  var blockAttributeMoved = false;
  props.sort(function(a, b) {
    if (a.type === "attribute" && a.kind === "object" && (b.type !== "attribute" || b.type === "attribute" && b.kind !== "object")) {
      blockAttributeMoved = true;
      return 1;
    }
    if (b.type === "attribute" && b.kind === "object" && (a.type !== "attribute" || a.type === "attribute" && a.kind !== "object")) {
      blockAttributeMoved = true;
      return -1;
    }
    return 0;
  });
  var attrIndex = props.findIndex(function(item) {
    return item.type === "attribute" && item.kind === "object";
  });
  var needsSpace = !["break", "comment"].includes((_props = props[attrIndex - 1]) == null ? void 0 : _props.type);
  if (blockAttributeMoved && needsSpace) {
    props.splice(attrIndex, 0, {
      type: "break"
    });
  }
  var children = computePropertyFormatting(props);
  return "\n" + object.type + " " + object.name + " {\n  " + children + "\n}";
}
function printAssignment(node, keyLength) {
  if (keyLength === void 0) {
    keyLength = 0;
  }
  switch (node.type) {
    case "comment":
      return printComment(node);
    case "break":
      return printBreak();
    case "assignment":
      return node.key.padEnd(keyLength) + " = " + printValue(node.value);
    default:
      throw new Error("Unexpected assignment type");
  }
}
function printProperty(node, nameLength, typeLength) {
  if (nameLength === void 0) {
    nameLength = 0;
  }
  if (typeLength === void 0) {
    typeLength = 0;
  }
  switch (node.type) {
    case "attribute":
      return printAttribute(node);
    case "field":
      return printField(node, nameLength, typeLength);
    case "comment":
      return printComment(node);
    case "break":
      return printBreak();
    default:
      throw new Error("Unrecognized property type");
  }
}
function printAttribute(attribute) {
  var args = attribute.args && attribute.args.length > 0 ? "(" + attribute.args.map(printAttributeArg).filter(Boolean).join(", ") + ")" : "";
  var name = [attribute.name];
  if (attribute.group) name.unshift(attribute.group);
  return (attribute.kind === "field" ? "@" : "@@") + name.join(".") + args;
}
function printAttributeArg(arg) {
  return printValue(arg.value);
}
function printField(field, nameLength, typeLength) {
  if (nameLength === void 0) {
    nameLength = 0;
  }
  if (typeLength === void 0) {
    typeLength = 0;
  }
  var name = field.name.padEnd(nameLength);
  var fieldType = printFieldType(field).padEnd(typeLength);
  var attrs = field.attributes ? field.attributes.map(printAttribute) : [];
  var comment = field.comment;
  return [name, fieldType].concat(attrs).filter(Boolean).join(" ").trim() + (comment ? " " + comment : "");
}
function printFieldType(field) {
  var suffix = field.array ? "[]" : field.optional ? "?" : "";
  if (typeof field.fieldType === "object") {
    switch (field.fieldType.type) {
      case "function": {
        return "" + printFunction(field.fieldType) + suffix;
      }
      default:
        throw new Error("Unexpected field type");
    }
  }
  return "" + field.fieldType + suffix;
}
function printFunction(func) {
  var params = func.params ? func.params.map(printValue) : "";
  return func.name + "(" + params + ")";
}
function printValue(value) {
  switch (typeof value) {
    case "object": {
      if ("type" in value) {
        switch (value.type) {
          case "keyValue":
            return value.key + ": " + printValue(value.value);
          case "function":
            return printFunction(value);
          case "array":
            return "[" + (value.args != null ? value.args.map(printValue).join(", ") : "") + "]";
          default:
            throw new Error("Unexpected value type");
        }
      }
      throw new Error("Unexpected object value");
    }
    default:
      return String(value);
  }
}
function computeAssignmentFormatting(list) {
  var pos = 0;
  var listBlocks = list.reduce(function(memo, current, index, arr) {
    if (current.type === "break") return memo;
    if (index > 0 && arr[index - 1].type === "break") memo[++pos] = [];
    memo[pos].push(current);
    return memo;
  }, [[]]);
  var keyLengths = listBlocks.map(function(lists) {
    return lists.reduce(function(max, current) {
      return Math.max(max, current.type === "assignment" ? current.key.length : 0);
    }, 0);
  });
  return list.map(function(item, index, arr) {
    if (index > 0 && item.type !== "break" && arr[index - 1].type === "break") keyLengths.shift();
    return printAssignment(item, keyLengths[0]);
  }).filter(Boolean).join(EOL + "  ").replace(/(\r?\n\s*){3,}/g, EOL + EOL + "  ");
}
function computePropertyFormatting(list) {
  var pos = 0;
  var listBlocks = list.reduce(function(memo, current, index, arr) {
    if (current.type === "break") return memo;
    if (index > 0 && arr[index - 1].type === "break") memo[++pos] = [];
    memo[pos].push(current);
    return memo;
  }, [[]]);
  var nameLengths = listBlocks.map(function(lists) {
    return lists.reduce(function(max, current) {
      return Math.max(max, current.type === "field" ? current.name.length : 0);
    }, 0);
  });
  var typeLengths = listBlocks.map(function(lists) {
    return lists.reduce(function(max, current) {
      return Math.max(max, current.type === "field" ? printFieldType(current).length : 0);
    }, 0);
  });
  return list.map(function(prop, index, arr) {
    if (index > 0 && prop.type !== "break" && arr[index - 1].type === "break") {
      nameLengths.shift();
      typeLengths.shift();
    }
    return printProperty(prop, nameLengths[0], typeLengths[0]);
  }).filter(Boolean).join(EOL + "  ").replace(/(\r?\n\s*){3,}/g, EOL + EOL + "  ");
}
var findByType = function findByType2(list, typeToMatch, options) {
  if (options === void 0) {
    options = {};
  }
  var _list$filter = list.filter(findBy(typeToMatch, options)), match = _list$filter[0], unexpected = _list$filter[1];
  if (!match) return null;
  if (unexpected) throw new Error("Found multiple blocks with [type=" + typeToMatch + "]");
  return match;
};
var findAllByType = function findAllByType2(list, typeToMatch, options) {
  if (options === void 0) {
    options = {};
  }
  return list.filter(findBy(typeToMatch, options));
};
var findBy = function findBy2(typeToMatch, _temp) {
  var _ref = _temp === void 0 ? {} : _temp, name = _ref.name;
  return function(block) {
    if (name != null) {
      var nameAttribute = typeToMatch === "assignment" ? "key" : "name";
      if (!(nameAttribute in block)) return false;
      var nameMatches = typeof name === "string" ? block[nameAttribute] === name : name.test(block[nameAttribute]);
      if (!nameMatches) return false;
    }
    return block.type === typeToMatch;
  };
};
var _excluded = ["within"], _excluded2 = ["within"];
var ConcretePrismaSchemaBuilder = /* @__PURE__ */ (function() {
  function ConcretePrismaSchemaBuilder2(source) {
    if (source === void 0) {
      source = "";
    }
    this.schema = void 0;
    this._subject = void 0;
    this._parent = void 0;
    this.schema = getSchema(source);
  }
  var _proto = ConcretePrismaSchemaBuilder2.prototype;
  _proto.print = function print(options) {
    if (options === void 0) {
      options = {};
    }
    return printSchema(this.schema, options);
  };
  _proto.getSchema = function getSchema2() {
    return this.schema;
  };
  _proto.generator = function generator(name, provider) {
    if (provider === void 0) {
      provider = "prisma-client-js";
    }
    var generator2 = this.schema.list.reduce(function(memo, block) {
      return block.type === "generator" && block.name === name ? block : memo;
    }, {
      type: "generator",
      name,
      assignments: [{
        type: "assignment",
        key: "provider",
        value: '"' + provider + '"'
      }]
    });
    if (!this.schema.list.includes(generator2)) this.schema.list.push(generator2);
    this._subject = generator2;
    return this;
  };
  _proto.drop = function drop(name) {
    var index = this.schema.list.findIndex(function(block) {
      return "name" in block && block.name === name;
    });
    if (index !== -1) this.schema.list.splice(index, 1);
    return this;
  };
  _proto.datasource = function datasource(provider, url) {
    var datasource2 = {
      type: "datasource",
      name: "db",
      assignments: [{
        type: "assignment",
        key: "url",
        value: typeof url === "string" ? '"' + url + '"' : {
          type: "function",
          name: "env",
          params: ['"' + url.env + '"']
        }
      }, {
        type: "assignment",
        key: "provider",
        value: '"' + provider + '"'
      }]
    };
    var existingIndex = this.schema.list.findIndex(function(block) {
      return block.type === "datasource";
    });
    this.schema.list.splice(existingIndex, existingIndex !== -1 ? 1 : 0, datasource2);
    this._subject = datasource2;
    return this;
  };
  _proto.model = function model(name) {
    var model2 = this.schema.list.reduce(function(memo, block) {
      return block.type === "model" && block.name === name ? block : memo;
    }, {
      type: "model",
      name,
      properties: []
    });
    if (!this.schema.list.includes(model2)) this.schema.list.push(model2);
    this._subject = model2;
    return this;
  };
  _proto.view = function view(name) {
    var view2 = this.schema.list.reduce(function(memo, block) {
      return block.type === "view" && block.name === name ? block : memo;
    }, {
      type: "view",
      name,
      properties: []
    });
    if (!this.schema.list.includes(view2)) this.schema.list.push(view2);
    this._subject = view2;
    return this;
  };
  _proto.type = function type(name) {
    var type2 = this.schema.list.reduce(function(memo, block) {
      return block.type === "type" && block.name === name ? block : memo;
    }, {
      type: "type",
      name,
      properties: []
    });
    if (!this.schema.list.includes(type2)) this.schema.list.push(type2);
    this._subject = type2;
    return this;
  };
  _proto["enum"] = function _enum(name, enumeratorNames) {
    if (enumeratorNames === void 0) {
      enumeratorNames = [];
    }
    var e = this.schema.list.reduce(function(memo, block) {
      return block.type === "enum" && block.name === name ? block : memo;
    }, {
      type: "enum",
      name,
      enumerators: enumeratorNames.map(function(name2) {
        return {
          type: "enumerator",
          name: name2
        };
      })
    });
    if (!this.schema.list.includes(e)) this.schema.list.push(e);
    this._subject = e;
    return this;
  };
  _proto.enumerator = function enumerator(value) {
    var subject = this.getSubject();
    if (!subject || !("type" in subject) || subject.type !== "enum") {
      throw new Error("Subject must be a prisma enum!");
    }
    var enumerator2 = {
      type: "enumerator",
      name: value
    };
    subject.enumerators.push(enumerator2);
    this._parent = this._subject;
    this._subject = enumerator2;
    return this;
  };
  _proto.getSubject = function getSubject() {
    return this._subject;
  };
  _proto.getParent = function getParent() {
    return this._parent;
  };
  _proto.blockAttribute = function blockAttribute(name, args) {
    var subject = this.getSubject();
    if (subject.type !== "enum" && !isSchemaObject(subject)) {
      var parent = this.getParent();
      if (!isOneOfSchemaObjects(parent, ["model", "view", "type", "enum"])) throw new Error("Subject must be a prisma model, view, or type!");
      subject = this._subject = parent;
    }
    var attributeArgs = (function() {
      if (!args) return [];
      if (typeof args === "string") return [{
        type: "attributeArgument",
        value: '"' + args + '"'
      }];
      if (Array.isArray(args)) return [{
        type: "attributeArgument",
        value: {
          type: "array",
          args
        }
      }];
      return Object.entries(args).map(function(_ref) {
        var key = _ref[0], value = _ref[1];
        return {
          type: "attributeArgument",
          value: {
            type: "keyValue",
            key,
            value
          }
        };
      });
    })();
    var property = {
      type: "attribute",
      kind: "object",
      name,
      args: attributeArgs
    };
    if (subject.type === "enum") {
      subject.enumerators.push(property);
    } else {
      subject.properties.push(property);
    }
    return this;
  };
  _proto.attribute = function attribute(name, args) {
    var parent = this.getParent();
    var subject = this.getSubject();
    if (!isOneOfSchemaObjects(parent, ["model", "view", "type", "enum"])) {
      throw new Error("Parent must be a prisma model or view!");
    }
    if (!isSchemaField(subject)) {
      throw new Error("Subject must be a prisma field or enumerator!");
    }
    if (!subject.attributes) subject.attributes = [];
    var attribute2 = subject.attributes.reduce(function(memo, attr) {
      return attr.type === "attribute" && (attr.group ? attr.group + "." : "") + attr.name === name ? attr : memo;
    }, {
      type: "attribute",
      kind: "field",
      name
    });
    if (Array.isArray(args)) {
      var mapArg = function mapArg2(arg) {
        var _arg$function$map, _arg$function;
        return typeof arg === "string" ? arg : {
          type: "function",
          name: arg.name,
          params: (_arg$function$map = (_arg$function = arg["function"]) == null ? void 0 : _arg$function.map(mapArg2)) != null ? _arg$function$map : []
        };
      };
      if (args.length > 0) attribute2.args = args.map(function(arg) {
        return {
          type: "attributeArgument",
          value: mapArg(arg)
        };
      });
    } else if (typeof args === "object") {
      attribute2.args = Object.entries(args).map(function(_ref2) {
        var key = _ref2[0], value = _ref2[1];
        return {
          type: "attributeArgument",
          value: {
            type: "keyValue",
            key,
            value: {
              type: "array",
              args: value
            }
          }
        };
      });
    }
    if (!subject.attributes.includes(attribute2)) subject.attributes.push(attribute2);
    return this;
  };
  _proto.removeAttribute = function removeAttribute(name) {
    var parent = this.getParent();
    var subject = this.getSubject();
    if (!isSchemaObject(parent)) {
      throw new Error("Parent must be a prisma model or view!");
    }
    if (!isSchemaField(subject)) {
      throw new Error("Subject must be a prisma field!");
    }
    if (!subject.attributes) subject.attributes = [];
    subject.attributes = subject.attributes.filter(function(attr) {
      return !(attr.type === "attribute" && attr.name === name);
    });
    return this;
  };
  _proto.assignment = function assignment(key, value) {
    var subject = this.getSubject();
    if (!subject || !("type" in subject) || !["generator", "datasource"].includes(subject.type)) throw new Error("Subject must be a prisma generator or datasource!");
    function tap(subject2, callback) {
      callback(subject2);
      return subject2;
    }
    var assignment2 = subject.assignments.reduce(function(memo, assignment3) {
      return assignment3.type === "assignment" && assignment3.key === key ? tap(assignment3, function(a) {
        a.value = '"' + value + '"';
      }) : memo;
    }, {
      type: "assignment",
      key,
      value: '"' + value + '"'
    });
    if (!subject.assignments.includes(assignment2)) subject.assignments.push(assignment2);
    return this;
  };
  _proto.findByType = function findByType$1(typeToMatch, _ref3) {
    var _ref3$within = _ref3.within, within = _ref3$within === void 0 ? this.schema.list : _ref3$within, options = _objectWithoutPropertiesLoose(_ref3, _excluded);
    return findByType(within, typeToMatch, options);
  };
  _proto.findAllByType = function findAllByType$1(typeToMatch, _ref4) {
    var _ref4$within = _ref4.within, within = _ref4$within === void 0 ? this.schema.list : _ref4$within, options = _objectWithoutPropertiesLoose(_ref4, _excluded2);
    return findAllByType(within, typeToMatch, options);
  };
  _proto.blockInsert = function blockInsert(statement) {
    var subject = this.getSubject();
    var allowed = ["datasource", "enum", "generator", "model", "view", "type"];
    if (!subject || !("type" in subject) || !allowed.includes(subject.type)) {
      var parent = this.getParent();
      if (!parent || !("type" in parent) || !allowed.includes(parent.type)) {
        throw new Error("Subject must be a prisma block!");
      }
      subject = this._subject = parent;
    }
    switch (subject.type) {
      case "datasource": {
        subject.assignments.push(statement);
        break;
      }
      case "enum": {
        subject.enumerators.push(statement);
        break;
      }
      case "generator": {
        subject.assignments.push(statement);
        break;
      }
      case "model": {
        subject.properties.push(statement);
        break;
      }
    }
    return this;
  };
  _proto["break"] = function _break() {
    var lineBreak = {
      type: "break"
    };
    return this.blockInsert(lineBreak);
  };
  _proto.comment = function comment(text, node) {
    if (node === void 0) {
      node = false;
    }
    var comment2 = {
      type: "comment",
      text: "//" + (node ? "/" : "") + " " + text
    };
    return this.blockInsert(comment2);
  };
  _proto.schemaComment = function schemaComment(text, node) {
    if (node === void 0) {
      node = false;
    }
    var comment = {
      type: "comment",
      text: "//" + (node ? "/" : "") + " " + text
    };
    this.schema.list.push(comment);
    return this;
  };
  _proto.field = function field(name, fieldType) {
    if (fieldType === void 0) {
      fieldType = "String";
    }
    var subject = this.getSubject();
    if (!isSchemaObject(subject)) {
      var parent = this.getParent();
      if (!isSchemaObject(parent)) throw new Error("Subject must be a prisma model or view or composite type!");
      subject = this._subject = parent;
    }
    var field2 = subject.properties.reduce(function(memo, block) {
      return block.type === "field" && block.name === name ? block : memo;
    }, {
      type: "field",
      name,
      fieldType
    });
    if (!subject.properties.includes(field2)) subject.properties.push(field2);
    this._parent = subject;
    this._subject = field2;
    return this;
  };
  _proto.removeField = function removeField(name) {
    var subject = this.getSubject();
    if (!isSchemaObject(subject)) {
      var parent = this.getParent();
      if (!isSchemaObject(parent)) throw new Error("Subject must be a prisma model or view or composite type!");
      subject = this._subject = parent;
    }
    subject.properties = subject.properties.filter(function(field) {
      return !(field.type === "field" && field.name === name);
    });
    return this;
  };
  _proto.then = function then(callback) {
    callback(this._subject);
    return this;
  };
  return ConcretePrismaSchemaBuilder2;
})();
function createPrismaSchemaBuilder(source) {
  return new ConcretePrismaSchemaBuilder(source);
}

function extractPrismaEntities(config) {
  if (config.origin.type !== "prisma") {
    return { tables: [], views: [], enumDeclarations: {} };
  }
  const schemaContent = readFileSync(config.origin.path, "utf-8");
  const schema = createPrismaSchemaBuilder(schemaContent);
  const prismaModels = schema.findAllByType("model", {});
  const tables = prismaModels.filter((m) => m !== null).filter((model) => {
    if (model.properties && Array.isArray(model.properties)) {
      return !model.properties.some(
        (prop) => prop.type === "attribute" && prop.name === "ignore" && prop.kind === "object"
      );
    }
    return true;
  }).map((model) => model.name);
  const prismaViews = schema.findAllByType("view", {});
  const views = prismaViews.filter((v) => v !== null).map((view) => view.name);
  const enumDeclarations = {};
  const prismaEnums = schema.findAllByType("enum", {});
  for (const prismaEnum of prismaEnums) {
    if (prismaEnum && "name" in prismaEnum && "enumerators" in prismaEnum) {
      const enumName = prismaEnum.name;
      const enumerators = prismaEnum.enumerators;
      const hasEnumIgnore = enumerators.some(
        (item) => item.type === "attribute" && item.name === "ignore" && item.kind === "object"
      );
      if (hasEnumIgnore) {
        continue;
      }
      const filteredEnumValues = enumerators.filter((e) => {
        if (e.type === "attribute") {
          return false;
        }
        if (!e.name || typeof e.name !== "string") {
          return false;
        }
        if ("attributes" in e && e.attributes) {
          const hasIgnore = e.attributes.some((attr) => attr.name === "ignore");
          if (hasIgnore) {
            return false;
          }
        }
        return true;
      }).map((e) => {
        if ("attributes" in e && e.attributes) {
          const mapAttr = e.attributes.find((attr) => attr.name === "map");
          if (mapAttr && mapAttr.args && mapAttr.args.length > 0) {
            const mapValue = mapAttr.args[0];
            if (typeof mapValue === "object" && "value" in mapValue) {
              let cleanValue = String(mapValue.value);
              if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
                cleanValue = cleanValue.slice(1, -1);
              }
              return cleanValue;
            } else if (typeof mapValue === "string") {
              return mapValue;
            }
          }
        }
        return e.name;
      }).filter((value) => typeof value === "string" && value !== "undefined");
      enumDeclarations[enumName] = filteredEnumValues;
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
  if (entity.type === "model" && entity.properties && Array.isArray(entity.properties)) {
    const hasIgnore = entity.properties.some(
      (prop) => prop.type === "attribute" && prop.name === "ignore" && prop.kind === "object"
    );
    if (hasIgnore) {
      return [];
    }
  }
  const fields = entity.properties.filter(
    (p) => p.type === "field" && p.array !== true && !p.attributes?.find((a) => a.name === "relation") && !p.attributes?.find((a) => a.name === "ignore")
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
      Comment: field.comment || "",
      // Extract comment from Prisma field
      EnumOptions: enumOptions
    };
  });
}

function extractSqlEntities(config) {
  const sqlPath = config.origin.path;
  const sqlContent = readFileSync(sqlPath, "utf-8");
  const tables = [];
  const views = [];
  const tableDefinitions = /* @__PURE__ */ new Map();
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/gi;
  let match;
  while ((match = tableRegex.exec(sqlContent)) !== null) {
    const tableName = match[1];
    const startIdx = match.index + match[0].length - 1;
    let parenDepth = 1;
    let endIdx = startIdx + 1;
    while (parenDepth > 0 && endIdx < sqlContent.length) {
      if (sqlContent[endIdx] === "(") parenDepth++;
      if (sqlContent[endIdx] === ")") parenDepth--;
      endIdx++;
    }
    if (parenDepth === 0) {
      const columnSection = sqlContent.substring(startIdx + 1, endIdx - 1);
      const columns = parseColumns(columnSection);
      if (columns.length > 0) {
        tables.push(tableName);
        tableDefinitions.set(tableName, {
          name: tableName,
          isView: false,
          columns
        });
      }
    }
  }
  const viewMatches = sqlContent.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?VIEW\s+[`"]?(\w+)[`"]?/gi
  );
  for (const match2 of viewMatches) {
    const viewName = match2[1];
    views.push(viewName);
    const viewColumns = parseViewColumns(sqlContent, match2.index + match2[0].length, tableDefinitions);
    if (viewColumns.length > 0) {
      tableDefinitions.set(viewName, {
        name: viewName,
        isView: true,
        columns: viewColumns
      });
    }
  }
  return { tables, views, tableDefinitions };
}
function parseViewColumns(sqlContent, startPos, tableDefinitions) {
  const columns = [];
  const remainingContent = sqlContent.substring(startPos);
  const asSelectMatch = remainingContent.match(/\s*AS\s+SELECT\s+/i);
  if (!asSelectMatch) return columns;
  const selectStart = asSelectMatch.index + asSelectMatch[0].length;
  const selectContent = remainingContent.substring(selectStart);
  const fromMatch = selectContent.match(/\sFROM\s/i);
  const selectClause = fromMatch ? selectContent.substring(0, fromMatch.index) : selectContent;
  const columnExprs = [];
  let current = "";
  let parenDepth = 0;
  for (let i = 0; i < selectClause.length; i++) {
    const char = selectClause[i];
    if (char === "(") parenDepth++;
    if (char === ")") parenDepth--;
    if (char === "," && parenDepth === 0) {
      columnExprs.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    columnExprs.push(current.trim());
  }
  const prefixToTable = {
    "user_": ["users_data", "ud"],
    "company_": ["rise_entities", "company"],
    "team_": ["rise_entities", "team"],
    "user_relationship_": ["rise_entities", "user_rel"],
    "user_entity_": ["rise_entities", "user_entity"]
  };
  for (const expr of columnExprs) {
    if (!expr) continue;
    const aliasMatch = expr.match(/\s+AS\s+[`"]?([^`"\s,]+)[`"]?\s*$/i);
    if (aliasMatch) {
      const name = aliasMatch[1];
      const sourceRefMatch = expr.match(/^(?:[`"]?([\w_]+)[`"]?\.)?[`"]?([\w_]+)[`"]?\s+AS/i);
      const sourceTable = sourceRefMatch?.[1];
      const sourceCol = sourceRefMatch?.[2];
      let type = "varchar(191)";
      let nullable = true;
      let foundType = false;
      if (sourceTable && sourceCol) {
        const table = tableDefinitions.get(sourceTable);
        if (table) {
          const col = table.columns.find((c) => c.name === sourceCol);
          if (col) {
            type = col.type;
            nullable = col.nullable;
            foundType = true;
          }
        }
      }
      if (!foundType && sourceCol) {
        for (const [prefix, tableNames] of Object.entries(prefixToTable)) {
          if (name.startsWith(prefix)) {
            for (const tableName of tableNames) {
              const table = tableDefinitions.get(tableName);
              if (table) {
                const col = table.columns.find((c) => c.name === sourceCol);
                if (col) {
                  type = col.type;
                  nullable = col.nullable;
                  foundType = true;
                  break;
                }
              }
            }
            if (foundType) break;
          }
        }
      }
      let comment = "";
      if (name === "user_rise_account") {
        comment = "@kysely(UserRiseAccount)";
      } else {
        const nanoidMatch = name.match(/^(\w+)_nanoid$/);
        if (nanoidMatch) {
          const prefix = nanoidMatch[1];
          const brandMap = {
            "user": "UserNanoid",
            "company": "CompanyNanoid",
            "team": "TeamNanoid",
            "document": "DocumentNanoid",
            "template": "TemplateNanoid",
            "entity": "EntityNanoid",
            "payment": "PaymentNanoid",
            "transaction": "TransactionNanoid"
          };
          const brand = brandMap[prefix];
          if (brand) {
            comment = `@kysely(${brand})`;
          }
        }
      }
      columns.push({
        name,
        type,
        nullable,
        defaultValue: null,
        extra: "",
        comment
      });
    } else {
      const colNameMatch = expr.match(/^(?:.*\.)?[`"]?([^`"\s,()]+)[`"]?\s*$/i);
      if (colNameMatch) {
        columns.push({
          name: colNameMatch[1],
          type: "varchar(191)",
          nullable: true,
          defaultValue: null,
          extra: "",
          comment: ""
        });
      }
    }
  }
  return columns;
}
function parseColumns(columnSection) {
  const columns = [];
  const lines = columnSection.split("\n");
  const columnDefs = [];
  let current = "";
  let parenDepth = 0;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("--")) continue;
    for (const char of trimmedLine) {
      if (char === "(") parenDepth++;
      if (char === ")") parenDepth--;
    }
    current += " " + trimmedLine;
    if (parenDepth === 0) {
      if (trimmedLine.endsWith(",")) {
        columnDefs.push(current.trim().slice(0, -1));
        current = "";
      } else if (!trimmedLine.includes("(") && (trimmedLine.match(/,?\s*$/) || trimmedLine.match(/COMMENT\s+'[^']*'\s*,?$/i))) {
        columnDefs.push(current.trim().replace(/,$/, ""));
        current = "";
      }
    }
  }
  if (current.trim()) {
    columnDefs.push(current.trim().replace(/,$/, ""));
  }
  for (const colDef of columnDefs) {
    const trimmed = colDef.trim();
    if (!trimmed) continue;
    if (trimmed.match(/^(PRIMARY\s+KEY|KEY\s|INDEX|UNIQUE\s|FOREIGN\s+KEY|CONSTRAINT|CHECK\s)/i)) {
      continue;
    }
    const colMatch = trimmed.match(/^[`"]?(\w+)[`"]?\s+(.+)$/is);
    if (!colMatch) continue;
    const name = colMatch[1];
    let rest = colMatch[2].trim();
    let type = "";
    if (rest.match(/^(enum|set)\s*\(/i)) {
      let depth = 1;
      let pos = rest.indexOf("(") + 1;
      while (pos < rest.length && depth > 0) {
        if (rest[pos] === "(") depth++;
        if (rest[pos] === ")") depth--;
        pos++;
      }
      type = rest.substring(0, pos).replace(/\s+/g, " ").trim();
      rest = rest.substring(pos).trim();
    } else {
      const typeMatch = rest.match(/^([\w]+(?:\([^)]+\))?)/i);
      if (typeMatch) {
        type = typeMatch[1].trim();
        rest = rest.substring(typeMatch[0].length).trim();
      }
    }
    if (!type) continue;
    const nullable = !rest.match(/NOT\s+NULL/i);
    const extras = [];
    if (rest.match(/AUTO_INCREMENT/i)) extras.push("auto_increment");
    if (rest.match(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/i)) extras.push("on update CURRENT_TIMESTAMP");
    let defaultValue = null;
    const defaultMatch = rest.match(/DEFAULT\s+('(?:[^'\\]|\\.)*'|\S+)/i);
    if (defaultMatch) {
      defaultValue = defaultMatch[1].trim();
      if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
        defaultValue = defaultValue.slice(1, -1);
      }
      const upper = defaultValue.toUpperCase();
      if (upper === "NULL") {
        defaultValue = null;
      } else if (upper.startsWith("CURRENT_TIMESTAMP")) {
        extras.push("DEFAULT_GENERATED");
      }
    }
    let comment = "";
    const commentMatch = rest.match(/COMMENT\s+'((?:[^'\\]|\\.)*)'/i);
    if (commentMatch) {
      comment = commentMatch[1].replace(/\\'/g, "'");
    }
    columns.push({
      name,
      type,
      nullable,
      defaultValue,
      extra: extras.join(" "),
      comment
    });
  }
  return columns;
}
function extractSqlColumnDescriptions(config, tableName, tableDefinitions) {
  const table = tableDefinitions.get(tableName);
  if (!table) return [];
  return table.columns.map((col) => {
    const enumMatch = col.type.match(/enum\s*\(([\s\S]+)\)/i);
    const enumOptions = enumMatch ? enumMatch[1].match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) : void 0;
    const dataType = col.type.split("(")[0].toLowerCase();
    return {
      Field: col.name,
      Type: col.type,
      DataType: dataType,
      Null: col.nullable ? "YES" : "NO",
      Default: col.defaultValue,
      Extra: col.extra,
      Comment: col.comment,
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
  let sqlTableDefinitions = null;
  try {
    if (config.origin.type === "prisma") {
      const prismaEntities = extractPrismaEntities(config);
      tables = prismaEntities.tables;
      views = prismaEntities.views;
      enumDeclarations = prismaEntities.enumDeclarations;
      config.enumDeclarations = enumDeclarations;
    } else if (config.origin.type === "sql") {
      const sqlEntities = extractSqlEntities(config);
      tables = sqlEntities.tables;
      views = sqlEntities.views;
      sqlTableDefinitions = sqlEntities.tableDefinitions;
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
      } else if (config.origin.type === "sql") {
        describes = extractSqlColumnDescriptions(config, entityName, sqlTableDefinitions);
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
        } else if (config.origin.type === "sql") {
          describes = extractSqlColumnDescriptions(config, entityName, sqlTableDefinitions);
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
        const inflectedTable = applyInflection(table, config.inflection);
        const pascalTable = camelCase(inflectedTable, { pascalCase: true }) + (isView ? "View" : "");
        const tableKey = isCamelCase ? camelCase(inflectedTable) : inflectedTable;
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
