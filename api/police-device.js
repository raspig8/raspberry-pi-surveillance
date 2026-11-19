
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(500).json({
      error: "Redis is not configured."
    });
  }

  const { username, latitude, longitude, available } =
    req.body || {};

  if (
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_-]{1,50}$/.test(username)
  ) {
    return res.status(400).json({
      error: "Invalid police PC username."
    });
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({
      error: "Invalid GPS coordinates."
    });
  }

  if (typeof available !== "boolean") {
    return res.status(400).json({
      error: "Availability must be true or false."
    });
  }

  const headers = {
    Authorization: `Bearer ${redisToken}`
  };

  const device = {
    username,
    latitude,
    longitude,
    status: available ? "available" : "unavailable",
    lastSeen: new Date().toISOString()
  };

  try {
    const key = `police_device:${username}`;

    // Store the PC record for 90 seconds.
    const saveResponse = await fetch(
      `${redisUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(
        JSON.stringify(device)
      )}/EX/90`,
      { headers }
    );

    if (!saveResponse.ok) {
      throw new Error("Could not save police device.");
    }

    // Keep an index of registered police PCs.
    const indexResponse = await fetch(
    `${redisUrl}/sadd/police_devices/${encodeURIComponent(username)}`,
    { headers }
    );

    const indexBody = await indexResponse.text();

    if (!indexResponse.ok) {
    console.error("Redis SADD failed:", {
        status: indexResponse.status,
        response: indexBody
    });

    throw new Error("Could not update police device index.");
    }

    return res.status(200).json({
      success: true,
      device
    });

  } catch (error) {
    console.error("Police device registration failed:", error);

    return res.status(500).json({
      error: "Could not register police device."
    });
  }
}
