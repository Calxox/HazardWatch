# HazardWatch

HazardWatch is a web workspace for reviewing bushfire reports from images and videos. It helps a team turn submitted media into a location-confirmed, AI-assisted assessment, review it, and display approved reports on a shared map during the current browser session.

## What it does

- **Collects media and context.** Submit JPEG, PNG, WebP, MP4, WebM, or MOV files up to 25 MB. Add the source and capture time, and provide a location by confirming media GPS, finding an address or place, entering coordinates, or requesting device location.
- **Assesses possible hazard severity.** The optional vision service analyzes an image or sampled video and returns a severity, confidence, feature scores, and an explanation. Uncertain results can be flagged for review.
- **Keeps approval with the reviewer.** Each report remains pending until a person checks the assessment and confirms the location. Approval adds it to the workspace map; it does not dispatch responders or certify that a location is safe.
- **Maps and prioritizes reports.** Review approved reports on a street map across Australia and New Zealand. Filter by severity and map area, inspect report details, and open directions to a selected location.
- **Finds nearby emergency services.** Look up nearby hospitals and fire stations for a confirmed location or selected approved report. The app shows published contact details when available and links to external maps. Emergency calls in Australia go to 000; in New Zealand, 111.
- **Answers questions about approved reports.** The assistant uses the approved reports in the current session as context. Verify its responses against the original media and assessment.

## Run the frontend

Requirements: Node.js 22 or newer and pnpm 10 or newer.

```sh
pnpm install
pnpm --filter frontend dev
```

Open [http://localhost:3000](http://localhost:3000). The workspace opens without an account or database. To connect the optional vision service, set `NEXT_PUBLIC_VISION_API_URL` in `frontend/.env.local` (it defaults to `http://localhost:8000`) and start the service. See [frontend/README.md](frontend/README.md) for service and model setup, and [the IBM Cloud deployment guide](docs/IBM-CLOUD-DEPLOYMENT.md) for deployment.

## How the project is organized

- `frontend/` — Next.js app, report workflow, map, address lookup, and emergency-services lookup.
- `vision-service/` — Python API for media GPS extraction, image/video assessment, and assistant responses.
- `docs/screenshots/` — screenshots and capture manifest documenting the earlier prototype.
- `docs/Shared/` and `docs/ux-ui/` — project requirements, research, and design notes.

The map uses OpenStreetMap street tiles and Photon address lookup. Nearby services are queried from OpenStreetMap data through Overpass. These public services may be incomplete or unavailable; the app provides manual location entry as a fallback.

## Data and limitations

There is no sign-in, database, or shared persistence. Reports, approvals, uploaded media previews, and chat history stay in browser memory and are cleared when the page is reloaded. The vision service needs its model and configuration for real assessments; without it, assessment requests can fail. Media GPS extraction can work without loading the model.

HazardWatch is a review aid, not an emergency dispatch system. Its assessments, service listings, distances, maps, and directions can be incomplete or wrong. It does not provide live fire boundaries, verified evacuation routes, emergency response availability, or a guarantee of safety. In an emergency, contact local emergency services directly.
