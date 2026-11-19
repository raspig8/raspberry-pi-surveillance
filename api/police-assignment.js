
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
      throw new Error("Redis read failed.");
    }

    const data = await response.json();
    return data.result;
  }

  async function redisSet(key, value) {
    const response = await fetch(
      `${redisUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(
        JSON.stringify(value)
      )}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error("Redis write failed.");
    }

    return response.json();
  }

  try {
    const incident = await redisGet("incident_status");

    if (!incident) {
      return res.status(404).json({
        error: "No incident found."
      });
    }

    const incidentStatus = JSON.parse(incident);

    if (!incidentStatus.active || !incidentStatus.startedAt) {
      return res.status(400).json({
        error: "There is no active incident."
      });
    }

    const incidentId = incidentStatus.startedAt;
    const assignmentKey = `assignment:${incidentId}`;

    // Do not create a duplicate assignment.
    const existing = await redisGet(assignmentKey);

    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Assignment already exists.",
        assignment: JSON.parse(existing)
      });
    }

    // Get rider location.
    const riderData = await redisGet("latest_location");

    if (!riderData) {
      return res.status(400).json({
        error: "Rider GPS location is unavailable."
      });
    }

    const rider = JSON.parse(riderData);

    const riderLat = Number(rider.latitude);
    const riderLon = Number(rider.longitude);

    if (
      !Number.isFinite(riderLat) ||
      !Number.isFinite(riderLon)
    ) {
      return res.status(400).json({
        error: "Invalid rider GPS coordinates."
      });
    }

    // Retrieve registered police PCs.
    const indexResponse = await fetch(
      `${redisUrl}/smembers/police_devices`,
      { headers }
    );

    if (!indexResponse.ok) {
      throw new Error("Could not retrieve police devices.");
    }

    const indexData = await indexResponse.json();
    const usernames = indexData.result || [];

    const candidates = [];

    for (const username of usernames) {
      const deviceData = await redisGet(
        `police_device:${username}`
      );

      if (!deviceData) continue;

      const device = JSON.parse(deviceData);

      if (device.status !== "available") continue;

      const lat = Number(device.latitude);
      const lon = Number(device.longitude);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) continue;

      const lastSeen = Date.parse(device.lastSeen);

      if (
        !Number.isFinite(lastSeen) ||
        Date.now() - lastSeen > 90000
      ) continue;

      candidates.push({
        username,
        latitude: lat,
        longitude: lon,
        distanceKm: distanceKm(
          riderLat,
          riderLon,
          lat,
          lon
        )
      });
    }

    if (candidates.length === 0) {
      return res.status(404).json({
        error: "No available police PCs found."
      });
    }

    // Nearest PC first.
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
      resolvedAt: null
    };

    // Create the assignment only if it does not already exist.
    const saveResponse = await fetch(
      `${redisUrl}/set/${encodeURIComponent(assignmentKey)}/${encodeURIComponent(
        JSON.stringify(assignment)
      )}/NX/EX/86400`,
      { headers }
    );

    if (!saveResponse.ok) {
      throw new Error("Could not create assignment.");
    }

    const saveResult = await saveResponse.json();

    if (saveResult.result !== "OK") {
      const latest = await redisGet(assignmentKey);

      return res.status(200).json({
        success: true,
        message: "Assignment already exists.",
        assignment: latest ? JSON.parse(latest) : null
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
