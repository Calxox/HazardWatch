# Street-address search

Date: 8 October 2026

Removed the Blue Mountains preset from the active map. Both countries, Australia and New Zealand remain. The underlying real named-place catalogue is retained, including Blue Mountains as a searchable geographic region.

The existing upload Location field now offers **Find address**, while its offline place suggestions, manual latitude/longitude, device location and metadata confirmation remain. The existing map **Find area** form accepts full street addresses alongside its original places and coordinates. Search results do not automatically confirm a capture location: selecting the returned complete address confirms it. Approved assessed reports use that selected point and full label, through the existing approval flow.

Both callers reuse one server-side lookup and shared validation. Photon returns GeoJSON `[longitude, latitude]`; application state retains signed decimal latitude/longitude and source `address`. A numbered query requires the same full house-number token and matching street words, including common street-type abbreviations. A mismatched number, locality-only result, wrong street, invalid coordinates or another country is rejected. A unit prefix retains the unit text while resolving the building point; unit-level accuracy is not claimed. Longer returned labels are supported up to 240 characters. Edits, another location method, presets and unmounts cancel pending lookups so late responses cannot overwrite a new input.

## Provider and limits

[Photon's maintained public service](https://github.com/komoot/photon#demo-server) explicitly permits reasonable project usage without an API key; large usage can be throttled and availability is not guaranteed. The [API specification](https://github.com/komoot/photon/blob/master/docs/api-v1.md) supports repeated AU/NZ filters and house-layer results. Neither universal address coverage nor a numeric match confidence is promised. Address matches are mapped features, not surveyed coordinates. Missing matches stay unresolved; add locality/postcode or use the unchanged coordinate/GPS options.

The same-origin POST `/api/geocode` keeps addresses out of frontend URL/query logs, validates bounded input, checks browser origin against the request host, times out upstream requests after 8 seconds, caches 100 queries for 10 minutes and limits new upstream searches to one per second in a single server process. No address queries are explicitly logged. The browser explains when the online lookup receives the entered address. Attribution links to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright); ODbL obligations apply when distributing derived data. Existing offline map geography is retained, without adding street tiles or dependencies.

`PHOTON_API_URL` is optional and server-only. Leave it blank for `https://photon.komoot.io/api/`; use a private Photon-compatible `/api/` endpoint as usage grows. Edit root `.env` and restart the frontend. Before expanding to multiple workers, replace the process-local cache/throttle with shared limits. No secret API key is required or added.

Anonymous ArcGIS was not selected because retaining report coordinates requires authenticated geocoding with `forStorage=true`, according to its [storage contract](https://developers.arcgis.com/rest/geocode/find-address-candidates/). Public Nominatim was not selected because its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) forbids autocomplete and requires an informed developer decision before generated integration.

## Verification

The frontend regression checks cover full numbered labels, exact coordinate preservation, no automatic confirmation or suburb fallback, invalid/mismatched results, cancellation, unchanged offline/GPS/manual options, Blue Mountains preset removal and request host/body boundaries. Live checks use the public visitor addresses for State Library Victoria (328 Swanston Street, Melbourne) and Te Papa (55 Cable Street, Wellington). These returned numbered address features from Photon. The local map selected the library's full address and mapped coordinates.

After the user's explicit permission to transmit the example to Photon, the exact query **857 Pascoe Vale Road** was verified through the local app. It returned **857 Pascoe Vale Road, Glenroy, Melbourne, Victoria, 3046, Australia**. Selecting that result displayed its returned point, approximately **-37.7021, 144.9146**, with the full street label. The initial disclosure check was blocked by automatic approval review until destination-specific permission was provided. No coordinates for that example are hardcoded or invented.

The master-document update remains user-managed. No commit, push or contributor attribution was made.

## User-run commit steps

The preceding chatbot/location merge remains pending. Review the complete staged merge and local changes before staging and committing yourself:

```powershell
Set-Location 'D:\FINAL YEaR\ProProj1\garage-boilerplate-basic'
git status
git diff
git diff --cached
git add -- .gitignore .env.example scripts/sync-env.js docs/ENV-VARS.md frontend/README.md frontend/public/prototype frontend/src/app/page.tsx frontend/src/app/api/geocode frontend/src/features/hazardwatch frontend/tests/unit frontend/tsconfig.json frontend/vitest.config.ts vision-service/app/main.py vision-service/app/chat.py vision-service/app/location.py vision-service/tests docs/ux-ui/map-location-investigation.md docs/ux-ui/remove-demo-content.md docs/ux-ui/street-address-search.md
git diff --cached --check
git commit -m "feat: integrate media assessments and precise address mapping"
```

Keep root/generated `.env` files, runtime directories, Python caches and model weights out of the commit. No push command is included.

All 26 frontend checks passed. TypeScript, production build and lint are included in the handoff checks; lint retains five existing image/static-stylesheet advisories and no errors.
