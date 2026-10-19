export function parseCoordinates(value) {
  if (!value || typeof value !== "object") return null;
  const point = value;
  if (typeof point.latitude !== "number" || typeof point.longitude !== "number") return null;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  if (point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) return null;
  return { latitude: point.latitude, longitude: point.longitude };
}

export function isWithinGeofence(point, centerLatitude, centerLongitude, radiusMeters) {
  const latitude = Number(centerLatitude);
  const longitude = Number(centerLongitude);
  const radius = Number(radiusMeters);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
  if (!Number.isFinite(radius) || radius <= 0) return false;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(latitude - point.latitude);
  const dLng = radians(longitude - point.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(point.latitude)) * Math.cos(radians(latitude)) * Math.sin(dLng / 2) ** 2;
  const distance = 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distance <= radius;
}
