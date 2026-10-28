# HazardWatch frontend

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter frontend dev --port 3001 --hostname 127.0.0.1
```

Open http://127.0.0.1:3001. This starts the Next.js frontend in `frontend/`. The workspace starts empty and shows uploaded reports after assessment and approval. Tours, reset controls, example uploads and fictional incidents have been removed.

The root HazardWatch workspace runs without Firebase credentials. Protected boilerplate routes still require their original backend/environment configuration; use the filtered frontend command above for this workspace.

## Local metadata and assessment service

In a second PowerShell terminal, from the repository root, create a local runtime if needed:

```powershell
python -m venv .tools/vision-location
& '.\.tools\vision-location\Scripts\python.exe' -m pip install fastapi uvicorn python-multipart python-dotenv Pillow
Set-Location vision-service
& '..\.tools\vision-location\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

This minimal runtime supports location metadata and the local chat fallback. It is already prepared on this checkout. No trained model is needed for `/v1/media/location`.

Real image/video severity assessment additionally requires `vision-service/requirements.txt` and the trained `best_bushfire_multitask.pt` file. Stop the API before installing/restarting:

```powershell
# Run from the repository root:
& '.\.tools\vision-location\Scripts\python.exe' -m pip install -r vision-service/requirements.txt
# If weights are elsewhere, set their actual path before starting the API:
# $env:MODEL_PATH = 'C:\actual\path\best_bushfire_multitask.pt'
```

The model file `best_bushfire_multitask.pt` is now present in the repository root. Startup looks for an existing file in this order: `MODEL_PATH`, repository root, repository parent, then `models/` inside the repository. Set an absolute `MODEL_PATH` yourself when using a different directory. A missing model still returns a clear error; no synthetic result is substituted. Full inference has not been exercised during path setup.

Both `vision-service/app/main.py` and `chat.py` load configuration from repository `.env`, then parent `.env` for missing settings, followed by python-dotenv's default lookup. Existing process variables take precedence. Chat now resolves the repository root consistently with the API entry point. Configuration files and keys remain user-managed and were not opened or inspected during this setup.

The listed requirements are installed in the local runtime, and PyTorch/torchvision native imports passed. The Watsonx SDK package is installed; credentials and live Watsonx calls were not checked. Restart the vision service after changing paths or configuration. The focused path check uses dummy model files and mocked dotenv calls only:

```powershell
Set-Location vision-service
& '..\.tools\vision-location\Scripts\python.exe' -B -m unittest discover -s tests -p test_runtime_paths.py -v
```

The frontend API URL defaults to `http://localhost:8000`. If a different service URL is needed, set `NEXT_PUBLIC_VISION_API_URL` in the terminal before starting/building the frontend, or use the repository's root `.env` and `pnpm run env:sync`. The API reads root `.env` directly. Its default CORS origins permit localhost/127.0.0.1 on ports 3000/3001; set server-only `CORS_ORIGINS` to a comma-separated origin list for another preview origin.

The chatbot service uses rules grounded in the supplied reports when Watsonx is not configured. Optional Watsonx settings remain server-only; live Watsonx inference has not been validated in this iteration. The frontend requires an approved assessment before questions can be sent. A service failure shows an availability error without inventing an answer.

## Workflow

1. **Submit media**: choose JPEG, PNG, WebP, MP4, WebM or MOV, up to 25 MB.
2. **Add location and time**: explicitly confirm extracted GPS, select a full street-address match using **Find address**, choose a named-place suggestion, apply latitude/longitude, or request device location. Device location needs permission and may differ from the capture location. Capture time defaults to now and must be checked/entered in Sydney AEST/AEDT; file capture timestamps are not extracted.
3. **Review report → Assess severity**: successful assessment creates a session report awaiting map approval.
4. **View my report → Approve and add to map**: adds an eligible report at its confirmed coordinates. Removing approval keeps the report in the register.

Approved hazards are ordered by severity in the overview and map review queue: **Extreme → High → Moderate → Low → None**. Equal severities retain the most recent approval first; reviewing or selecting a hazard does not change its priority.

