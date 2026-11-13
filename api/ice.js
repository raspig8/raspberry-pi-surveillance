
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const token = process.env.TURNIX_API_TOKEN;

    if (!token) {
        return res.status(500).json({
            error: "TURNIX_API_TOKEN is not configured"
        });
    }

    try {
        const response = await fetch(
            "https://turnix.io/api/v1/credentials/ice",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    initiator_client: "website",
                    receiver_client: "raspberry-pi",
                    room: "raspig8_backend",
                    ttl: 3600
                }),
                signal: AbortSignal.timeout(10000)
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Turnix API error:", response.status);

            return res.status(502).json({
                error: "Unable to obtain TURN credentials"
            });
        }

        return res.status(200).json({
            iceServers: data.iceServers,
            expiresAt: data.expiresAt
        });

    } catch (error) {
        console.error("ICE credential request failed:", error.message);

        return res.status(500).json({
            error: "TURN credential request failed"
        });
    }
}

