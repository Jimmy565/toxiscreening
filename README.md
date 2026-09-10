# ToxiScreen Hub

A lightweight toxicity screening prototype that queries public online chemistry databases and produces a simple assessment across STOPTox, PASS/POST, toxicity, mutagenicity, and ADME categories.

## Features

- Search by compound name or SMILES
- Queries public online sources:
  - PubChem
  - ChEMBL
  - EPA CompTox
- Aggregates the results into a quick screening overview
- Provides a simple web dashboard for reviewing scores

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

## Notes

This is a prototype for data aggregation and screening workflow demonstration. It is not a regulatory toxicology model or a substitute for validated QSAR or experimental testing. Do not use the default local admin credentials in a deployed environment.
