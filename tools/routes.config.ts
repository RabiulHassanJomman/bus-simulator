// Playable bus routes. OpenStreetMap has almost no bus route relations for Dhaka (3, all
// incomplete), so routes are defined here as ordered stops along real corridors; tools/routes.ts
// snaps each stop to the matching OSM bus stop and joins them with the road-graph router.
// Coordinates are approximate (WGS84) and only used to find the right OSM stop nearby.

export interface StopSpec {
  name: string;
  nameBn: string;
  lat: number;
  lon: number;
  /** matched against OSM bus stop / place names (English or Bangla) */
  match: RegExp;
}

export interface RouteSpec {
  id: string;
  name: string;
  nameBn: string;
  /** corridor description for the route picker */
  via: string;
  color: number;
  /** price to unlock in career mode (taka); 0 = available from the start */
  unlock: number;
  /** typical demand multiplier (busier corridors) */
  demand: number;
  stops: StopSpec[];
}

const S = (name: string, nameBn: string, lat: number, lon: number, match: RegExp): StopSpec => ({ name, nameBn, lat, lon, match });

// shared stops
const MIRPUR10 = S('Mirpur 10', 'মিরপুর ১০', 23.8069, 90.3687, /mirpur[\s-]*10|মিরপুর[\s-]*১০/i);
const KAZIPARA = S('Kazipara', 'কাজীপাড়া', 23.7975, 90.3725, /kazipara|কাজীপাড়া/i);
const SHEWRAPARA = S('Shewrapara', 'শেওড়াপাড়া', 23.7905, 90.3757, /shewra|শেওড়াপাড়া/i);
const TALTOLA = S('Taltola', 'তালতলা', 23.7843, 90.3777, /taltola|তালতলা/i);
const AGARGAON = S('Agargaon', 'আগারগাঁও', 23.7778, 90.38, /agargaon|আগারগাঁও/i);
const FARMGATE = S('Farmgate', 'ফার্মগেট', 23.7577, 90.3897, /farm\s*gate|ফার্মগেট/i);
const KARWAN = S('Karwan Bazar', 'কারওয়ান বাজার', 23.7509, 90.3935, /kar?wan|কারওয়ান/i);
const BANGLAMOTOR = S('Bangla Motor', 'বাংলামোটর', 23.7462, 90.3953, /bangla\s*motor|বাংলামোটর/i);
const SHAHBAG = S('Shahbag', 'শাহবাগ', 23.7383, 90.3958, /shahbag|শাহবাগ/i);
const MATSYA = S('Matsya Bhaban', 'মৎস্য ভবন', 23.7337, 90.4018, /matsh?ya|মৎস্য/i);
const PRESSCLUB = S('Press Club', 'প্রেস ক্লাব', 23.7325, 90.4055, /press\s*club|প্রেস ক্লাব/i);
const PALTAN = S('Paltan', 'পল্টন', 23.7335, 90.4127, /paltan|পল্টন/i);
const GULISTAN = S('Gulistan', 'গুলিস্তান', 23.7246, 90.4123, /gulistan|গুলিস্তান/i);
const MOTIJHEEL = S('Motijheel', 'মতিঝিল', 23.7262, 90.4207, /motijheel|shapla|মতিঝিল|শাপলা/i);
const SADARGHAT = S('Sadarghat', 'সদরঘাট', 23.7058, 90.4093, /sadarghat|সদরঘাট/i);
const AIRPORT = S('Airport', 'এয়ারপোর্ট', 23.851, 90.408, /airport|বিমানবন্দর|এয়ারপোর্ট/i);
const KHILKHET = S('Khilkhet', 'খিলক্ষেত', 23.8306, 90.4196, /khilkhet|খিলক্ষেত/i);
const KURIL = S('Kuril Bishwa Road', 'কুড়িল বিশ্বরোড', 23.8195, 90.421, /kuril|কুড়িল/i);
const KAKOLI = S('Banani (Kakoli)', 'বনানী (কাকলী)', 23.7957, 90.4024, /kakoli|banani|কাকলী|বনানী/i);
const MOHAKHALI = S('Mohakhali', 'মহাখালী', 23.778, 90.4005, /mohakhali|মহাখালী/i);

