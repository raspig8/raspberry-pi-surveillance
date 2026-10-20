const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed."
        });
    }

    try {
        const { setupKey } = req.body || {};

        if (
            !process.env.SETUP_KEY ||
            setupKey !== process.env.SETUP_KEY
        ) {
            return res.status(403).json({
                success: false,
                message: "Invalid setup key."
            });
        }

        const secret = process.env.TOTP_SECRET;

        if (!secret) {
            return res.status(500).json({
                success: false,
                message: "TOTP_SECRET is not configured."
            });
        }

        const otpUrl = speakeasy.otpauthURL({
            secret: secret,
            encoding: "base32",
            label: `Demo Officer (${process.env.OFFICER_ID})`,
            issuer: "Lipa City Emergency-Ready Helmet",
            algorithm: "sha1",
            digits: 6,
            period: 30
        });

        const qrCode = await QRCode.toDataURL(otpUrl);

        return res.status(200).json({
            success: true,
            qrCode: qrCode
        });

    } catch (error) {
        console.error("Setup error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to generate QR code."
        });
    }
};
