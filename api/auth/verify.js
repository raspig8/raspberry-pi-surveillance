const speakeasy = require("speakeasy");

const {
    verifyToken,
    createToken,
    setCookie
} = require("../../lib/auth");

module.exports = function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed."
        });
    }

    try {
        const challengeToken =
            req.cookies?.officer_challenge;

        const { code } = req.body || {};

        if (!challengeToken) {
            return res.status(401).json({
                success: false,
                message: "Your login session expired. Start again."
            });
        }

        const challenge = verifyToken(challengeToken);

        if (
            challenge.stage !== "password_verified" ||
            challenge.officer !== process.env.OFFICER_ID
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid login challenge."
            });
        }

        if (!/^\d{6}$/.test(String(code || ""))) {
            return res.status(400).json({
                success: false,
                message: "Enter the six-digit authenticator code."
            });
        }

        const secret = process.env.TOTP_SECRET;

        if (!secret) {
            return res.status(500).json({
                success: false,
                message: "Authenticator is not configured."
            });
        }

        const validCode = speakeasy.totp.verify({
            secret: secret,
            encoding: "base32",
            token: String(code),
            window: 1
        });

        if (!validCode) {
            return res.status(401).json({
                success: false,
                message: "Incorrect or expired authenticator code."
            });
        }

        const session = createToken({
            stage: "authenticated",
            officer: process.env.OFFICER_ID
        }, "8h");

        setCookie(
            res,
            "officer_session",
            session,
            28800
        );

        res.setHeader("Set-Cookie", [
            `officer_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`,
            "officer_challenge=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
        ]);

        return res.status(200).json({
            success: true,
            message: "Authentication successful.",
            redirect: "/dashboard.html"
        });

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Your login challenge expired. Please log in again."
        });
    }
};
