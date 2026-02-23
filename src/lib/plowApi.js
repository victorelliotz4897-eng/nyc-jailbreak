const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const PLOWNYC_REALTIME = "https://plownyc.cityofnewyork.us/mappingapi/api/highlight/info";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export const PARTYPLACE_URL = "https://www.partyplace.com/?ref=nyc-jailbreak";

async function geocodeNycAddress(query) {
  const geocodeUrl =
    `${NOMINATIM_ENDPOINT}` +
    `?q=${encodeURIComponent(query)}` +
    "&format=json&limit=1&countrycodes=us" +
    "&viewbox=-74.2591,40.9176,-73.7004,40.4774&bounded=1";

  const geocodeResponse = await fetch(geocodeUrl, {
    headers: { "User-Agent": "nyc-jailbreak/1.0" },
  });

  if (!geocodeResponse.ok) {
    throw new Error(`Geocode error: HTTP ${geocodeResponse.status}`);
  }

  const geocodeRows = await geocodeResponse.json();
  if (!geocodeRows.length) {
    return null;
  }

  return geocodeRows[0];
}

export async function getPlowData(address) {
  const geocodeMatch =
    (await geocodeNycAddress(address)) ||
    (await geocodeNycAddress(`${address}, New York City, NY`));

  if (!geocodeMatch) {
    throw new Error("Address not found. Try including your borough - e.g. Brooklyn, Manhattan.");
  }

  const { lat, lon } = geocodeMatch;

  const plowUrl = `${PLOWNYC_REALTIME}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&t=${Date.now()}`;

  const plowResponse = await fetch(plowUrl);
  if (!plowResponse.ok) {
    throw new Error(`PlowNYC error: HTTP ${plowResponse.status}`);
  }

  const plowText = await plowResponse.text();
  const plowData = plowText.trim() ? JSON.parse(plowText) : {};

  const lastVisitedRaw = plowData.VisitedTime ?? null;
  const lastVisited = lastVisitedRaw ? new Date(lastVisitedRaw) : null;
  const isPlowed = lastVisited ? Date.now() - lastVisited.getTime() <= THREE_HOURS_MS : false;

  return {
    streetName: plowData.Street ?? address,
    lastVisited,
    isPlowed,
  };
}

export function evaluateStatus({ streetName, lastVisited, isPlowed }) {
  if (!lastVisited) {
    return {
      answer: "NO",
      streetName,
      lastVisited: null,
      detail: "No plow record found for this segment.",
    };
  }

  const ageMs = Date.now() - lastVisited.getTime();

  if (isPlowed) {
    return {
      answer: "YES",
      streetName,
      lastVisited,
      detail: "Plowed in the last 3 hours.",
    };
  }

  if (ageMs <= SIX_HOURS_MS) {
    return {
      answer: "YES",
      streetName,
      lastVisited,
      detail: "Plowed in the last 6 hours.",
    };
  }

  return {
    answer: "NO",
    streetName,
    lastVisited,
    detail: "Last plowed over 6 hours ago.",
  };
}

export function formatTime(date) {
  if (!date) return "unknown time";

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}
