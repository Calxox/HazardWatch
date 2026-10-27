# Remove demo features and data

Date: 7 October 2026

The active Next.js website now opens with no incident records. It uses uploaded media, service assessments, confirmed locations and explicit map approval.

Removed the preloaded fictional incidents and confidence values, guided tour, reset-to-sample behavior, fixed demo clock/status, example-image upload and sample evidence fallback. The hardcoded named-site questions and scripted frontend answers were removed. Chat now requires an actual approved assessment; service failures show an availability error.

The old standalone page, app, data model and stylesheet were removed from `frontend/public/prototype/`, along with the demo photograph/source/provenance and replaced generic mark. The offline map, named-place geography, Leaflet runtime/license and supplied logo remain. The separate historical prototype source has been removed. Synthetic fixtures remain test-only.

Overview, map, reports, assessment and assistant have empty states. The report register uses one row per upload; approval does not duplicate a row. Removing the final marker keeps its report in the register and leaves an empty map. Report identifiers use `HW-` rather than `DEMO-`.

Reports are still held in browser memory and are cleared on reload. The trained vision weights are still absent, so real severity assessment requires the model setup in [the frontend README](../../frontend/README.md). Removing demo content does not substitute an assessment result.

## Verification

- All 21 frontend tests passed, including an explicit service-failure/no-invented-answer check. TypeScript and production build passed; lint has zero errors and five existing native-image/static-stylesheet advisories.
- Browser checks cover empty overview/register/assessment/assistant, disabled empty-context chat, map without seeded markers, upload controls without an example shortcut, and mobile layout.
- No demo/tour/fictional-data references remain in active frontend source/public files. Video frame sampling remains part of actual classification, and the offline place catalogue remains real geographic data.

## User-run commit steps

The preceding chatbot/location merge remains pending and uncommitted. These commands stage both that implementation and this removal after review. No commit or push has been executed, and no contributor attribution was added.

```powershell
Set-Location 'D:\FINAL YEaR\ProProj1\garage-boilerplate-basic'
git status
git diff
git diff --cached
git add -- .gitignore frontend/README.md frontend/public/prototype frontend/src/app/page.tsx frontend/src/features/hazardwatch frontend/tests/unit/hazardwatch.test.tsx frontend/tests/unit/location-input.test.tsx frontend/tests/unit/map-approval.test.tsx frontend/tsconfig.json frontend/vitest.config.ts vision-service/app/main.py vision-service/app/location.py vision-service/tests docs/ux-ui/map-location-investigation.md docs/ux-ui/remove-demo-content.md
git diff --cached --check
git commit -m "feat: integrate assessed media workflow and remove demo content"
```

Keep `.env`, runtime directories, Python caches and model weights out of the commit. The master-document update remains user-managed.
