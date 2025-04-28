import { describe, test } from "vitest";
import { type Config, type Desc, getType } from "./main.js";

describe("getType", () => {
	const mysqlConfig: Config = {
		origin: {
			type: "mysql",
			host: "localhost",
			port: 3306,
			user: "root",
			password: "password",
			database: "rise",
			overrideTypes: {
				json: "z.record(z.string())",
			},
		},
		camelCase: true,
		nullish: true,
		requiredString: true,
		useDateType: true,
		magicComments: true,
	};

	const postgresConfig: Config = {
		origin: {
			type: "postgres",
			host: "localhost",
			port: 5432,
			user: "postgres",
			password: "password",
			database: "rise",
			schema: "public",
			overrideTypes: {
				jsonb: "z.record(z.string())",
			},
		},
		camelCase: true,
		nullish: true,
		requiredString: true,
		useDateType: true,
		magicComments: true,
	};

	const sqliteConfig: Config = {
		origin: {
			type: "sqlite",
			path: ":memory:",
			overrideTypes: {
				json: "z.record(z.string())",
			},
		},
		camelCase: true,
		nullish: true,
		requiredString: true,
		useDateType: true,
		magicComments: true,
	};

	test("should return a custom Zod date field for date, datetime, and timestamp types", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: null,
			Extra: "",
			Null: "NO",
			Type: "date",
			Field: "date",
			Comment: "",
		};
		const result = getType("table", desc, mysqlConfig);
		expect(result).toEqual(
			"z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())",
		);
	});

	test("should return a Zod string field for text, mediumtext, longtext, json, decimal, time, year, char, and varchar types", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: null,
			Extra: "",
			Null: "NO" as const,
			Type: "varchar",
			Field: "varchar",
			Comment: "",
		};
		const result = getType("table", desc, mysqlConfig);
		expect(result).toEqual("z.string().min(1)");
	});

	test("should return a Zod string with trim() if useTrim is true", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: null,
			Extra: "",
			Null: "NO" as const,
			Type: "varchar",
			Field: "varchar",
			Comment: "",
		};
		const result = getType("table", desc, { ...mysqlConfig, useTrim: true });
		expect(result).toEqual("z.string().trim().min(1)");
	});

	test("should return a custom Zod boolean field for tinyint types", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: "0",
			Extra: "",
			Null: "NO",
			Field: "tinyint",
			Type: "tinyint",
			Comment: "",
		};
		const result = getType("table", desc, mysqlConfig);
		expect(result).toEqual(
			"z.union([z.number(),z.string(),z.boolean()]).pipe(z.coerce.boolean()).optional().default(false)",
		);
	});

	test("should return a Zod number field for smallint, mediumint, int, bigint, float, and double types", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: "0",
			Extra: "",
			Null: "NO",
			Field: "int",
			Type: "int",
			Comment: "",
		};
		const result = getType("table", desc, mysqlConfig);
		expect(result).toEqual("z.number().optional().default(0)");
	});

	test("should return a Zod enum field for enum types", ({ expect }) => {
		const desc: Desc = {
			Default: "foo",
			Extra: "",
			Null: "NO",
			Field: "enum",
			Type: "enum('foo', 'bar', 'baz')",
			Comment: "",
		};
		const result = getType("table", desc, mysqlConfig);
		expect(result).toEqual(
			"z.enum(['foo', 'bar', 'baz']).optional().default('foo')",
		);
	});

	test("should return undefined for insertable and updateable fields that are not null and have a default value", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: "CURRENT_TIMESTAMP",
			Extra: "DEFAULT_GENERATED",
			Null: "NO",
			Field: "timestamp",
			Type: "timestamp",
			Comment: "",
		};
		let result = getType("insertable", desc, mysqlConfig);
		expect(result).toEqual(undefined);
		result = getType("updateable", desc, mysqlConfig);
		expect(result).toEqual(undefined);
	});

	test("should override a field type if a @zod commment exists on the column", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: "0",
			Extra: "",
			Null: "NO",
			Field: "int",
			Type: "int",
			Comment: "@ts(Foo) @zod(z.number().nonnegative().min(10))",
		};
		const result = getType("table", desc, mysqlConfig);
		expect(result).toEqual(
			"z.number().nonnegative().min(10).optional().default(0)",
		);
	});

	test("should override a field type if a overrideTypes config exists on the column", ({
		expect,
	}) => {
		const desc: Desc = {
			Default: "{}",
			Extra: "",
			Null: "NO",
			Field: "json",
			Type: "json",
			Comment: "",
		};
		const result = getType("table", desc, mysqlConfig);
		expect(result).toEqual("z.record(z.string()).optional().default('{}')");
	});

	test("should throw an error for unsupported column types", ({ expect }) => {
		const desc: Desc = {
			Default: null,
			Extra: "",
			Null: "NO",
			Field: "unsupported",
			Type: "unsupported",
			Comment: "",
		};
		expect(() => getType("table", desc, mysqlConfig)).toThrowError(
			"Unsupported column type: unsupported",
		);
	});

	// PostgreSQL specific tests
	test("should handle PostgreSQL boolean type", ({ expect }) => {
		const desc: Desc = {
			Default: "true",
			Extra: "",
			Null: "NO",
			Field: "active",
			Type: "boolean",
			Comment: "",
		};
		const result = getType("table", desc, postgresConfig);
		expect(result).toEqual(
			"z.union([z.number(),z.string(),z.boolean()]).pipe(z.coerce.boolean()).optional().default(true)",
		);
	});

	test("should handle PostgreSQL jsonb type with override", ({ expect }) => {
		const desc: Desc = {
			Default: "{}",
			Extra: "",
			Null: "NO",
			Field: "data",
			Type: "jsonb",
			Comment: "",
		};
		const result = getType("table", desc, postgresConfig);
		expect(result).toEqual("z.record(z.string()).optional().default('{}')");
	});

	test("should handle PostgreSQL timestamp types", ({ expect }) => {
		const desc: Desc = {
			Default: null,
			Extra: "",
			Null: "NO",
			Field: "created_at",
			Type: "timestamp with time zone",
			Comment: "",
		};
		const result = getType("table", desc, postgresConfig);
		expect(result).toEqual(
			"z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())",
		);
	});

	test("should handle PostgreSQL USER-DEFINED enum type", ({ expect }) => {
		const desc: Desc = {
			Default: "admin",
			Extra: "",
			Null: "NO",
			Field: "role",
			Type: "USER-DEFINED",
			EnumOptions: ["admin", "user", "guest"],
			Comment: "",
		};
		const result = getType("table", desc, postgresConfig);
		expect(result).toEqual(
			"z.enum(['admin','user','guest']).optional().default('admin')",
		);
	});

	// SQLite specific tests
	test("should handle SQLite integer type", ({ expect }) => {
		const desc: Desc = {
			Default: "42",
			Extra: "",
			Null: "NO",
			Field: "id",
			Type: "integer",
			Comment: "",
		};
		const result = getType("table", desc, sqliteConfig);
		expect(result).toEqual("z.number().optional().default(42)");
	});

	test("should handle SQLite text type", ({ expect }) => {
		const desc: Desc = {
			Default: null,
			Extra: "",
			Null: "NO",
			Field: "name",
			Type: "text",
			Comment: "",
		};
		const result = getType("table", desc, sqliteConfig);
		expect(result).toEqual("z.string().min(1)");
	});

	test("should handle SQLite datetime type", ({ expect }) => {
		const desc: Desc = {
			Default: null,
			Extra: "",
			Null: "NO",
			Field: "created_at",
			Type: "datetime",
			Comment: "",
		};
		const result = getType("table", desc, sqliteConfig);
		expect(result).toEqual(
			"z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())",
		);
	});

	test("should handle SQLite boolean type", ({ expect }) => {
		const desc: Desc = {
			Default: "1",
			Extra: "",
			Null: "NO",
			Field: "active",
			Type: "boolean",
			Comment: "",
		};
		const result = getType("table", desc, sqliteConfig);
		expect(result).toEqual(
			"z.union([z.number(),z.string(),z.boolean()]).pipe(z.coerce.boolean()).optional().default(true)",
		);
	});
});
