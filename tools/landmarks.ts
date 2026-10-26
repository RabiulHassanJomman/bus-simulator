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
  { name: 'Mohakhali Bus Terminal', lat: 23.7736, lon: 90.4014, match: /mohakhali.*bus terminal|মহাখালী.*বাস টার্মিনাল/i, radius: 400 },
  { name: 'Uttara Sector 3', lat: 23.8652, lon: 90.3993, match: /sector\s*[-#]?\s*(3|03)\b|সেক্টর\s*৩/i, radius: 900 },
  { name: 'Mirpur 10', lat: 23.8069, lon: 90.3687, match: /mirpur[\s-]*10\b|মিরপুর\s*১০/i, radius: 500 },
];

/** Flyovers / elevated roads that must exist as bridge=yes, layer>0 near their real location. */
export const FLYOVERS: Landmark[] = [
  { name: 'Dhaka Elevated Expressway', lat: 23.8, lon: 90.405, match: /elevated expressway|এলিভেটেড এক্সপ্রেসওয়ে/i, radius: 6000 },
  { name: 'Mohakhali Flyover', lat: 23.7785, lon: 90.4, match: /mohakhali flyover|মহাখালী ফ্লাইওভার/i, radius: 1500 },
  { name: 'Kuril Flyover', lat: 23.8195, lon: 90.421, match: /kuril/i, radius: 1500 },
  { name: 'Moghbazar-Mouchak Flyover', lat: 23.748, lon: 90.407, match: /moghbazar|mouchak|মগবাজার/i, radius: 2000 },
  { name: 'Malibagh-Mouchak Flyover', lat: 23.75, lon: 90.413, match: /malibagh/i, radius: 1500 },
  { name: 'Mayor Hanif (Jatrabari) Flyover', lat: 23.715, lon: 90.425, match: /hanif|হানিফ/i, radius: 3000 },
  { name: 'Mirpur-Banani Flyover', lat: 23.815, lon: 90.395, match: /mirpur-banani|মিরপুর-বনানী/i, radius: 2000 },
  { name: 'Khilgaon Flyover', lat: 23.745, lon: 90.426, match: /khilgaon flyover|খিলগাও ফ্লাইওভার/i, radius: 1500 },
];
