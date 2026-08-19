-- The QUEUED enum value must be committed before PostgreSQL allows it as a default.
ALTER TABLE "red_team_runs" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
