
export default async function handler(req, res) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(500).json({
      error: "Redis is not configured."
    });
  }

  const redisHeaders = {
    Authorization: `Bearer ${redisToken}`
  };

  // Read current incident status.
  if (req.method === "GET") {
    try {
      const response = await fetch(
        `${redisUrl}/get/incident_status`,
        { headers: redisHeaders }
      );

      if (!response.ok) {
        throw new Error("Redis read failed.");
      }

      const result = await response.json();

      if (!result.result) {
        return res.status(200).json({
          active: false,
          reason: null,
          updatedAt: null
        });
      }

      return res.status(200).json(
        JSON.parse(result.result)
      );

    } catch (error) {
      return res.status(500).json({
        error: "Could not read incident status."
      });
    }
  }

  if (req.method === "POST" || req.method === "DELETE") {
    try {
      const readResponse = await fetch(
        `${redisUrl}/get/incident_status`,
        { headers: redisHeaders }
      );

      if (!readResponse.ok) {
        throw new Error("Redis read failed.");
      }

      const readResult = await readResponse.json();

      const previous = readResult.result
        ? JSON.parse(readResult.result)
        : { active: false };

      let status;

      if (req.method === "DELETE") {
        status = {
          active: false,
          reason: null,
          updatedAt: new Date().toISOString()
        };
      } else {
        if (typeof req.body?.active !== "boolean") {
          return res.status(400).json({
            error: "Body must include active: true or false."
          });
        }

        if (req.body.active && previous.active) {
          status = {
            ...previous,
            lastTriggerReason:
              typeof req.body.reason === "string"
                ? req.body.reason.slice(0, 200)
                : previous.lastTriggerReason,
            updatedAt: new Date().toISOString()
          };
        } else {
          status = {
            active: req.body.active,
            reason: req.body.active &&
              typeof req.body.reason === "string"
                ? req.body.reason.slice(0, 200)
                : null,
            lastTriggerReason: req.body.active
              ? (typeof req.body.reason === "string"
                  ? req.body.reason.slice(0, 200)
                  : null)
              : null,
            startedAt: req.body.active
              ? new Date().toISOString()
              : null,
            updatedAt: new Date().toISOString()
          };
        }
      }

      const saveResponse = await fetch(
        `${redisUrl}/set/incident_status/${encodeURIComponent(
          JSON.stringify(status)
        )}`,
        { headers: redisHeaders }
      );

      if (!saveResponse.ok) {
        throw new Error("Redis write failed.");
      }

      let assignment = null;

      // Automatically start assignment for a newly activated SOS.
      const newIncident =
        req.method === "POST" &&
        status.active &&
        !previous.active;

      if (newIncident) {
        const appUrl = process.env.APP_BASE_URL;

        if (appUrl) {
          try {
            const assignmentResponse = await fetch(
              `${appUrl.replace(/\/$/, "")}/api/police-assignment`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({}),
                signal: AbortSignal.timeout(15000)
              }
            );

            assignment = await assignmentResponse.json();

            if (!assignmentResponse.ok) {
              console.error(
                "Assignment creation failed:",
                assignment
              );
            }
          } catch (error) {
            console.error(
              "Could not start police assignment:",
              error.message
            );
          }
        } else {
          console.error("APP_BASE_URL is not configured.");
        }
      }

      return res.status(200).json({
        ...status,
        assignment
      });

    } catch (error) {
      console.error("Incident update failed:", error);

      return res.status(500).json({
        error: "Could not update incident status."
      });
    }
  }

  res.setHeader("Allow", "GET, POST, DELETE");

  return res.status(405).json({
    error: "Method not allowed."
  });
}
