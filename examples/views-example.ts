import { generate } from '../src/main.js'

// Example: Generate types for database views
async function generateViewTypes() {
  console.log('🔍 Generating types for database views...')

  // Example with MySQL database that has views
  const result = await generate({
    origin: {
      type: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'ecommerce'
    },
    destinations: [
      {
        type: 'zod',
        folder: './generated/views/zod',
        suffix: 'view-schema'
      },
      {
        type: 'ts',
        folder: './generated/views/types',
        suffix: 'view-types'
      },
      {
        type: 'kysely',
        outFile: './generated/views/kysely/views-db.ts'
      }
    ],
    // Enable views processing
    includeViews: true,
    
    // Optional: specify which views to include
    views: ['user_profile_view', 'order_summary_view', 'product_analytics_view'],
    
    // Optional: ignore certain views
    ignoreViews: ['temp_view', 'debug_view'],
    
    // Convert to camelCase
    camelCase: true,
    
    // Don't process regular tables, only views
    tables: [],
    
    dryRun: true // Just return the content without writing files
  })

  console.log('📁 Generated files:')
  for (const [filename, content] of Object.entries(result)) {
    console.log(`  - ${filename}`)
    console.log(`    Content preview: ${content.substring(0, 100)}...`)
  }
}

// Example with Prisma schema that includes views
async function generatePrismaViewTypes() {
  console.log('🔍 Generating types for Prisma views...')

  const result = await generate({
    origin: {
      type: 'prisma',
      path: './schema.prisma'
    },
    destinations: [
      {
        type: 'zod',
        useDateType: true,
        folder: './generated/prisma-views'
      }
    ],
    includeViews: true,
    dryRun: true
  })

  console.log('📁 Generated Prisma view files:')
  for (const filename of Object.keys(result)) {
    console.log(`  - ${filename}`)
  }
}

// Example Prisma schema with views (for reference)
const examplePrismaSchema = `
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["views"]
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  name    String?
  profile Profile?
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String
  user   User   @relation(fields: [userId], references: [id])
  userId Int    @unique
}

// This is a view - read-only
view UserInfo {
  id    Int
  email String
  name  String?
  bio   String?
}
`

// Example SQL view creation (for reference)
const exampleSQLViews = `
-- User profile view combining user and profile data
CREATE VIEW user_profile_view AS
SELECT 
  u.id,
  u.email,
  u.name,
  p.bio,
  p.avatar_url,
  u.created_at
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id;

-- Order summary view with calculated totals
CREATE VIEW order_summary_view AS
SELECT 
  o.id,
  o.user_id,
  u.email as user_email,
  COUNT(oi.id) as item_count,
  SUM(oi.price * oi.quantity) as total_amount,
  o.status,
  o.created_at
FROM orders o
JOIN users u ON o.user_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id;

-- Product analytics view with aggregated data
CREATE VIEW product_analytics_view AS
SELECT 
  p.id,
  p.name,
  p.category,
  COUNT(oi.id) as times_ordered,
  SUM(oi.quantity) as total_quantity_sold,
  AVG(oi.price) as average_price,
  MAX(o.created_at) as last_ordered_at
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id
GROUP BY p.id;
`

if (import.meta.main) {
  try {
    await generateViewTypes()
    console.log('\n' + '='.repeat(50))
    await generatePrismaViewTypes()
    
    console.log('\n📝 Example Prisma schema with views:')
    console.log(examplePrismaSchema)
    
    console.log('\n📝 Example SQL views:')
    console.log(exampleSQLViews)
    
  } catch (error) {
    console.error('❌ Error:', error)
  }
}
