
const LUA_SCRIPT = `
local assignmentRaw = redis.call("GET", KEYS[1])

if not assignmentRaw then
  return cjson.encode({
    error = "Assignment not found."
  })
end

local a = cjson.decode(assignmentRaw)
local username = ARGV[1]
local resolvedAt = ARGV[2]

if a.status ~= "accepted" then
  return cjson.encode({
    error = "Incident has not been accepted or is already resolved."
  })
end

if a.acceptedBy ~= username then
  return cjson.encode({
    error = "Only the assigned police PC can resolve this incident."
  })
end

a.status = "resolved"
a.resolvedAt = resolvedAt

local incidentRaw = redis.call("GET", KEYS[2])

if incidentRaw then
  local incident = cjson.decode(incidentRaw)
  incident.active = false
  incident.reason = nil
  incident.updatedAt = resolvedAt

  redis.call("SET", KEYS[2], cjson.encode(incident))
end

redis.call("SET", KEYS[1], cjson.encode(a), "EX", 86400)

return cjson.encode({
  success = true,
  assignment = a
})
`;

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

  const { incidentId, username } = req.body || {};

  if (
    typeof incidentId !== "string" ||
    incidentId.length > 100 ||
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_-]{1,50}$/.test(username)
  ) {
    return res.status(400).json({
      error: "Invalid request."
    });
  }

  try {
    const keys = [
      `assignment:${incidentId}`,
      "incident_status"
    ];

    const args = [
      username,
      new Date().toISOString()
    ];

    const encodedParts = [
      encodeURIComponent(LUA_SCRIPT),
      "2",
      ...keys.map(encodeURIComponent),
      ...args.map(encodeURIComponent)
    ];

    const response = await fetch(
      `${redisUrl}/eval/${encodedParts.join("/")}`,
      {
        headers: {
          Authorization: `Bearer ${redisToken}`
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      throw new Error("Redis operation failed.");
    }

    const data = await response.json();
    const result = JSON.parse(data.result);

    if (result.error) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Incident resolution failed:", error);

    return res.status(500).json({
      error: "Could not resolve incident."
    });
  }
}

