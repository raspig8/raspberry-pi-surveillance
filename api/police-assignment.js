
import { createPoliceAssignment } from "./lib/create-police-assignment.js";

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

  const headers = {
    Authorization: `Bearer ${redisToken}`
  };

  try {
    const result = await createPoliceAssignment({
      redisUrl,
      headers
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error("Police assignment error:", error);

    return res.status(500).json({
      error: "Could not create police assignment.",
      details: error.message
    });
  }
}
