# ToxiScreen Hub

A lightweight toxicity screening prototype that queries public online chemistry databases and produces a simple assessment across ToxiScreen hazard triage, PASS/POST, toxicity, mutagenicity, and ADME categories.

## Features

- Search by compound name or SMILES
- Direct SMILES lookup through PubChem when a structure string is entered
- Tool-inspired profile views for PASS/POST-style activity, SwissADME-style descriptors, and ToxiScreen hazard triage
- Large batch SMILES upload with deduplication, rapid/steady processing modes, pause/resume, cancellation, progress, and CSV export
- Queries public online sources:
  - PubChem
  - ChEMBL
  - EPA CompTox
- Aggregates the results into a quick screening overview
- Provides a simple web dashboard for reviewing scores
- Role-based access with `tester`, `reviewer`, and `admin` roles

## Run locally

1. Install dependencies:
   npm install
2. Start the app:
   npm start
3. Open the browser at:
   http://localhost:3000

## Deploy with Render

1. Create a new Render Blueprint from this repository, or create a Node Web Service using the settings below. The included Blueprint uses Render's free plan.
2. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` to strong, unique values.
3. Use `npm install` as the build command and `npm start` as the start command.
4. Set the health check path to `/api/health`.
5. Add a paid persistent disk later if you need user accounts and assessments to survive redeploys and restarts.

The included `render.yaml` defines these settings. On the free plan, SQLite data is temporary and can be lost when the service is redeployed or restarted. Use the free deployment for testing and demonstrations until persistent storage is added.

### Roles

- `tester`: run screenings, save personal assessments, and submit feedback.
- `reviewer`: view all saved assessments, export CSV, and update review status and notes.
- `admin`: all reviewer permissions plus user-role management.

Admins can list users with `GET /api/admin/users?token=...` and change a role with `PATCH /api/admin/users/:id/role`, sending `{ "role": "reviewer" }` in the JSON body.

## Install as an app

The deployed website is also an installable Progressive Web App. Open the public HTTPS URL in a supported browser and choose the browser's **Install ToxiScreen** option. On browsers that support the install prompt, the app also shows an **Install app** button in the header.

The installed app still needs an internet connection for public database lookups and server-side accounts. It uses the same URL and backend as the website.

## Public testing

For feedback, testers can open the [GitHub issue form](https://github.com/Jimmy565/toxiscreening/issues/new). Ask them to include the compound entered, the browser/device used, what they expected, what happened, and any screenshot that does not contain private data.

## Notes

This is a prototype for data aggregation and screening workflow demonstration. It is not a regulatory toxicology model or a substitute for validated QSAR or experimental testing. Do not use the default local admin credentials in a deployed environment.

The profile names describe the workflow shape only. The app does not claim to reproduce official Way2Drug or SwissADME models and keeps its own ToxiScreen terminology throughout.
