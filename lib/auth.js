const jwt = require("jsonwebtoken");

function getAuthSecret() {
    const secret = process.env.AUTH_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error("AUTH_SECRET must be at least 32 characters.");
    }

    return secret;
}

function createToken(payload, expiresIn) {
    return jwt.sign(payload, getAuthSecret(), {
        expiresIn: expiresIn,
        issuer: "helmet-surveillance",
        audience: "helmet-dashboard"
    });
}

function verifyToken(token) {
    return jwt.verify(token, getAuthSecret(), {
        issuer: "helmet-surveillance",
        audience: "helmet-dashboard"
    });
}

function setCookie(res, name, value, maxAge) {
    res.setHeader("Set-Cookie", [
        `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`
    ]);
}

function clearAuthCookies(res) {
    res.setHeader("Set-Cookie", [
        "officer_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
        "officer_challenge=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
    ]);
}

function getSession(req) {
    try {
        const token = req.cookies?.officer_session;

        if (!token) {
            return null;
        }

        const session = verifyToken(token);

        if (session.stage !== "authenticated") {
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

module.exports = {
    createToken,
    verifyToken,
    setCookie,
    clearAuthCookies,
    getSession
};
