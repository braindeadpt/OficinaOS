// creates (or resets) a throwaway "demo" OWNER user for screenshots/QA.
// delete after use: DELETE FROM users WHERE username='demo' (cascades).
import { PrismaPg } from "@prisma/adapter-pg";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4000",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: "string", required: true, defaultValue: "FRONT_DESK", input: false },
      isActive: { type: "boolean", required: true, defaultValue: true, input: false },
      mustChangePassword: { type: "boolean", required: true, defaultValue: false, input: false },
    },
  },
  plugins: [username()],
});

const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo-shot-2026";

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: DEMO_USERNAME } });
  if (existing) {
    console.log("demo user already exists — delete first if resetting");
    return;
  }
  const result = await auth.api.signUpEmail({
    body: {
      username: DEMO_USERNAME,
      email: "demo@oficinaos.local",
      password: DEMO_PASSWORD,
      name: "Demo",
    },
  });
  await prisma.user.update({
    where: { id: result.user.id },
    data: { role: "OWNER", mustChangePassword: false },
  });
  console.log(`demo user created: ${result.user.username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
