const {
    createToken,
    setCookie
} = require("../../lib/auth");

function safeEqual(a, b) {
    const crypto = require("crypto");

    const first = Buffer.from(String(a));
    const second = Buffer.from(String(b));

    if (first.length !== second.length) {
        return false;
    }

    return crypto.timingSafeEqual(first, second);
}

module.exports = function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed."
        });
    }

    try {
        const { officerId, password } = req.body || {};

        if (
            !officerId ||
            !password ||
            !process.env.OFFICER_ID ||
            !process.env.OFFICER_PASSWORD
        ) {
            return res.status(400).json({
                success: false,
                message: "Please enter your Officer ID and password."
            });
        }

        const validOfficer = safeEqual(
            officerId,
            process.env.OFFICER_ID
        );

        const validPassword = safeEqual(
            password,
            process.env.OFFICER_PASSWORD
        );

        if (!validOfficer || !validPassword) {
            return res.status(401).json({
                success: false,
                message: "Invalid Officer ID or password."
            });
        }

        const challenge = createToken({
            stage: "password_verified",
            officer: process.env.OFFICER_ID
        }, "5m");

        setCookie(
            res,
            "officer_challenge",
            challenge,
            300
        );

        return res.status(200).json({
            success: true,
            nextStep: "authenticator",
            message: "Password accepted. Enter your authenticator code."
        });

    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Authentication service error."
        });
    }
};
