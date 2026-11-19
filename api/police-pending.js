

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

  const username = req.query.username;

  if (
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_-]{1,50}$/.test(username)
  ) {
    return res.status(400).json({
      error: "Valid police PC username is required."
    });
  }

  const headers = {
    Authorization: `Bearer ${redisToken}`
  };

  async function redisGet(key) {
    const response = await fetch(
      `${redisUrl}/get/${encodeURIComponent(key)}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error("Redis read failed.");
    }

    const data = await response.json();
    return data.result;
  }

  try {
    // Retrieve all active assignment IDs.
    const indexResponse = await fetch(
      `${redisUrl}/smembers/active_assignments`,
      { headers }
    );

    if (!indexResponse.ok) {
      throw new Error("Could not retrieve assignment index.");
    }

    const indexData = await indexResponse.json();
    const incidentIds = indexData.result || [];

    const assignments = [];

    for (const incidentId of incidentIds) {
      const raw = await redisGet(
        `assignment:${incidentId}`
      );

      if (!raw) {
        continue;
      }

      const assignment = JSON.parse(raw);

      // Return only assignments currently offered to this PC.
      if (
        assignment.assignedTo === username &&
        ["pending", "accepted"].includes(assignment.status)
      ) {
        assignments.push({
          incidentId: assignment.incidentId,
          status: assignment.status,
          assignedAt: assignment.assignedAt,
          deadline: assignment.deadline,
          distanceKm: assignment.distanceKm,
          acceptedAt: assignment.acceptedAt
        });
      }
    }

    return res.status(200).json({
      success: true,
      username,
      count: assignments.length,
      assignments
    });

  } catch (error) {
    console.error("Pending assignment retrieval failed:", error);

    return res.status(500).json({
      error: "Could not retrieve pending assignments."
    });
  }
}
