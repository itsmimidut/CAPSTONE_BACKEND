import express from "express";
import fetch from "node-fetch";

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

router.post("/send", async (req, res) => {
    const { email, firstName } = req.body || {};

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ success: false, error: "Valid email is required" });
    }

    const otp = generateOtp();
    saveOtp(email, otp);

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM || "onboarding@resend.dev";
    const displayName = process.env.RESEND_FROM_NAME || "Eduardo's Resort";
  const devMode = process.env.NODE_ENV !== "production";

  if (!apiKey || devMode) {
    console.warn(`OTP for ${email}: ${otp} (expires in 10 minutes)`);
                subject: "Your booking verification code",
                html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
            <h2>Hi ${firstName || "Guest"},</h2>
            <p>Your verification code is:</p>
            <div style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 12px 0;">${otp}</div>
            <p>This code will expire in 10 minutes.</p>
            <p>If you did not request this, you can ignore this email.</p>
          </div>
        `
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Resend API error:", errorText);
            return res.status(500).json({ success: false, error: "Failed to send verification code" });
        }

        return res.json({ success: true });
    } catch (error) {
        console.error("Send OTP error:", error);
        return res.status(500).json({ success: false, error: "Failed to send verification code" });
    }
});

router.post("/verify", (req, res) => {
    const { email, otp } = req.body || {};

    if (!email || !otp) {
        return res.status(400).json({ success: false, error: "Email and OTP are required" });
    }

    const entry = getOtpEntry(email);

    if (isExpired(entry)) {
        otpStore.delete(email);
        return res.json({ success: false, expired: true, error: "OTP expired" });
    }

    if (entry.otp !== String(otp)) {
        return res.json({ success: false, error: "Invalid verification code" });
    }

    otpStore.delete(email);
    return res.json({ success: true });
});

export default router;
