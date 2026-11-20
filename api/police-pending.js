
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

  async function redisCommand(command, ...args) {
    const response = await fetch(
      `${redisUrl}/${command}/${args.map(encodeURIComponent).join("/")}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Redis ${command} failed.`);
    }

    const data = await response.json();
    return data.result;
  }

  try {
    const incidentIds = await redisCommand(
      "smembers",
      "active_assignments"
    ) || [];

    const assignments = [];
    const now = Date.now();

    for (const incidentId of incidentIds) {
      const raw = await redisCommand(
        "get",
        `assignment:${incidentId}`
      );

      if (!raw) {
        await redisCommand(
          "srem",
          "active_assignments",
          incidentId
        );
        continue;
      }

      const assignment = JSON.parse(raw);

      // Automatically expire assignments that were never accepted.
      if (
        assignment.status === "pending" &&
        Number(assignment.deadline) <= now
      ) {
        assignment.status = "expired";

        await redisCommand(
          "set",
          `assignment:${incidentId}`,
          JSON.stringify(assignment),
          "EX",
          86400
        );

        // Remove this incident from the active assignment index.
        await redisCommand(
          "srem",
          "active_assignments",
          incidentId
        );

        continue;
      }

      // Return only active assignments offered to this PC.
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

