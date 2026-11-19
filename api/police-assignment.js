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
