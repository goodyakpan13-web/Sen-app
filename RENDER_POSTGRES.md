# SEN on Render + PostgreSQL

## Blueprint deployment
The included `render.yaml` creates:
- `sen-api` Node web service
- `sen-db` PostgreSQL database
- `DATABASE_URL` wired from the database to the web service
- generated `SEN_JWT_SECRET`
- HTTPS health check at `/api/health`
- a 10 GB persistent disk mounted at `/app/uploads` for the starter video uploader

### Deploy
1. Push the SEN project to GitHub.
2. In Render, create a Blueprint and select the repository.
3. Review the services and costs before applying.
4. Deploy the blueprint.
5. Open the generated SEN URL and test `/api/health`.

The app initializes its PostgreSQL tables automatically on startup. `db/schema.sql` is also included for reference/manual migrations.

## Render environment variables
The blueprint supplies the database URL and JWT secret. Add TURN variables when you have a TURN service:

- `TURN_URL`
- `TURN_USERNAME`
- `TURN_PASSWORD`

## Video storage note
The starter build uses `/app/uploads`. The Render persistent disk prevents uploads from disappearing on restart, but this is not ideal for horizontal scaling or a large video platform. Before scaling SEN, move video files to S3-compatible object storage/CDN and keep only metadata in PostgreSQL.