export const ROUTES: RouteSpec[] = [
  {
    id: 'mirpur-farmgate',
    name: 'Mirpur 10 – Farmgate',
    nameBn: 'মিরপুর ১০ – ফার্মগেট',
    via: 'Begum Rokeya Sarani, Agargaon',
    color: 0x2e7d32,
    unlock: 0,
    demand: 1,
    stops: [MIRPUR10, KAZIPARA, SHEWRAPARA, TALTOLA, AGARGAON, FARMGATE],
  },
  {
    id: 'mirpur-motijheel',
    name: 'Mirpur 10 – Motijheel',
    nameBn: 'মিরপুর ১০ – মতিঝিল',
    via: 'Farmgate, Karwan Bazar, Shahbag, Paltan',
    color: 0xc62828,
    unlock: 2500,
    demand: 1.2,
    stops: [MIRPUR10, KAZIPARA, SHEWRAPARA, AGARGAON, FARMGATE, KARWAN, BANGLAMOTOR, SHAHBAG, MATSYA, PRESSCLUB, PALTAN, MOTIJHEEL],
  },
  {
    id: 'gabtoli-sayedabad',
    name: 'Gabtoli – Sayedabad',
    nameBn: 'গাবতলী – সায়েদাবাদ',
    via: 'Mirpur Road, Science Lab, Shahbag, Gulistan',
    color: 0x1565c0,
    unlock: 6000,
    demand: 1.15,
    stops: [
      S('Gabtoli', 'গাবতলী', 23.7837, 90.3438, /gabtoli|গাবতলী/i),
      S('Technical', 'টেকনিক্যাল', 23.7805, 90.3496, /technical|টেকনিক্যাল/i),
      S('Kallyanpur', 'কল্যাণপুর', 23.7826, 90.3594, /kall?yanpur|কল্যাণপুর/i),
      S('Shyamoli', 'শ্যামলী', 23.7745, 90.3655, /shyamoli|শ্যামলী/i),
      S('College Gate', 'কলেজ গেট', 23.7695, 90.369, /college\s*gate|কলেজ গেট/i),
      S('Asad Gate', 'আসাদ গেট', 23.76, 90.373, /asad\s*gate|আসাদ গেট/i),
      S('Kalabagan', 'কলাবাগান', 23.747, 90.383, /kalabagan|কলাবাগান/i),
      S('Science Lab', 'সায়েন্স ল্যাব', 23.7389, 90.3836, /science\s*lab|সায়েন্স/i),
      SHAHBAG,
      PRESSCLUB,
      GULISTAN,
      S('Sayedabad', 'সায়েদাবাদ', 23.7186, 90.4268, /sayedabad|saydabad|সায়েদাবাদ/i),
    ],
  },
  {
    id: 'airport-motijheel',
    name: 'Airport – Motijheel',
    nameBn: 'এয়ারপোর্ট – মতিঝিল',
    via: 'Airport Road, Mohakhali, Moghbazar, Malibagh',
    color: 0x6a1b9a,
    unlock: 10000,
    demand: 1.1,
    stops: [
      AIRPORT,
      KHILKHET,
      KURIL,
      KAKOLI,
      MOHAKHALI,
      S('Satrasta', 'সাতরাস্তা', 23.7583, 90.4002, /satrasta|সাতরাস্তা/i),
      S('Moghbazar', 'মগবাজার', 23.7486, 90.4043, /mog(h)?bazar|মগবাজার/i),
      S('Malibagh', 'মালিবাগ', 23.7489, 90.4129, /malibagh|মালিবাগ/i),
      S('Shantinagar', 'শান্তিনগর', 23.7398, 90.414, /shantinagar|শান্তিনগর/i),
      S('Kakrail', 'কাকরাইল', 23.7375, 90.4085, /kakrail|কাকরাইল/i),
      MOTIJHEEL,
    ],
  },
  {
    id: 'uttara-sadarghat',
    name: 'Uttara – Sadarghat',
    nameBn: 'উত্তরা – সদরঘাট',
    via: 'Airport Road, Mohakhali, Farmgate, Shahbag, Gulistan',
    color: 0xef6c00,
    unlock: 18000,
    demand: 1.3,
    stops: [
      S('Abdullahpur', 'আব্দুল্লাহপুর', 23.8797, 90.4005, /abdullahpur|আব্দুল্লাহপুর/i),
      S('House Building', 'হাউস বিল্ডিং', 23.874, 90.4, /house\s*building|হাউস বিল্ডিং/i),
      S('Azampur', 'আজমপুর', 23.8676, 90.4002, /azampur|আজমপুর/i),
      S('Jashimuddin', 'জসীমউদ্দীন', 23.8613, 90.4004, /jash?imuddin|জসীম/i),
      AIRPORT,
      KHILKHET,
      KURIL,
      KAKOLI,
      MOHAKHALI,
      FARMGATE,
      KARWAN,
      SHAHBAG,
      PRESSCLUB,
      GULISTAN,
      SADARGHAT,
    ],
  },
];

