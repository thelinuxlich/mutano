import { describe, expect, test } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../main.js'
import { hasViewsEnabled } from '../database/prisma.js'

describe('Prisma multi-file schema paths', () => {
  test('should read all .prisma files when origin.path points to a directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'mutano-prisma-multi-file-'))
    const schemaDir = join(tempDir, 'schema')
    const modelsDir = join(schemaDir, 'models')

    await mkdir(modelsDir, { recursive: true })

    await writeFile(
      join(schemaDir, 'schema.prisma'),
      `
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["views"]
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  ADMIN
  USER
}
`,
    )

    await writeFile(
      join(modelsDir, 'user.prisma'),
      `
model User {
  id    Int      @id @default(autoincrement())
  email String   @unique
  role  UserRole @default(USER)
  posts Post[]
}
`,
    )

    await writeFile(
      join(modelsDir, 'post.prisma'),
      `
model Post {
  id       Int     @id @default(autoincrement())
  title    String
  authorId Int
  author   User    @relation(fields: [authorId], references: [id])
}

view UserPostCount {
  userId    Int
  postCount Int
}
`,
    )

    try {
      const config = {
        origin: {
          type: 'prisma' as const,
          path: schemaDir,
        },
        destinations: [
          {
            type: 'zod' as const,
          },
        ],
        includeViews: true,
        dryRun: true,
      }

      const result = await generate(config)

      expect(Object.keys(result)).toEqual(
        expect.arrayContaining(['User.zod.ts', 'Post.zod.ts', 'UserPostCount.zod.ts']),
      )
      expect(result['User.zod.ts']).toContain("role: z.enum(['ADMIN','USER'])")
      expect(result['Post.zod.ts']).toContain('title: z.string()')
      expect(result['UserPostCount.zod.ts']).toContain('postCount: z.number()')
      expect(hasViewsEnabled(config)).toBe(true)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