The map keeps the severity selector and the **Both countries / Australia / New Zealand** quick buttons. Selecting **Australia** reveals **NSW, VIC, QLD, SA, WA, TAS, ACT and NT** beside those buttons (wrapping on small screens). Selecting a state/territory fits its map viewport and limits both markers and the review queue to reports with matching state metadata. Country/state scope remains active when panning or changing severity. Selecting another country clears the state, and **Clear filters** resets severity and map scope.

**Find an area** recognises all eight full state/territory names and their abbreviations; a state match appears ahead of similarly named towns. Selecting it applies the same state scope as the quick button. Exact address/coordinate searches still move to their confirmed point.

Confirmed offline place/address selections retain structured country and state/region metadata. Manual coordinates, device GPS and image/video GPS usually lack state metadata; they remain available in **Both countries** and their national map view but are excluded from a named state filter. State is not guessed from a nearby town or rectangular camera bounds. Existing location labels and exact coordinates remain unchanged. State viewport extents come from [Natural Earth admin-1, version 5.1.1](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/); they control the camera, not membership.

Place suggestions still use the map's offline towns/regions/named places. **Find address** adds online house-level lookup to the upload form; the map's **Find area** uses it when coordinates and offline place search do not resolve the query. Select the complete returned address to confirm its point. Numbered queries require a matching house number and street and never fall back to a suburb centre. Include a suburb or postcode to disambiguate similar addresses. The map covers the current Australia/New Zealand region. Outside-region coordinates cannot be approved for this map.

