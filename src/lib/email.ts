import crypto from "crypto";
import { Resend } from "resend";
import { config } from "../config.ts";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const generateVerificationCode = (): string => {
  // Cryptographically secure 6-digit numeric OTP code (Fix H-01)
  return crypto.randomInt(100000, 1000000).toString();
};

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export const sendVerificationEmail = async (
  to: string,
  code: string,
  fullName: string = "Voter"
): Promise<SendEmailResult> => {
  const safeName = escapeHtml(fullName);
  const safeCode = escapeHtml(code);
  const subject = "Verify your BallotBox account";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <h2 style="color: #0f172a; margin-top: 0;">Welcome to BallotBox, ${safeName}!</h2>
      <p style="color: #475569; font-size: 16px; line-height: 1.5;">
        Thank you for creating an account. Please use the verification code below to verify your email address and activate your account.
      </p>
      <div style="background-color: #f1f5f9; border-radius: 6px; padding: 16px; text-align: center; margin: 24px 0;">
        <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0284c7;">
          ${safeCode}
        </span>
      </div>
      <p style="color: #64748b; font-size: 14px;">
        This verification code expires in 15 minutes. If you did not create a BallotBox account, please ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
        BallotBox Secure &amp; Verifiable Voting System
      </p>
    </div>
  `;
  const text = `Welcome to BallotBox, ${fullName}!\n\nYour verification code is: ${code}\n\nThis code will expire in 15 minutes.\nIf you did not request this, please ignore this email.`;

  if (!config.isProduction) {
    console.log(`[Email] Verification code for ${to}: ${code}`);
  }

  if (!resend) {
    console.log(`[Email] Resend API key not configured. Mocked sending email to ${to}`);
    return { success: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: config.resendFromEmail,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      console.error(`[Email] Resend error for ${to}:`, error);
      // In development or test, don't fail registration if Resend returns testing domain restrictions
      if (!config.isProduction) {
        return { success: true, error: error.message };
      }
      return { success: false, error: error.message };
    }

    console.log(`[Email] Successfully sent email to ${to}, id: ${data?.id}`);
    return { success: true, messageId: data?.id };
  } catch (err: any) {
    console.error(`[Email] Exception while sending email to ${to}:`, err);
    if (!config.isProduction) {
      return { success: true, error: err.message };
    }
    return { success: false, error: err.message };
  }
};
