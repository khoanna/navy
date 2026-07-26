import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    // `pnpm prisma db seed` runs this. seed.mjs loads .env itself, so a bare
    // `node prisma/seed.mjs` also works (config.ts loads no dotenv — see CLAUDE.md).
    seed: 'node prisma/seed.mjs',
  },
});
