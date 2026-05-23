import { sql } from "drizzle-orm";

import { createOperationsDb, managerUsers } from "@granit/db";

import {
  isManagerRole,
  isManagerUserStatus,
  normalizeManagerEmail,
  type ManagerRole,
  type ManagerUserStatus
} from "../modules/auth/repositories/manager-auth-repository.js";

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
const email = args.email ? normalizeManagerEmail(args.email) : "";
const role = args.role ?? "owner";
const status = args.status ?? "invited";

if (!databaseUrl) {
  fail("DATABASE_URL is required");
}

if (!email || !email.includes("@")) {
  fail("Usage: npm run seed:manager-user -- --email user@yandex.ru --role owner");
}

if (!isManagerRole(role)) {
  fail("Role must be one of: owner, manager, viewer");
}

if (!isManagerUserStatus(status)) {
  fail("Status must be one of: invited, active, disabled");
}

const { db, client } = createOperationsDb(databaseUrl);

try {
  const [existing] = await db
    .select()
    .from(managerUsers)
    .where(sql`lower(${managerUsers.email}) = ${email}`)
    .limit(1);

  const row = existing
    ? await updateExistingUser(existing.id, email, role, status)
    : await insertNewUser(email, role, status);

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status
      },
      null,
      2
    )
  );
} finally {
  await client.end({ timeout: 5 });
}

async function insertNewUser(email: string, role: ManagerRole, status: ManagerUserStatus) {
  const [row] = await db
    .insert(managerUsers)
    .values({
      email,
      role,
      status
    })
    .returning();

  if (!row) {
    throw new Error("manager user insert returned no row");
  }

  return row;
}

async function updateExistingUser(
  id: string,
  email: string,
  role: ManagerRole,
  status: ManagerUserStatus
) {
  const [row] = await db
    .update(managerUsers)
    .set({
      email,
      role,
      status,
      updatedAt: new Date()
    })
    .where(sql`${managerUsers.id} = ${id}`)
    .returning();

  if (!row) {
    throw new Error("manager user update returned no row");
  }

  return row;
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | undefined> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg?.startsWith("--")) {
      continue;
    }

    parsed[arg.slice(2)] = argv[index + 1];
    index += 1;
  }

  return parsed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
