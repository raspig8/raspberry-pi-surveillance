
const LUA_SCRIPT = `
local raw = redis.call("GET", KEYS[1])

if not raw then
  return cjson.encode({ error = "Assignment not found." })
end

local a = cjson.decode(raw)
local action = ARGV[1]
local username = ARGV[2]
local now = tonumber(ARGV[3])

if a.status ~= "pending" then
  return cjson.encode({
    message = "Assignment is no longer pending.",
    assignment = a
  })
end

local function advance()
  local candidates = a.candidates
  local nextIndex = (a.currentIndex or 0) + 2

  while nextIndex <= #candidates do
    local candidate = candidates[nextIndex]
    local deviceRaw = redis.call(
      "GET",
      "police_device:" .. candidate.username
    )

    if deviceRaw then
      local ok, device = pcall(cjson.decode, deviceRaw)

      if ok and device.status == "available" then
        a.currentIndex = nextIndex - 1
        a.assignedTo = candidate.username
        a.distanceKm = candidate.distanceKm
        a.assignedAt = os.date(
          "!%Y-%m-%dT%H:%M:%SZ",
          math.floor(now / 1000)
        )
        a.deadline = now + 15000
        a.acceptedBy = cjson.null

        return true
      end
    end

    nextIndex = nextIndex + 1
  end

  a.status = "unassigned"
  a.assignedTo = cjson.null
  a.deadline = cjson.null

  return false
end

if action == "check" then
  if now >= a.deadline then
    advance()
  end

elseif action == "accept" then
  if username ~= a.assignedTo then
    return cjson.encode({
      error = "This incident is assigned to another PC."
    })
  end

  if now >= a.deadline then
    advance()
  else
    a.status = "accepted"
    a.acceptedBy = username
    a.acceptedAt = os.date(
      "!%Y-%m-%dT%H:%M:%SZ",
      math.floor(now / 1000)
    )
  end

elseif action == "decline" then
  if username ~= a.assignedTo then
    return cjson.encode({
      error = "This incident is assigned to another PC."
    })
  end

  advance()

else
  return cjson.encode({
    error = "Invalid action."
  })
end

redis.call(
  "SET",
  KEYS[1],
  cjson.encode(a),
  "EX",
  86400
)

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

  const { incidentId, username, action } = req.body || {};

  if (
    typeof incidentId !== "string" ||
    incidentId.length > 100 ||
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_-]{1,50}$/.test(username) ||
    !["check", "accept", "decline"].includes(action)
  ) {
    return res.status(400).json({
      error: "Invalid request."
    });
  }

  const assignmentKey = `assignment:${incidentId}`;

  try {
    const url =
      `${redisUrl}/eval/${encodeURIComponent(LUA_SCRIPT)}/1/` +
      `${encodeURIComponent(assignmentKey)}/` +
      `${encodeURIComponent(action)}/` +
      `${encodeURIComponent(username)}/` +
      `${Date.now()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${redisToken}`
      },
      signal: AbortSignal.timeout(10000)
    });

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
    console.error("Assignment response error:", error);

    return res.status(500).json({
      error: "Could not process assignment response."
    });
  }
}
