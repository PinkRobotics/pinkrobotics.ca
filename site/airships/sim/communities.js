/* Populated places, as an input to the model rather than as map decoration.
 *
 * A drop line is scored partly on which way its smoke and water would drift relative to
 * people, so this list is a physical input to `targets.js`, not a label layer — which is
 * why it lives with the model and is versioned alongside the code that reads it.
 *
 * Each entry is [longitude, latitude, name, tier]; tier 1 is a city, 2 a town. The set is
 * hand-picked for the interior fire belt and is not exhaustive: a community that is not
 * in this list is not considered at all, which is a limitation of the model rather than
 * an oversight in the data.
 */
export const CITIES = [
  [-123.12, 49.28, "Vancouver", 1], [-123.37, 48.43, "Victoria", 1],
  [-119.49, 49.89, "Kelowna", 1], [-120.33, 50.68, "Kamloops", 1],
  [-122.75, 53.92, "Prince George", 1], [-120.85, 56.25, "Fort St. John", 1],
  [-130.32, 54.32, "Prince Rupert", 1], [-115.77, 49.51, "Cranbrook", 1],
  [-119.59, 49.50, "Penticton", 2], [-119.27, 50.27, "Vernon", 2],
  [-119.68, 49.60, "Summerland", 2], [-119.58, 49.86, "West Kelowna", 2],
  [-119.74, 49.77, "Peachland", 3], [-119.41, 50.05, "Lake Country", 3],
  [-119.55, 49.18, "Oliver", 3], [-119.83, 49.20, "Keremeos", 3],
  [-119.69, 50.82, "Chase", 3], [-118.98, 50.84, "Sicamous", 3],
  [-119.20, 50.45, "Armstrong", 3], [-119.14, 50.55, "Enderby", 3],
  [-120.04, 51.65, "Clearwater", 3], [-120.12, 51.18, "Barriere", 3],
  [-120.81, 50.49, "Logan Lake", 3], [-121.28, 50.72, "Ashcroft", 3],
  [-123.94, 49.16, "Nanaimo", 2], [-122.33, 49.05, "Abbotsford", 2],
  [-121.95, 49.16, "Chilliwack", 2], [-122.49, 52.98, "Quesnel", 2],
  [-122.14, 52.14, "Williams Lake", 2], [-118.20, 51.00, "Revelstoke", 2],
  [-117.29, 49.49, "Nelson", 2], [-128.60, 54.52, "Terrace", 2],
  [-127.17, 54.78, "Smithers", 2], [-120.23, 55.76, "Dawson Creek", 2],
  [-122.70, 58.81, "Fort Nelson", 2], [-125.27, 50.02, "Campbell River", 2],
  [-120.79, 50.11, "Merritt", 2], [-121.44, 49.38, "Hope", 2],
  [-116.96, 51.30, "Golden", 3], [-115.06, 49.50, "Fernie", 3],
  [-117.66, 49.32, "Castlegar", 3], [-117.71, 49.10, "Trail", 3],
  [-119.47, 49.03, "Osoyoos", 3], [-120.51, 49.46, "Princeton", 3],
  [-118.44, 49.03, "Grand Forks", 3], [-121.94, 50.69, "Lillooet", 3],
  [-121.58, 50.23, "Lytton", 3], [-119.28, 50.70, "Salmon Arm", 3],
  [-121.29, 51.64, "100 Mile House", 3], [-123.15, 49.70, "Squamish", 3],
  [-122.96, 50.12, "Whistler", 3], [-124.80, 49.23, "Port Alberni", 3],
  [-125.90, 49.15, "Tofino", 3], [-124.52, 49.84, "Powell River", 3],
  [-127.42, 50.72, "Port Hardy", 3], [-125.76, 54.23, "Burns Lake", 3],
  [-124.01, 54.01, "Vanderhoof", 3], [-123.09, 55.34, "Mackenzie", 3],
  [-119.26, 52.83, "Valemount", 3], [-126.75, 52.37, "Bella Coola", 3],
];
