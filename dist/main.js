import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPrismaSchemaBuilder
} from "@mrleebo/prisma-ast";
import camelCase from "camelcase";
import fs from "fs-extra";
import knex from "knex";
function extractZodExpression(comment) {
  const zodStart = comment.indexOf("@zod(");
  if (zodStart === -1)
    return null;
  let openParens = 0;
  let position = zodStart + 5;
  while (position < comment.length) {
    if (comment[position] === "(") {
      openParens++;
    } else if (comment[position] === ")") {
      if (openParens === 0) {
        return comment.substring(zodStart + 5, position);
      }
      openParens--;
    }
    position++;
  }
  return null;
}
const prismaValidTypes = [
  "BigInt",
  "Boolean",
  "Bytes",
  "DateTime",
  "Decimal",
  "Float",
  "Int",
  "Json",
  "String",
  "Enum"
];
const dateTypes = {
  mysql: ["date", "datetime", "timestamp"],
  prisma: ["DateTime"]
};
const stringTypes = {
  mysql: [
    "tinytext",
    "text",
    "mediumtext",
    "longtext",
    "json",
    "decimal",
    "time",
    "year",
    "char",
    "varchar"
  ],
  prisma: ["String", "Decimal", "BigInt", "Bytes", "Json"]
};
const numberTypes = {
  mysql: ["smallint", "mediumint", "int", "bigint", "float", "double"],
  prisma: ["Int", "Float"]
};
const booleanTypes = { mysql: ["tinyint"], prisma: ["Boolean"] };
const enumTypes = { mysql: ["enum"], prisma: ["Enum"] };
function getType(op, desc, config) {
  const schemaType = config.origin.type;
  const { Default, Extra, Null, Type, Comment, EnumOptions } = desc;
  const isNullish = config.nullish && config.nullish === true;
  const isTrim = config.useTrim && config.useTrim === true && op !== "selectable";
  const hasDefaultValue = Default !== null && op !== "selectable";
  const isGenerated = ["DEFAULT_GENERATED", "auto_increment"].includes(Extra);
  const isNull = Null === "YES";
  if (isGenerated && !isNull && ["insertable", "updateable"].includes(op))
    return;
  const isRequiredString = config.requiredString && config.requiredString === true && op !== "selectable";
  const isUseDateType = config.useDateType && config.useDateType === true;
  const type = Type.split("(")[0].split(" ")[0];
  const zDate = [
    "z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())"
  ];
  const string = [isTrim ? "z.string().trim()" : "z.string()"];
  const number = ["z.number()"];
  const boolean = [
    "z.union([z.number(),z.string(),z.boolean()]).pipe(z.coerce.boolean())"
  ];
  const dateField = isUseDateType ? zDate : string;
  const nullable = isNullish && op !== "selectable" ? "nullish()" : "nullable()";
  const optional = "optional()";
  const nonnegative = "nonnegative()";
  const isUpdateableFormat = op === "updateable" && !isNull && !hasDefaultValue;
  const min1 = "min(1)";
  const zodOverrideType = config.zodCommentTypes ? extractZodExpression(Comment) : null;
  const typeOverride = zodOverrideType ?? config.overrideTypes?.[type];
  const generateDateLikeField = () => {
    const field = typeOverride ? [typeOverride] : dateField;
    if (isNull && !typeOverride)
      field.push(nullable);
    else if (hasDefaultValue)
      field.push(optional);
    if (hasDefaultValue && !isGenerated)
      field.push(`default('${Default}')`);
    if (isUpdateableFormat)
      field.push(optional);
    return field.join(".");
  };
  const generateStringLikeField = () => {
    const field = typeOverride ? [typeOverride] : string;
    if (isNull && !typeOverride)
      field.push(nullable);
    else if (hasDefaultValue)
      field.push(optional);
    else if (isRequiredString && !typeOverride)
      field.push(min1);
    if (hasDefaultValue && !isGenerated)
      field.push(`default('${Default}')`);
    if (isUpdateableFormat)
      field.push(optional);
    return field.join(".");
  };
  const generateBooleanLikeField = () => {
    const field = typeOverride ? [typeOverride] : boolean;
    if (isNull && !typeOverride)
      field.push(nullable);
    else if (hasDefaultValue)
      field.push(optional);
    if (hasDefaultValue && !isGenerated)
      field.push(`default(${Boolean(+Default)})`);
    if (isUpdateableFormat)
      field.push(optional);
    return field.join(".");
  };
  const generateNumberLikeField = () => {
    const unsigned = Type.endsWith(" unsigned");
    const field = typeOverride ? [typeOverride] : number;
    if (unsigned && !typeOverride)
      field.push(nonnegative);
    if (isNull && !typeOverride)
      field.push(nullable);
    else if (hasDefaultValue)
      field.push(optional);
    if (hasDefaultValue && !isGenerated)
      field.push(`default(${Default})`);
    if (isUpdateableFormat)
      field.push(optional);
    return field.join(".");
  };
  const generateEnumLikeField = () => {
    const value = schemaType === "mysql" ? Type.replace("enum(", "").replace(")", "").replace(/,/g, ",") : EnumOptions?.map((e) => `'${e}'`).join(",");
    const field = [`z.enum([${value}])`];
    if (isNull)
      field.push(nullable);
    else if (hasDefaultValue)
      field.push(optional);
    if (hasDefaultValue && !isGenerated)
      field.push(`default('${Default}')`);
    if (isUpdateableFormat)
      field.push(optional);
    return field.join(".");
  };
  if (dateTypes[schemaType].includes(type))
    return generateDateLikeField();
  if (stringTypes[schemaType].includes(type))
    return generateStringLikeField();
  if (numberTypes[schemaType].includes(type))
    return generateNumberLikeField();
  if (booleanTypes[schemaType].includes(type))
    return generateBooleanLikeField();
  if (enumTypes[schemaType].includes(type))
    return generateEnumLikeField();
  throw new Error(`Unsupported column type: ${type}`);
}
async function generate(config) {
  let tables = [];
  let prismaTables = [];
  let schema = null;
  const db = config.origin.type === "mysql" ? knex({
    client: "mysql2",
    connection: {
      host: config.origin.host,
      port: config.origin.port,
      user: config.origin.user,
      password: config.origin.password,
      database: config.origin.database,
      ssl: config.ssl
    }
  }) : null;
  const isCamelCase = config.camelCase && config.camelCase === true;
  if (config.origin.type === "prisma") {
    const schemaContents = readFileSync(config.origin.path).toString();
    schema = createPrismaSchemaBuilder(schemaContents);
    prismaTables = schema.findAllByType("model", {});
    tables = prismaTables.filter((t) => t !== null).map((table) => table.name);
  } else {
    const t = await db.raw(
      "SELECT table_name as table_name FROM information_schema.tables WHERE table_schema = ?",
      [config.origin.database]
    );
    tables = t[0].map((row) => row.table_name).sort();
  }
  const dests = [];
  const includedTables = config.tables;
  if (includedTables?.length)
    tables = tables.filter((table) => includedTables.includes(table));
  const allIgnoredTables = config.ignore;
  const ignoredTablesRegex = allIgnoredTables?.filter((ignoreString) => {
    return ignoreString.startsWith("/") && ignoreString.endsWith("/");
  });
  const ignoredTableNames = allIgnoredTables?.filter(
    (table) => !ignoredTablesRegex?.includes(table)
  );
  if (ignoredTableNames?.length)
    tables = tables.filter((table) => !ignoredTableNames.includes(table));
  if (ignoredTablesRegex?.length) {
    tables = tables.filter((table) => {
      let useTable = true;
      for (const text of ignoredTablesRegex) {
        const pattern = text.substring(1, text.length - 1);
        if (table.match(pattern) !== null)
          useTable = false;
      }
      return useTable;
    });
  }
  let describes = [];
  for (let table of tables) {
    if (config.origin.type === "mysql") {
      const d = await db.raw(`SHOW FULL COLUMNS FROM ${table}`);
      describes = d[0];
    } else {
      const prismaTable = prismaTables.find((t) => t?.name === table);
      let enumOptions;
      describes = prismaTable.properties.filter((p) => p.type === "field").map((field) => {
        const defaultValueField = field.attributes ? field.attributes.find((a) => a.name === "default") : null;
        const defaultValue = defaultValueField?.args?.[0].value;
        const parsedDefaultValue = !!defaultValue && typeof defaultValue !== "object" ? defaultValue.toString() : null;
        let fieldType = field.fieldType.toString();
        if (!prismaValidTypes.includes(fieldType)) {
          fieldType = "Enum";
          enumOptions = schema.findAllByType("enum", {
            name: fieldType
          })[0]?.enumerators.filter(
            (e) => e.type === "enumerator"
          ).map((e) => e.name);
        }
        return {
          Field: field.name,
          Default: parsedDefaultValue,
          EnumOptions: enumOptions,
          Extra: defaultValue ? "DEFAULT_GENERATED" : "",
          Type: field.fieldType.toString(),
          Null: field.optional ? "YES" : "NO",
          Comment: field.comment ?? ""
        };
      });
    }
    if (isCamelCase)
      table = camelCase(table);
    let content = `import { z } from 'zod'

export const ${table} = z.object({`;
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const type = getType("table", desc, config);
      if (type) {
        content = `${content}
	${field}: ${type},`;
      }
    }
    content = `${content}
})

export const insertable_${table} = z.object({`;
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const type = getType("insertable", desc, config);
      if (type) {
        content = `${content}
  ${field}: ${type},`;
      }
    }
    content = `${content}
})

export const updateable_${table} = z.object({`;
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const type = getType("updateable", desc, config);
      if (type) {
        content = `${content}
  ${field}: ${type},`;
      }
    }
    content = `${content}
})

export const selectable_${table} = z.object({`;
    for (const desc of describes) {
      const field = isCamelCase ? camelCase(desc.Field) : desc.Field;
      const type = getType("selectable", desc, config);
      if (type) {
        content = `${content}
  ${field}: ${type},`;
      }
    }
    content = `${content}
})

export type ${camelCase(`${table}Type`, {
      pascalCase: true
    })} = z.infer<typeof ${table}>
export type Insertable${camelCase(`${table}Type`, {
      pascalCase: true
    })} = z.infer<typeof insertable_${table}>
export type Updateable${camelCase(`${table}Type`, {
      pascalCase: true
    })} = z.infer<typeof updateable_${table}>
export type Selectable${camelCase(`${table}Type`, {
      pascalCase: true
    })} = z.infer<typeof selectable_${table}>
`;
    const dir = config.folder && config.folder !== "" ? config.folder : ".";
    const file = config.suffix && config.suffix !== "" ? `${table}.${config.suffix}.ts` : `${table}.ts`;
    const dest = path.join(dir, file);
    dests.push(dest);
    if (!config.silent)
      console.log("Created:", dest);
    fs.outputFileSync(dest, content);
  }
  if (config.origin.type === "mysql") {
    await db.destroy();
  }
  return dests;
}
export {
  generate,
  getType
};
