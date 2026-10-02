// Fixed tasking list for targeted imagers (SatVu): 80 major cities on all continents.
// Urban heat is SatVu's main use case. Read-only: users can't add targets (decided 2026-10-02).

const CITIES = [
  // Asia
  ['Tokyo', 35.68, 139.69], ['Osaka', 34.69, 135.50], ['Seoul', 37.57, 126.98], ['Beijing', 39.90, 116.41],
  ['Shanghai', 31.23, 121.47], ['Guangzhou', 23.13, 113.26], ['Shenzhen', 22.54, 114.06], ['Hong Kong', 22.32, 114.17],
  ['Chengdu', 30.57, 104.07], ['Wuhan', 30.59, 114.31], ['Taipei', 25.03, 121.57], ['Manila', 14.60, 120.98],
  ['Bangkok', 13.76, 100.50], ['Ho Chi Minh City', 10.82, 106.63], ['Hanoi', 21.03, 105.85], ['Kuala Lumpur', 3.14, 101.69],
  ['Singapore', 1.35, 103.82], ['Jakarta', -6.21, 106.85], ['Dhaka', 23.81, 90.41], ['Kolkata', 22.57, 88.36],
  ['Delhi', 28.61, 77.21], ['Mumbai', 19.08, 72.88], ['Bengaluru', 12.97, 77.59], ['Chennai', 13.08, 80.27],
  ['Karachi', 24.86, 67.01], ['Lahore', 31.55, 74.34], ['Tehran', 35.69, 51.39], ['Riyadh', 24.71, 46.68],
  ['Dubai', 25.20, 55.27], ['Baghdad', 33.31, 44.36], ['Istanbul', 41.01, 28.98], ['Tashkent', 41.30, 69.24],
  // Europe
  ['London', 51.51, -0.13], ['Paris', 48.86, 2.35], ['Madrid', 40.42, -3.70], ['Barcelona', 41.39, 2.17],
  ['Rome', 41.90, 12.50], ['Milan', 45.46, 9.19], ['Berlin', 52.52, 13.40], ['Munich', 48.14, 11.58],
  ['Vienna', 48.21, 16.37], ['Warsaw', 52.23, 21.01], ['Amsterdam', 52.37, 4.90], ['Stockholm', 59.33, 18.07],
  ['Moscow', 55.76, 37.62], ['Saint Petersburg', 59.93, 30.34], ['Kyiv', 50.45, 30.52], ['Athens', 37.98, 23.73],
  // Africa
  ['Cairo', 30.04, 31.24], ['Lagos', 6.52, 3.38], ['Kinshasa', -4.44, 15.27], ['Johannesburg', -26.20, 28.05],
  ['Cape Town', -33.92, 18.42], ['Nairobi', -1.29, 36.82], ['Addis Ababa', 9.03, 38.74], ['Casablanca', 33.57, -7.59],
  ['Algiers', 36.75, 3.06], ['Accra', 5.60, -0.19], ['Khartoum', 15.50, 32.56], ['Luanda', -8.84, 13.23],
  // North America
  ['New York', 40.71, -74.01], ['Los Angeles', 34.05, -118.24], ['Chicago', 41.88, -87.63], ['Houston', 29.76, -95.37],
  ['Phoenix', 33.45, -112.07], ['Toronto', 43.65, -79.38], ['Montreal', 45.50, -73.57], ['Vancouver', 49.28, -123.12],
  ['Mexico City', 19.43, -99.13], ['Miami', 25.76, -80.19],
  // South America
  ['São Paulo', -23.55, -46.63], ['Rio de Janeiro', -22.91, -43.17], ['Buenos Aires', -34.60, -58.38], ['Lima', -12.05, -77.04],
  ['Bogotá', 4.71, -74.07], ['Santiago', -33.45, -70.67],
  // Oceania
  ['Sydney', -33.87, 151.21], ['Melbourne', -37.81, 144.96], ['Perth', -31.95, 115.86], ['Auckland', -36.85, 174.76],
];

const DEG = Math.PI / 180;

/** [{ id, name, latDeg, lonDeg, u }] with u = planet-fixed unit vector. */
export const TARGETS = CITIES.map(([name, lat, lon], id) => ({
  id, name, latDeg: lat, lonDeg: lon,
  u: [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)],
}));
