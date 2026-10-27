import type { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { email, password, str, matricNo, body } from "../lib/validation.ts";
// Must precede the db client: it installs the Temporal polyfill Prisma 8 needs.
import { now, toEpochMs } from "../lib/temporal.ts";
import { db } from "../prisma/db.ts";
import { signToken } from "../lib/auth.ts";
import { asyncHandler, badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/http.ts";
import { generateVerificationCode, sendVerificationEmail } from "../lib/email.ts";
import { config } from "../config.ts";

const codesMatch = (stored: string, provided: string): boolean => {
  const a = Buffer.from(stored.trim(), "utf8");
  const b = Buffer.from(provided.trim(), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

export const registerUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = body(req.body);
  const cleanEmail = email(b.email);
  const cleanPassword = password(b.password);
  const fullName = str(b.fullname, "Full Name", { required: true, min: 2, max: 100 })!;
  const cleanMatricNo = matricNo(b.matricNo, false);

  // Check existing email
  const existingEmail = await db.orm.public.User.where({ email: cleanEmail }).first();
  if (existingEmail && existingEmail.isVerified) {
    throw conflict("An account with this email already exists");
  }

  // Check existing matricNo if provided (must run before updating an unverified row - Fix H-02)
  if (cleanMatricNo) {
    const existingMatric = await db.orm.public.User.where({ matricNo: cleanMatricNo }).first();
    if (existingMatric && existingMatric.id !== existingEmail?.id) {
      throw conflict("An account with this Matric No already exists");
    }
  }

  // Hash password asynchronously to not block the event loop (M1)
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(cleanPassword, salt);
  const verificationCode = generateVerificationCode();
  const expiresAt = now().add({ minutes: 15 });

  if (existingEmail) {
    // Account exists but is unverified: update details & resend verification code
    await db.orm.public.User.where({ id: existingEmail.id }).update({
      passwordHash: hashedPassword,
      fullName,
      matricNo: cleanMatricNo || null,
      verificationCode,
      verificationExpiresAt: expiresAt as any,
    });

    await sendVerificationEmail(cleanEmail, verificationCode, fullName);

    res.status(200).json({
      message: "A verification code has been sent to your email address.",
      requiresVerification: true,
      email: cleanEmail,
    });
    return;
  }

  // Create unverified user
  await db.orm.public.User.create({
    email: cleanEmail,
    passwordHash: hashedPassword,
    fullName,
    matricNo: cleanMatricNo || null,
    role: "VOTER",
    isVerified: false,
    verificationCode,
    verificationExpiresAt: expiresAt as any,
  });

  // Send verification email via Resend
  await sendVerificationEmail(cleanEmail, verificationCode, fullName);

  res.status(201).json({
    message: "Registration successful. Please check your email for the verification code.",
    requiresVerification: true,
    email: cleanEmail,
  });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = body(req.body);
  const cleanEmail = email(b.email);
  const code = str(b.code, "Verification code", { required: true, min: 4, max: 20 })!.trim();

  const user = await db.orm.public.User.where({ email: cleanEmail }).first();
  if (!user) {
    throw notFound("No account found for this email address.");
  }

  // Never mint a session token for an already-verified account without password auth (Fix C-01)
  if (user.isVerified) {
    throw badRequest("This email is already verified. Please sign in.");
  }

  if (!user.verificationCode || !codesMatch(user.verificationCode, code)) {
    throw badRequest("Invalid verification code. Please check and try again.");
  }

  const expiryMs = toEpochMs(user.verificationExpiresAt);
  if (expiryMs && Date.now() > expiryMs) {
    throw badRequest("Verification code has expired. Please request a new code.");
  }

  // Mark user as verified and clear code
  await db.orm.public.User.where({ id: user.id }).update({
    isVerified: true,
    verificationCode: null,
    verificationExpiresAt: null,
  });

  const token = signToken(user.id);

  res.cookie("token", token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    message: "Email verified successfully.",
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      matricNo: user.matricNo,
      role: user.role,
      isVerified: true,
    },
  });
});

export const resendVerification = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = body(req.body);
  const cleanEmail = email(b.email);

  const user = await db.orm.public.User.where({ email: cleanEmail }).first();
  if (!user) {
    throw notFound("No account found for this email address.");
  }

  if (user.isVerified) {
    throw badRequest("This email is already verified. Please sign in.");
  }

  // Cooldown: if a code was issued less than 60 seconds ago (more than 14 mins left), prevent email spam (Fix M-06)
  const existingExpiryMs = toEpochMs(user.verificationExpiresAt);
  if (!config.isTest && existingExpiryMs && existingExpiryMs - Date.now() > 14 * 60 * 1000) {
    throw badRequest("A verification code was just sent. Please wait a minute before requesting another.");
  }

  const verificationCode = generateVerificationCode();
  const expiresAt = now().add({ minutes: 15 });

  await db.orm.public.User.where({ id: user.id }).update({
    verificationCode,
    verificationExpiresAt: expiresAt as any,
  });

  await sendVerificationEmail(cleanEmail, verificationCode, user.fullName);

  res.status(200).json({
    message: "A new verification code has been sent to your email address.",
    email: cleanEmail,
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

  // Enforce email verification for non-admin accounts
  if (!user.isVerified && user.role !== "ADMIN") {
    const existingExpiryMs = toEpochMs(user.verificationExpiresAt);
    const hasFreshCode =
      Boolean(user.verificationCode) &&
      existingExpiryMs !== undefined &&
      existingExpiryMs - Date.now() > 14 * 60 * 1000;

    if (!hasFreshCode) {
      const verificationCode = generateVerificationCode();
      const expiresAt = now().add({ minutes: 15 });
      await db.orm.public.User.where({ id: user.id }).update({
        verificationCode,
        verificationExpiresAt: expiresAt as any,
      });
      await sendVerificationEmail(user.email, verificationCode, user.fullName);
    }

    throw forbidden("Email not verified. Please enter the verification code sent to your email.", {
      requiresVerification: true,
      email: user.email,
    });
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
      isVerified: user.isVerified,
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
      isVerified: user.isVerified,
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
