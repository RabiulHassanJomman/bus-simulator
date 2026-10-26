// Known Dhaka landmarks with surveyed coordinates (WGS84) used to validate the data.
export interface Landmark {
  name: string;
  lat: number;
  lon: number;
  match: RegExp;
  /** max distance (m) between expected position and the nearest matching feature */
  radius: number;
}

export const LANDMARKS: Landmark[] = [
  { name: 'Shahbag intersection', lat: 23.7383, lon: 90.3958, match: /shahbag|শাহবাগ/i, radius: 400 },
  { name: 'Farmgate', lat: 23.7577, lon: 90.3897, match: /farm\s*gate|ফার্মগেট/i, radius: 500 },
  { name: 'Shapla Chattar (Motijheel)', lat: 23.7262, lon: 90.4207, match: /shapla|শাপলা/i, radius: 400 },
  { name: 'Kamalapur Railway Station', lat: 23.7322, lon: 90.4259, match: /kamalapur|কমলাপুর/i, radius: 500 },
  { name: 'Mohakhali Bus Terminal', lat: 23.7793, lon: 90.4049, match: /mohakhali|মহাখালী/i, radius: 600 },
  { name: 'Uttara Sector 3', lat: 23.8652, lon: 90.3993, match: /sector\s*[-#]?\s*(3|03)\b|সেক্টর\s*৩/i, radius: 900 },
  { name: 'Mirpur 10', lat: 23.8069, lon: 90.3687, match: /mirpur[\s-]*10\b|মিরপুর\s*১০/i, radius: 500 },
];
