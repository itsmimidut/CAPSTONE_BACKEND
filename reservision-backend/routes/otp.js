import express from "express";
import * as SibApiV3Sdk from "@getbrevo/brevo";
import { otpLimiter } from "../middleware/rateLimiters.js";
import { handleValidationErrors } from "../middleware/validate.js";
import { otpSendValidators, otpVerifyValidators } from "../middleware/validators/otpValidators.js";
import { createSignupVerificationToken } from "../utils/signupVerification.js";

const router = express.Router();

const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const saveOtp = (email, otp) => {
    otpStore.set(email, {
        otp,
        expiresAt: Date.now() + OTP_TTL_MS
    });
};

const getOtpEntry = (email) => otpStore.get(email);

const isExpired = (entry) => !entry || Date.now() > entry.expiresAt;

router.post("/send", otpLimiter, otpSendValidators, handleValidationErrors, async (req, res) => {
    const { email, firstName, purpose } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ success: false, error: "Valid email is required" });
    }

    const otp = generateOtp();
    saveOtp(normalizedEmail, otp);

    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.BREVO_FROM_EMAIL;
    const displayName = process.env.BREVO_FROM_NAME || "Eduardo's Resort";

    if (!apiKey || !fromEmail) {
        console.warn("BREVO_API_KEY or BREVO_FROM_EMAIL is not set. Skipping email send.");
        return res.json({ success: true, dev: true, otp });
    }

    try {
        const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
        apiInstance.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, apiKey);

        await apiInstance.sendTransacEmail({
            sender: { email: fromEmail, name: displayName },
            to: [{ email: normalizedEmail }],
            subject: purpose === 'signup' ? "Verify your Eduardo's Resort account" : "Your verification code",
            htmlContent: `
                    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
                        <h2>Hi ${firstName || "Guest"},</h2>
                        <p>Your verification code is:</p>
                        <div style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${otp}</div>
                        <p>This code will expire in 10 minutes.</p>
                        <p>If you did not request this, you can ignore this email.</p>
                    </div>
                `
        });

        return res.json({ success: true });
    } catch (error) {
        const errorMsg = error?.response?.data?.message || error?.message || "Failed to send verification code";
        console.error("Send OTP error:", errorMsg);

        // If IP is not whitelisted, return OTP in dev mode for testing
        if (errorMsg.includes("unrecognised IP")) {
            console.warn(`⚠️ IP not whitelisted in Brevo. OTP: ${otp}`);
            return res.json({ success: true, dev: true, otp, warning: "Email not sent - IP not whitelisted" });
        }

        return res.status(500).json({ success: false, error: errorMsg });
    }
});

router.post("/verify", otpLimiter, otpVerifyValidators, handleValidationErrors, (req, res) => {
    const { email, otp, purpose } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!email || !otp) {
        return res.status(400).json({ success: false, error: "Email and OTP are required" });
    }

    const entry = getOtpEntry(normalizedEmail);

    if (isExpired(entry)) {
        otpStore.delete(normalizedEmail);
        return res.json({ success: false, expired: true, error: "OTP expired" });
    }

    if (entry.otp !== String(otp)) {
        return res.json({ success: false, error: "Invalid verification code" });
    }

    otpStore.delete(normalizedEmail);
    return res.json({
        success: true,
        ...(purpose === 'signup' ? { verificationToken: createSignupVerificationToken(normalizedEmail) } : {})
    });
});

export default router;