Street lookup uses [Photon](https://github.com/komoot/photon#demo-server) and OpenStreetMap data, with no API key for modest usage. It runs only on explicit search, through the Next.js `/api/geocode` endpoint; typed addresses go to the lookup provider at that point. Coverage is incomplete and the public service has no availability guarantee. Missing addresses remain unresolved and the existing manual/GPS methods remain usable. Address points represent mapped buildings/address features, not surveyed or unit-level locations. The Leaflet map now loads OpenStreetMap street tiles showing roads, buildings and mapped green areas. Bundled country geography remains underneath as a fallback if tiles fail. Named-place labels are hidden once street detail loads to avoid duplicate labels. The Blue Mountains map preset has been removed; the region remains searchable as a real place.

Optional server-only `PHOTON_API_URL` can select a Photon-compatible `/api/` endpoint in root `.env`; run `pnpm run env:sync` and restart the frontend after changing it. Leave it blank for the default. Requests are bounded, have an 8-second provider timeout, and use a 100-query/10-minute in-memory cache plus one request per second per server process. Use a private service and shared rate limiting before expanding deployment beyond modest single-process use. Display [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) when showing or distributing geocoded results.

Image GPS supports JPEG/PNG/WebP EXIF. Video GPS supports selected static MP4/MOV QuickTime tags. Missing/unsupported metadata or service failure leaves manual location methods available. See [supported formats and samples](../vision-service/tests/fixtures/README.md).

## Location validation and fallbacks

The upload form rejects invalid decimal coordinates with field-specific latitude/longitude range messages. Valid GPS metadata must be explicitly confirmed; missing/unsupported GPS, invalid metadata and service failures leave place/address, manual coordinates and device-location methods available. Controlled invalid-metadata reasons are shown separately from generic service failures. Metadata requests are cancelled or ignored after file replacement/close and have an eight-second timeout. No fallback invents a capture location.

Map search validates longitude in the canonical **-180 to 180** range before converting it for the NZ antimeridian display. Signed decimal coordinate queries that are invalid or outside coverage show a local correction message instead of being sent to address lookup. Invalid report coordinates are skipped. Selected-area labels, marker tooltips and accessible marker labels show six decimal places and canonical signed longitude; stored coordinates retain their original precision. At the same map point, the higher-priority marker appears above lower-priority markers, and hovering raises a marker for inspection. Clicking still opens its existing selected-hazard panel.

Regression coverage includes exact valid image/video GPS, files without GPS, malformed/out-of-range metadata, invalid entered coordinates, stale extraction/device/address responses, coordinate order, the NZ antimeridian, map approval, marker clicks and street-tile failure fallback. Isolated extraction tests use synthetic JPEG/PNG/WebP/MP4/MOV fixtures; proprietary/timed video GPS, XMP-only GPS and HEIC/AVIF are not supported. Extraction tests can run independently of the vision/model runtime.

## Nearby hospitals and fire stations

The Overview has **Find closest emergency service** above the report summary, with emergency call links: **000 in Australia** and **111 in New Zealand**. It reuses the media form's address/place search, coordinate validation and device location. Select a complete address/place match or explicitly apply coordinates to start the lookup. Editing that location clears the previous results. Device location is requested only when the button is pressed; address and coordinate methods remain available if positioning fails. Address lookup shares the typed address with Photon on explicit search; emergency lookup shares the confirmed coordinates with Overpass. No API key or environment change is required.

Selecting an approved hazard automatically displays **up to three hospitals and three fire stations**, ranked separately by straight-line distance within **100 km**. Lookup stays centred on the selected approved hazard when the map is panned or zoomed, even if that hazard or the services leave the visible viewport. Selecting another hazard changes the lookup centre. The review queue still follows the map view and filters; the selected-hazard details remain visible with an outside-view note when necessary. These results sit beneath the map, with separate **H1–H3 / F1–F3** map markers; police and ambulance stations are excluded. Markers do not affect incident counts, priority or filters. Each result shows its name, distance, mapped address, published telephone and website where available, plus Google Maps / Apple Maps directions. Coordinates and emergency-department notes are omitted from the results; exact coordinates remain in use for distance ranking, map markers and directions. Missing contacts are marked as not listed. A hospital result is not a guarantee of emergency care. Empty, partial and unavailable results are explained, with retry for service failures.

The Next.js **POST /api/emergency-services** endpoint sends a bounded query to the server-only `OVERPASS_API_URL` (defaults to `https://overpass-api.de/api/interpreter`), restricting hospital/fire-station features to Australia/New Zealand country areas. It validates request/response coordinates, sanitizes published contacts, rejects query injection and cross-origin browser calls, limits response size, uses a 25-second provider timeout, and caches up to 100 exact-coordinate searches for ten minutes in memory. Identical pending searches share one provider request; the process limits concurrency and request frequency. No coordinates are written to files or the database. Public instances are suitable for modest local development only; use a dedicated instance and shared limits for public deployment, per [Overpass guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

If the finder fails both locally and online, inspect the frontend server logs: `Emergency service lookup failed` records the upstream HTTP status or error type without logging coordinates, provider URLs or response bodies. The public provider can return capacity errors or time out even when map tiles and directions work. Configure a working complete interpreter URL as `OVERPASS_API_URL` in root `.env`, run `pnpm run env:sync`, and restart the frontend. For IBM Code Engine, set the same server-side variable on the frontend application and create a new revision. Changing a local setting does not update the deployed application. The endpoint must have AU/NZ or global coverage and support the country-area query; check its usage/privacy policy before using it. Configuration does not make an overloaded provider healthy.

Data © OpenStreetMap contributors may be incomplete or outdated. Distances are not driving times; opening hours, crew availability, response times and route safety are unverified. This finder is not an emergency dispatch service. Emergency number sources: [Australian Triple Zero](https://www.triplezero.gov.au/) and [New Zealand emergency services](https://www.govt.nz/browse/law-crime-and-justice/emergencies/call-111-in-an-emergency/). Feature/contact tags: [fire stations](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dfire_station), [hospitals](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dhospital), and [published contacts](https://wiki.openstreetmap.org/wiki/Key:contact).

## Street map and external directions

The map loads `https://tile.openstreetmap.org/{z}/{x}/{y}.png` for the visible viewport only, with visible OpenStreetMap attribution and normal browser caching/referrer behavior. There is no API key, bulk download, offline tile archive or new dependency. Follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); the public service has no availability guarantee and a dedicated provider is needed as usage grows. Street detail requires internet access and does not supply photographic satellite imagery or live fire boundaries. The mask leaves coastal viewing regions around Australia/New Zealand open, then hides neighboring foreign land using bundled Natural Earth polygons. This preserves coastal labels and roads instead of clipping street tiles at the shoreline. The detailed country outlines remain the offline fallback. Boundaries are approximate; report coordinates and markers remain unchanged. Viewport tile requests go to OpenStreetMap when the map opens.

Select a hazard marker or review-queue item to see its location and **Google Maps** / **Apple Maps** directions in the selected-hazard panel. The same links appear in its assessment. They pass validated, unrounded, canonical destination coordinates (including negative longitudes across the NZ antimeridian) and driving mode. They omit the origin so Maps uses the person's current location or asks for a starting point, rather than reusing the media's capture location as the origin. No additional HazardWatch geolocation request is made.

The links open an external app or browser in a new tab only when selected; no routing API, API key or billing setup is needed. Google supports cross-platform [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). Apple's [unified Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls) support iOS 18.4+, macOS 15.4+ and watchOS 11.4+; app/browser behavior depends on the device. The chosen provider receives the destination coordinates. Directions are ordinary routing and are not verified safe evacuation or dispatch routes.

## Screens and components

`src/app/page.tsx` renders the client workspace in `src/features/hazardwatch/`. Hash navigation preserves session state between overview, map, assessment, media reports and assistant.

- `components/HazardWorkspace.tsx`: navigation, empty initial state, reports/approval and conversation.
- `components/Screens.tsx`: overview, review queue, filters, report register and assistant.
- `components/HazardMap.tsx`: React lifecycle around Leaflet, online street tiles and offline geography.
- `components/HazardDirections.tsx`: shared selected-hazard/assessment location and external directions.
- `components/ImageUpload.tsx` and `LocationInput.tsx`: media/context/review, metadata confirmation, coordinates and location fallbacks.
- `components/ClassificationResult.tsx`: assessment evidence, uncertainty and review mark, including video/date/source context.
- `model.ts`, `location.ts`, `api.ts`: context/coordinate validation, report-to-map conversion and service calls.
- `hazardwatch.css`: scoped responsive styles. The supplied logo retains the requested 15% enlargement.

Existing shared components, local map assets and installed frontend dependencies are reused.

## Session limits

Only uploaded evidence and returned assessment results enter the report register and map. There are no preloaded incident records or reference photographs. Assessment results require the vision service/model; metadata never guesses a location from visible content.

Reports, approval, review marks, media blob previews and conversation stay in browser memory. Navigation preserves them; reloading clears them and returns to an empty workspace. Stopping the server does not clear an already-open page until reload. There is no database persistence or shared reviewer approval.

The old standalone files were removed from `frontend/public/prototype/`, including their dummy data and example imagery. This public directory now retains the offline map, geography, Leaflet runtime/license and HazardWatch branding. The original repository-level `prototype/` is historical source and is not served by the current frontend.

## Checks and handoff

```powershell
pnpm --filter frontend typecheck
pnpm --filter frontend lint
pnpm --filter frontend test
pnpm --filter frontend build
# From vision-service/, with httpx available for HTTP boundary checks:
& '..\.tools\vision-location\Scripts\python.exe' -B -m unittest discover -s tests -p test_location.py -v
```

The frontend tests cover empty screens, real file inputs, location choices, approval before mapping and removal of the last marker. Synthetic backend samples/checks are in `vision-service/tests/` and are not exposed by the website. See [street-address search notes](../docs/ux-ui/street-address-search.md), [demo-removal notes and user-run commit steps](../docs/ux-ui/remove-demo-content.md), [map/location findings](../docs/ux-ui/map-location-investigation.md), and [the earlier RAW MVP scaffold record](../docs/ux-ui/raw-mvp-frontend.md) for history. The master-document update will be completed by the user.
