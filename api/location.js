export default async function handler(req, res) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const gpsApiKey = process.env.GPS_API_KEY;

  if (!redisUrl || !redisToken || !gpsApiKey) {
    return res.status(500).json({
      error: "Server environment variables are not configured."
    });
  }

  // Allow the website to retrieve the latest GPS location.
  if (req.method === "GET") {
    try {
      const response = await fetch(
        `${redisUrl}/get/latest_location`,
        {
          headers: {
            Authorization: `Bearer ${redisToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error("Redis request failed");
      }

      const result = await response.json();

      if (!result.result) {
        return res.status(200).json({
          latitude: null,
          longitude: null,
          message: "No GPS location received yet."
        });
      }

      return res.status(200).json(JSON.parse(result.result));
    } catch (error) {
      return res.status(500).json({
        error: "Could not retrieve the latest GPS location."
      });
    }
  }

  // Only the Raspberry Pi with the correct API key can update the location.
  if (req.method === "POST") {
    if (req.headers["x-api-key"] !== gpsApiKey) {
      return res.status(401).json({
        error: "Unauthorized."
      });
    }

    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({
        error: "Invalid latitude or longitude."
      });
    }

    const location = {
      latitude,
      longitude,
      updatedAt: new Date().toISOString()
    };

    try {
      const response = await fetch(
        `${redisUrl}/set/latest_location/${encodeURIComponent(
          JSON.stringify(location)
        )}`,
        {
          headers: {
            Authorization: `Bearer ${redisToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error("Redis request failed");
      }

      return res.status(200).json({
        success: true,
        location
      });
    } catch (error) {
      return res.status(500).json({
        error: "Could not save the GPS location."
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({
    error: "Method not allowed."
  });
}
