const { getSession } = require("../../lib/auth");

module.exports = function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            authenticated: false
        });
    }

    const session = getSession(req);

    if (!session) {
        return res.status(401).json({
            authenticated: false
        });
    }

    return res.status(200).json({
        authenticated: true,
        officer: session.officer
    });
};
