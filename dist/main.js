import * as path from 'node:path';
import camelCase from 'camelcase';
import { writeFile } from 'node:fs/promises';
import { ensureDir } from 'fs-extra/esm';
import pluralize from 'pluralize';
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
  mysql: [
    "date",
    "datetime",
    "datetime(3)",
    "timestamp",
    "timestamp(3)"
  ],
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
    "integer",
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
const enumRegex = /enum\(([^)]+)\)/i;
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
    const shouldBeOptional = op === "insertable" && (hasDefaultValue || isGenerated) || op === "updateable";
    if (isZodDestination) {
      const nullishOption = destination.nullish;
      const nullableMethod = nullishOption && op !== "selectable" ? "nullish" : "nullable";
      if ((op === "table" || op === "insertable" || op === "updateable") && hasDefaultValue && Default !== null && !isGenerated) {
        let defaultValueFormatted = Default;
        if (typeMappings.stringTypes.includes(dataType) || typeMappings.dateTypes.includes(dataType)) {
          defaultValueFormatted = `'${Default}'`;
        } else if (typeMappings.booleanTypes.includes(dataType)) {
          const normalizedDefault = Default.toLowerCase();
          defaultValueFormatted = normalizedDefault === "true" || normalizedDefault === "1" ? "true" : "false";
        } else if (typeMappings.numberTypes.includes(dataType)) {
          defaultValueFormatted = Default;
        } else {
          defaultValueFormatted = `'${Default}'`;
        }
        if (shouldBeNullable && shouldBeOptional) {
          return `${overrideType}.${nullableMethod}().default(${defaultValueFormatted})`;
        } else if (shouldBeNullable) {
          return `${overrideType}.${nullableMethod}().default(${defaultValueFormatted})`;
        } else if (shouldBeOptional) {
          return `${overrideType}.optional().default(${defaultValueFormatted})`;
        } else {
          return `${overrideType}.default(${defaultValueFormatted})`;
        }
      }
      if (shouldBeNullable) {
        return `${overrideType}.${nullableMethod}()`;
      } else if (shouldBeOptional) {
        return `${overrideType}.optional()`;
      } else {
        return overrideType;
      }
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
  return generateStandardType(
    op,
    desc,
    config,
    destination,
    typeMappings,
    dataType
  );
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
        if (!(hasDefaultValue || shouldBeNullable)) {
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
      if (requiredString && !shouldBeNullable && op !== "selectable" && !hasDefaultValue)
        baseType += ".min(1)";
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
        const normalizedDefault = Default.toLowerCase();
        defaultValueFormatted = normalizedDefault === "true" || normalizedDefault === "1" ? "true" : "false";
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
      const restOfContent = sqlContent.substring(endIdx);
      const semicolonIdx = restOfContent.indexOf(";");
      const afterParen = semicolonIdx >= 0 ? restOfContent.substring(0, semicolonIdx) : restOfContent.substring(0, 500);
      if (afterParen.match(/COMMENT\s*=\s*'[^']*@@ignore[^']*'/i)) {
        continue;
      }
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
    const viewColumns = parseViewColumns(
      sqlContent,
      match2.index + match2[0].length,
      tableDefinitions
    );
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
    user_: ["users_data", "ud"],
    company_: ["rise_entities", "company"],
    team_: ["rise_entities", "team"],
    user_relationship_: ["rise_entities", "user_rel"],
    user_entity_: ["rise_entities", "user_entity"]
  };
  for (let i = 0; i < columnExprs.length; i++) {
    let expr = columnExprs[i];
    if (!expr) continue;
    let inlineComment = "";
    const endCommentMatch = expr.match(/--\s*(.+)$/);
    if (endCommentMatch) {
      inlineComment = endCommentMatch[1].trim();
      expr = expr.replace(/--\s*.+$/, "").trim();
    }
    const startCommentMatch = expr.match(/^--\s*(.+?)\n/);
    if (startCommentMatch && !inlineComment) {
      inlineComment = startCommentMatch[1].trim();
      expr = expr.replace(/^--\s*.+?\n/, "").trim();
    }
    const nextExpr = columnExprs[i + 1];
    if (nextExpr && !inlineComment) {
      const nextStartCommentMatch = nextExpr.match(/^--\s*(.+?)(?:\n|$)/);
      if (nextStartCommentMatch) {
        inlineComment = nextStartCommentMatch[1].trim();
        columnExprs[i + 1] = nextExpr.replace(/^--\s*.+?(?:\n|$)/, "").trim();
      }
    }
    const aliasMatch = expr.match(/\s+AS\s+[`"]?([^`"\s,]+)[`"]?\s*(?:--.*)?$/i);
    if (aliasMatch) {
      const name = aliasMatch[1];
      const exprWithoutComment = expr.replace(/--.*$/, "");
      const sourceRefMatch = exprWithoutComment.match(
        /^(?:[`"]?([\w_]+)[`"]?\.)?[`"]?([\w_]+)[`"]?\s+AS/i
      );
      const sourceTable = sourceRefMatch?.[1];
      const sourceCol = sourceRefMatch?.[2];
      let type = "varchar(191)";
      let nullable = true;
      let foundType = false;
      let sourceColumnComment = "";
      if (sourceTable && sourceCol) {
        const table = tableDefinitions.get(sourceTable);
        if (table) {
          const col = table.columns.find((c) => c.name === sourceCol);
          if (col) {
            type = col.type;
            nullable = col.nullable;
            sourceColumnComment = col.comment;
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
                  sourceColumnComment = col.comment;
                  foundType = true;
                  break;
                }
              }
            }
            if (foundType) break;
          }
        }
      }
      if (!foundType && sourceCol) {
        for (const prefix of Object.keys(prefixToTable)) {
          if (name.startsWith(prefix)) {
            prefix.slice(0, -1);
            const potentialTableNames = [
              prefix.slice(0, -1),
              // e.g., 'team'
              prefix.slice(0, -1) + "s"
              // e.g., 'teams'
            ];
            for (const tableName of potentialTableNames) {
              const table = tableDefinitions.get(tableName);
              if (table) {
                const col = table.columns.find((c) => c.name === sourceCol);
                if (col) {
                  type = col.type;
                  nullable = col.nullable;
                  sourceColumnComment = col.comment;
                  foundType = true;
                  break;
                }
              }
            }
            if (foundType) break;
          }
        }
      }
      let comment = sourceColumnComment;
      if (inlineComment) {
        comment = inlineComment;
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
    if (trimmed.match(
      /^(PRIMARY\s+KEY|KEY\s|INDEX|UNIQUE\s|FOREIGN\s+KEY|CONSTRAINT|CHECK\s)/i
    )) {
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
    if (rest.match(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/i))
      extras.push("on update CURRENT_TIMESTAMP");
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
    if (comment.match(/@ignore/)) {
      continue;
    }
    if (type.match(/^(enum|set)\s*\(/i) && comment.match(/@(kysely|ts|zod)\s*\(/)) {
      throw new Error(
        `Magic comments are not supported on enum/set columns. Column "${name}" has type "${type}" with comment "${comment}". Remove the magic comment - enum types are automatically generated by mutano.`
      );
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
