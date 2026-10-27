# HazardWatch on IBM Cloud: what is needed to ship

## Live resources (account itz-saas-281, region ca-tor)

| Thing               | Name                                  | Notes                                                                                                                           |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Code Engine project | team7-hazardwatch                     | holds both apps                                                                                                                 |
| API app             | vision-service                        | image in IBM Container Registry `au.icr.io/team7-hazardwatch/vision-service`; 2 CPU, 4 GB, min scale 1; secret `vision-secrets` |
| Website app         | hazardwatch-web                       | image `docker.io/s4052895/hazardwatch-web:<tag>` (private); Code Engine registry secret `dockerhub`; port 8080                  |
| Object storage      | COS bucket named in `COS_BUCKET_NAME` | uploaded evidence is stored here                                                                                                |
| Chat model          | watsonx.ai (Sydney)                   | needs a valid API key + project ID                                                                                              |
| Registry            | ICR free plan (512 MB)                | nearly full; this is why the website image is on Docker Hub                                                                     |

## Live endpoints

- Website: [hazardwatch-web.2gdi2obs220v.ca-tor.codeengine.appdomain.cloud](https://hazardwatch-web.2gdi2obs220v.ca-tor.codeengine.appdomain.cloud)
- Vision API: [vision-service.2gdi2obs220v.ca-tor.codeengine.appdomain.cloud](https://vision-service.2gdi2obs220v.ca-tor.codeengine.appdomain.cloud) ([health](https://vision-service.2gdi2obs220v.ca-tor.codeengine.appdomain.cloud/health), [API docs](https://vision-service.2gdi2obs220v.ca-tor.codeengine.appdomain.cloud/docs))

## Files in this branch

| File                                                                                      | Purpose                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `vision-service/deploy.sh`                                                                | builds and deploys the API from local source                                          |
| `vision-service/Dockerfile`, `.dockerignore`, `requirements.txt`, `app/`                  | the API itself                                                                        |
| `Dockerfile`                                                                              | builds the Next.js website image                                                      |
| `deploy-frontend-local.sh`                                                                | builds the website image with Docker, pushes it to Docker Hub, deploys to Code Engine |
| `deploy.env.example`                                                                      | every variable the scripts need (names only)                                          |
| `vision-service/scripts/edge_tests.sh`, `fp_check.sh`, `check_watsonx.sh`, `check_cos.py` | tests and connectivity checks                                                         |

The model file is not in git or in the image. At start-up the API downloads it from the Object Storage bucket (default key `models/best_bushfire_multitask.pt`, override with `COS_MODEL_KEY`), so that object must exist in the bucket named by `COS_BUCKET_NAME`.

## Secrets: how to share them

`.env` holds real service credentials. Do not post it in chat or commit it.
Share values one at a time through a password manager, or have each teammate create their own IBM API key
after being invited to the IBM account (Manage > Access (IAM) > Users > Invite users).

The real `.env` is deliberately not part of this kit: it holds live COS, Cloudant, and App ID
service-account keys. If a teammate needs to deploy, send them only the four `COS_*` values
(`COS_ENDPOINT`, `COS_API_KEY_ID`, `COS_INSTANCE_CRN`, `COS_BUCKET_NAME`) in a direct message, plus the
`WATSONX_AI_*` values once they are valid. Never send the whole file.

## Deploy the API

1. `ibmcloud login --sso`, install the Code Engine plugin.
2. Put the COS_* (and WATSONX_*) values in `.env` at the repo root (see `deploy.env.example`).
3. `REGION=ca-tor REGISTRY_IMAGE=au.icr.io/team7-hazardwatch/vision-service REGISTRY_SECRET=icr-au bash vision-service/deploy.sh`
4. Check `curl -s <url>/health`. Swagger is at `<url>/docs`.

## Deploy the website

1. Docker Desktop running; a Docker Hub access token (Read & Write); the Code Engine secret `dockerhub` created with it.
2. From the repo root:
   `REGION=ca-tor VISION_URL=<vision-service url> FRONTEND_ENV=<path to frontend/.env.local> REGISTRY_IMAGE=docker.io/<user>/hazardwatch-web REGISTRY_SECRET=dockerhub bash deploy-frontend-local.sh`
3. The script prints the website URL. Build takes 10-20 minutes on Apple chips (linux/amd64 emulation).
4. When the Docker Hub token is rotated: `ibmcloud ce registry update --name dockerhub --password` (paste the new token at the prompt).

## Known limits

- Reports are not saved after a page reload (prototype).
- watsonx chat falls back to a fixed template until valid credentials are set.
- Results under 50% confidence are flagged "needs review" (`MIN_SEVERITY_CONFIDENCE`).
