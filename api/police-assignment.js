
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const earthRadius = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return earthRadius * 2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CREATE_ASSIGNMENT_SCRIPT = `
local result = redis.call(
  "SET",
  KEYS[1],
  ARGV[1],
  "NX",
  "EX",
  86400
)

if not result then
  return cjson.encode({
    created = false,
    existing = redis.call("GET", KEYS[1])
  })
end

redis.call("SADD", KEYS[2], ARGV[2])

return cjson.encode({
  created = true
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

  const headers = {
    Authorization: `Bearer ${redisToken}`
  };

  async function redisGet(key) {
    const response = await fetch(
      `${redisUrl}/get/${encodeURIComponent(key)}`,
      { headers }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Redis GET failed:", {
        key,
        status: response.status,
        response: error
      });

      throw new Error(`Redis GET failed for ${key}.`);
    }

    const data = await response.json();
    return data.result;
  }

  try {
    // 1. Check the active rider incident.
    const incidentRaw = await redisGet("incident_status");

    if (!incidentRaw) {
      return res.status(404).json({
        error: "No incident found."
      });
    }

    const incident = JSON.parse(incidentRaw);

    if (!incident.active || !incident.startedAt) {
      return res.status(400).json({
        error: "There is no active incident."
      });
    }

    const incidentId = incident.startedAt;
    const assignmentKey = `assignment:${incidentId}`;

    // 2. Prevent duplicate assignments.
    const existing = await redisGet(assignmentKey);

    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Assignment already exists.",
        assignment: JSON.parse(existing)
      });
    }

    // 3. Retrieve rider GPS location.
    const riderRaw = await redisGet("latest_location");

    if (!riderRaw) {
      return res.status(400).json({
        error: "Rider GPS location is unavailable."
      });
    }

    const rider = JSON.parse(riderRaw);

    const riderLat = Number(rider.latitude);
    const riderLon = Number(rider.longitude);
    const riderTime = Date.parse(rider.updatedAt);

    if (
      !Number.isFinite(riderLat) ||
      !Number.isFinite(riderLon) ||
      !Number.isFinite(riderTime) ||
      Date.now() - riderTime > 5 * 60 * 1000 ||
      riderTime > Date.now() + 30000
    ) {
      return res.status(400).json({
        error: "Rider GPS location is invalid or outdated."
      });
    }

    // 4. Retrieve police PC usernames from the correct Redis index.
    const indexResponse = await fetch(
      `${redisUrl}/smembers/police_devices:index`,
      { headers }
    );

    if (!indexResponse.ok) {
      const errorBody = await indexResponse.text();

      console.error("Redis police index error:", {
        status: indexResponse.status,
        response: errorBody
      });

      throw new Error("Could not retrieve police devices.");
    }

    const indexData = await indexResponse.json();
    const usernames = indexData.result || [];

    const candidates = [];

    // 5. Retrieve and validate each police PC.
    for (const username of usernames) {
      const deviceRaw = await redisGet(
        `police_device:${username}`
      );

      if (!deviceRaw) continue;

      const device = JSON.parse(deviceRaw);

      if (device.status !== "available") continue;

      const latitude = Number(device.latitude);
      const longitude = Number(device.longitude);
      const lastSeen = Date.parse(device.lastSeen);

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(lastSeen) ||
        Date.now() - lastSeen > 90000 ||
        lastSeen > Date.now() + 30000
      ) {
        continue;
      }

      candidates.push({
        username,
        latitude,
        longitude,
        distanceKm: distanceKm(
          riderLat,
          riderLon,
          latitude,
          longitude
        )
      });
    }

    if (candidates.length === 0) {
      return res.status(404).json({
        error: "No available police PCs found."
      });
    }

    // 6. Sort police PCs by distance.
    candidates.sort(
      (a, b) => a.distanceKm - b.distanceKm
    );

    const now = Date.now();
    const selected = candidates[0];

    const assignment = {
      incidentId,
      status: "pending",
      assignedTo: selected.username,
      distanceKm: selected.distanceKm,
      candidates,
      currentIndex: 0,
      assignedAt: new Date(now).toISOString(),
      deadline: now + 15000,
      acceptedBy: null,
      acceptedAt: null,
      resolvedAt: null
    };

    // 7. Atomically save assignment and index it.
    const saveResponse = await fetch(
      `${redisUrl}/eval/${encodeURIComponent(
        CREATE_ASSIGNMENT_SCRIPT
      )}/2/${encodeURIComponent(
        assignmentKey
      )}/${encodeURIComponent(
        "active_assignments"
      )}/${encodeURIComponent(
        JSON.stringify(assignment)
      )}/${encodeURIComponent(
        incidentId
      )}`,
      {
        headers,
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!saveResponse.ok) {
      const errorBody = await saveResponse.text();

      console.error("Redis assignment creation failed:", {
        status: saveResponse.status,
        response: errorBody
      });

      throw new Error("Could not create assignment.");
    }

    const saveData = await saveResponse.json();

    if (!saveData.result) {
      throw new Error("Redis returned an empty assignment result.");
    }

    const saveResult = JSON.parse(saveData.result);

    if (!saveResult.created) {
      return res.status(200).json({
        success: true,
        message: "Assignment already exists.",
        assignment: saveResult.existing
          ? JSON.parse(saveResult.existing)
          : null
      });
    }

    return res.status(200).json({
      success: true,
      message: "SOS assigned to nearest police PC.",
      assignment
    });

  } catch (error) {
    console.error("Police assignment error:", error);

    return res.status(500).json({
      error: "Could not create police assignment."
    });
  }
}

