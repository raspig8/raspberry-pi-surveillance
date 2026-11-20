
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

export async function createPoliceAssignment({
  redisUrl,
  headers
}) {
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

  // 1. Read the active incident.
  const incidentRaw = await redisGet("incident_status");

  if (!incidentRaw) {
    throw new Error("No incident found.");
  }

  const incident = JSON.parse(incidentRaw);

  if (!incident.active || !incident.startedAt) {
    throw new Error("There is no active incident.");
  }

  const incidentId = incident.startedAt;
  const assignmentKey = `assignment:${incidentId}`;

  // 2. Prevent duplicate assignments.
  const existing = await redisGet(assignmentKey);

  if (existing) {
    return {
      success: true,
      message: "Assignment already exists.",
      assignment: JSON.parse(existing)
    };
  }

  // 3. Read rider GPS.
  const riderRaw = await redisGet("latest_location");

  if (!riderRaw) {
    throw new Error("Rider GPS location is unavailable.");
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
    throw new Error(
      "Rider GPS location is invalid or outdated."
    );
  }

  // 4. Retrieve police PC usernames.
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

console.log("POLICE INDEX DIAGNOSTIC:", {
  redisError: indexData.error || null,
  usernames: indexData.result || [],
  usernameCount: Array.isArray(indexData.result)
    ? indexData.result.length
    : 0
});

if (indexData.error) {
  throw new Error(
    `Redis police index error: ${indexData.error}`
  );
}

const usernames = indexData.result || [];

const candidates = [];

  // 5. Retrieve and validate police PCs.
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

  console.log("POLICE CANDIDATE DIAGNOSTIC:", {
  indexedUsernames: usernames,
  candidateCount: candidates.length,
  candidates
});

if (candidates.length === 0) {
    throw new Error("No available police PCs found.");
}

  // 6. Select the nearest police PC.
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

  // 7. Atomically save the assignment.
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
    throw new Error(
      "Redis returned an empty assignment result."
    );
  }

  const saveResult = JSON.parse(saveData.result);

  if (!saveResult.created) {
    return {
      success: true,
      message: "Assignment already exists.",
      assignment: saveResult.existing
        ? JSON.parse(saveResult.existing)
        : null
    };
  }

  return {
    success: true,
    message: "SOS assigned to nearest police PC.",
    assignment
  };
}
