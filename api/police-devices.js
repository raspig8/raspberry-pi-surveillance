
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const headers = {
    Authorization: `Bearer ${redisToken}`
  };

  try {
    const indexResponse = await fetch(
      `${redisUrl}/smembers/police_devices:index`,
      { headers }
    );

    if (!indexResponse.ok) {
      throw new Error("Could not retrieve police device index.");
    }

    const indexData = await indexResponse.json();
    const usernames = indexData.result || [];

    const devices = [];

    for (const username of usernames) {
      const key = `police_device:${username}`;

      const response = await fetch(
        `${redisUrl}/get/${encodeURIComponent(key)}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(`Could not retrieve ${username}.`);
      }

      const result = await response.json();

      if (!result.result) {
        await fetch(
          `${redisUrl}/srem/police_devices:index/${encodeURIComponent(username)}`,
          { headers }
        );

        continue;
      }

      const device = JSON.parse(result.result);

      if (
        device.status === "available" &&
        Date.now() - Date.parse(device.lastSeen) <= 90000
      ) {
        devices.push(device);
      }
    }

    return res.status(200).json({
      success: true,
      count: devices.length,
      devices
    });

  } catch (error) {
    console.error("Police device retrieval failed:", error);

    return res.status(500).json({
      error: "Could not retrieve police devices."
    });
  }
}
