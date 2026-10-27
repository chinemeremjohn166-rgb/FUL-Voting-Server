// Creates the one account the API cannot make for itself: the administrator.
// Registration always yields a VOTER, so without this row nobody can open,
// close or publish an election.
//
//   node ./scripts/seed.ts            create the admin if the email is new
//   node ./scripts/seed.ts --reset    also set this password and role on it
//
// Nothing else is touched: no elections, no positions, no voters, no ballots.

// Must come before the db client: it installs the Temporal values Prisma 8 maps
// DateTime columns to.
import "../src/lib/temporal.ts";
import bcrypt from "bcrypt";
import { db } from "../src/prisma/db.ts";

const EMAIL = "admin@voting.test";
const PASSWORD = "Admin#2026";
const FULL_NAME = "Chief Electoral Officer";
const MATRIC_NO = "SCI/2020/001";

const RESET = process.argv.includes("--reset");

async function main(): Promise<void> {
  // Satisfies the API's own password rule: 8-72 characters with an upper, a
  // lower, a digit and a special character. Change it before any real use.
  const existing = await db.orm.public.User.where({ email: EMAIL }).first();

  if (!existing) {
    await db.orm.public.User.create({
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      fullName: FULL_NAME,
      matricNo: MATRIC_NO,
      role: "ADMIN",
      isVerified: true,
    });
    console.log(`Created ${EMAIL} (ADMIN).`);
    return;
  }

  if (!RESET) {
    console.log(`${EMAIL} already exists and was left alone (role ${existing.role}).`);
    console.log("Its password is whatever it was set to. Run with --reset to set it to the one in this file.");
    return;
  }

  await db.orm.public.User.where({ email: EMAIL }).update({
    passwordHash: await bcrypt.hash(PASSWORD, 10),
    role: "ADMIN",
    isVerified: true,
  });
  console.log(`Reset ${EMAIL}: role ADMIN, password from this file, matric ${existing.matricNo}.`);
}

await main();
await db.close();
