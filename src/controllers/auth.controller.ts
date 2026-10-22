import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { email, password, str, matricNo, body } from "../lib/validation.ts";
// Must precede the db client: it installs the Temporal polyfill Prisma 8 needs.
import { now } from "../lib/temporal.ts";
import { db } from "../prisma/db.ts";
import { signToken } from "../lib/auth.ts";
import { asyncHandler, conflict, notFound, unauthorized } from "../lib/http.ts";
import { config } from "../config.ts";

export const registerUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = body(req.body);
  const cleanEmail = email(b.email);
  const cleanPassword = password(b.password);
  const fullName = str(b.fullname, "Full Name", { required: true, min: 2, max: 100 })!;
  const cleanMatricNo = matricNo(b.matricNo, false);

  // Check existing email
  const existingEmail = await db.orm.public.User.where({ email: cleanEmail }).first();
  if (existingEmail) {
    throw conflict("An account with this email already exists");
  }

  // Check existing matricNo if provided
  if (cleanMatricNo) {
    const existingMatric = await db.orm.public.User.where({ matricNo: cleanMatricNo }).first();
    if (existingMatric) {
      throw conflict("An account with this Matric No already exists");
    }
  }

  // Hash password asynchronously to not block the event loop (M1)
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(cleanPassword, salt);

  // Create user
  const user = await db.orm.public.User.create({
    email: cleanEmail,
    passwordHash: hashedPassword,
    fullName,
    matricNo: cleanMatricNo || null,
    role: "VOTER",
  });

  const token = signToken(user.id);

  res.cookie("token", token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.status(201).json({
    message: "User registered successfully",
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      matricNo: user.matricNo,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

export const loginUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = body(req.body);
  const identifier = str(b.identifier, "Email / Matric No", { required: true, max: 254 })!;
  const rawPassword = str(b.password, "Password", { required: true, max: 72 })!;

  const cleanEmailOrMatric = identifier.trim();

  // Try finding user by email (lowercase) or matricNo (uppercase)
  let user = await db.orm.public.User.where({ email: cleanEmailOrMatric.toLowerCase() }).first();
  if (!user) {
    user = await db.orm.public.User.where({ matricNo: cleanEmailOrMatric.toUpperCase() }).first();
  }

  if (!user) {
    throw unauthorized("Invalid credentials");
  }

  const isPasswordValid = await bcrypt.compare(rawPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw unauthorized("Invalid credentials");
  }

  const token = signToken(user.id);

  res.cookie("token", token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    message: "Login successful",
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      matricNo: user.matricNo,
      role: user.role,
    },
  });
});

export const getCurrentUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw unauthorized("Unauthorized");
  }

  const user = await db.orm.public.User.where({ id: req.user.userId }).first();
  if (!user) {
    throw notFound("User not found");
  }

  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      matricNo: user.matricNo,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

export const logoutUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // Revoke token on the server side (Fix H6). Persisted on the user row so the
  // sign-out outlives this process: every token issued before this instant is
  // refused by authenticate, wherever it is presented.
  if (req.user?.userId) {
    await db.orm.public.User.where({ id: req.user.userId }).update({
      tokensRevokedAt: now() as never,
    });
  }

  res.clearCookie("token", {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
  });
  res.status(200).json({ message: "Logged out successfully" });
});
