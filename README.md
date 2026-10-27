# HazardWatch

HazardWatch is a web workspace for reviewing possible bushfire reports from images and videos. It combines media capture details, a vision service assessment, human review, and a map of approved reports. It is designed to support triage discussions; it does not dispatch responders or provide live fire information.

## How a report moves through the app

1. **Submit media.** Choose a JPEG, PNG, WebP, MP4, WebM, or MOV file up to 25 MB. Add the source and capture time.
2. **Confirm the location.** Confirm GPS found in supported image/video metadata, search for an address or place, enter latitude and longitude, or request the device's current location. The app does not infer a location from what an image depicts.
3. **Request an assessment.** The vision service returns a severity, confidence, feature scores, and an explanation. Results can be flagged for human review when the model indicates uncertainty.
4. **Review and approve.** Check the original media, location, and assessment. Approval adds the report to the map in this browser session; pending reports remain in the report register.
5. **Explore and discuss.** Filter approved reports by severity or map area, inspect their evidence, find nearby hospitals and fire stations, and ask the assistant questions grounded in the approved reports.

The Overview, Map, Reports, and Assistant views share the same in-memory session. Higher severity reports are prioritized ahead of lower severity reports. A map approval is a workspace action; it is not an operational dispatch approval.

## Main capabilities

- **Media location metadata:** reads supported JPEG/PNG/WebP EXIF GPS and selected MP4/MOV QuickTime GPS tags. Unsupported or missing metadata leaves manual location options available.
- **Address and place search:** searches Australia and New Zealand addresses through Photon and uses bundled place data for offline place suggestions. Address results are shown for the user to select and confirm.
- **Australia/New Zealand map:** displays approved reports on OpenStreetMap street tiles, with bundled geography as a fallback. Country and Australian state/territory map filters are available.
- **Nearby emergency services:** looks up hospitals and fire stations within 100 km using OpenStreetMap data through Overpass. Published contacts and external directions are shown when available.
- **Assessment assistant:** answers questions about the approved report set in the current session. Watsonx configuration is optional; the service has a local response fallback.
- **Optional object storage:** when IBM Cloud Object Storage is configured, the vision service can store uploaded evidence and retrieve the model checkpoint. Without it, local model files can be used and uploads are not copied to cloud storage.

## Run locally

Requirements: Node.js 22 or newer and pnpm 10 or newer.

```sh
pnpm install
pnpm --filter frontend dev
```

Open [http://localhost:3000](http://localhost:3000). The frontend starts without an account or database. The vision API URL defaults to `http://localhost:8000`; set `NEXT_PUBLIC_VISION_API_URL` in `frontend/.env.local` if the service is at another address.

To run the vision service, install the Python dependencies from `vision-service/requirements.txt` and start it from the `vision-service/` directory:

```sh
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Real image/video assessment requires the trained `best_bushfire_multitask.pt` model. The service looks for it at `MODEL_PATH`, in the repository root, in the repository's parent, or under `vision-service/models/`; IBM Cloud Object Storage can provide it when configured. GPS extraction does not require the model. See [frontend/README.md](frontend/README.md) for the detailed local workflow and [docs/IBM-CLOUD-DEPLOYMENT.md](docs/IBM-CLOUD-DEPLOYMENT.md) for deployment.

The root [.env.example](.env.example) lists optional service settings. Copy it to `.env` to configure Photon, object storage, or Watsonx. Keep credentials server-side; `NEXT_PUBLIC_*` settings are included in the browser build.

## Project layout

- `frontend/` — Next.js app, report workflow, map, and API routes for address and emergency-services lookup.
- `vision-service/` — Python API for media GPS extraction, image/video assessment, and assistant responses.
- `docs/` — architecture, deployment, project notes, and prototype screenshot evidence.

See [the architecture guide](docs/ARCHITECTURE.md) for request paths and component responsibilities. The screenshot gallery and capture metadata are in [docs/screenshots](docs/screenshots/).

## Data and limitations

There is no sign-in or report database. Reports, approvals, uploaded-media previews, and assistant history live in browser memory and are cleared on reload. If object storage is configured, the vision service may keep a separate copy of submitted media; report records and approval state are still not persisted by the frontend.

The public Photon, OpenStreetMap tile, and Overpass services can be incomplete or unavailable. Model results can be wrong, service listings can be outdated, and distances or directions are not verified safe routes. HazardWatch has no live fire boundaries, responder availability, or dispatch capability. In an emergency, contact local emergency services directly.
