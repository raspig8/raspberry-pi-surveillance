const { clearAuthCookies } = require("../../lib/auth");

module.exports = function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed."
        });
    }

    clearAuthCookies(res);

    return res.status(200).json({
        success: true,
        message: "Logged out successfully."
    });
};
