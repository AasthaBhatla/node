# API Deployment

This folder contains the Kaptaan Node API deployment flow we use for production.

## Standard Deploy Flow

Run these steps from the local API repo:

```bash
cd /home/mridul/Documents/M&R\ Projects/Kaptaan/node
git status
git add <files>
git commit -m "your commit message"
git push origin main
./deploy-production.sh
```

## What `deploy-production.sh` Does

It connects to the production server with:

```bash
ssh -i ~/.ssh/id_digitalOcean_kaptaan mridul@167.71.239.140
```

Then it runs:

```bash
cd kaptaan-docker-stack/express-api/
./update.sh
```

## What Remote `update.sh` Does

The remote update script currently:

1. Pulls latest code from Git
2. Stops Docker containers
3. Rebuilds and starts Docker containers
4. Runs database migrations

## Defaults Used By `deploy-production.sh`

- SSH key: `~/.ssh/id_digitalOcean_kaptaan`
- SSH host: `mridul@167.71.239.140`
- Remote directory: `kaptaan-docker-stack/express-api`

These can be overridden if needed:

```bash
SSH_KEY=~/.ssh/other_key SSH_HOST=user@host REMOTE_DIR=/path/to/api ./deploy-production.sh
```

## Future shorthand

If you ask to "deploy the latest API", the intended flow is:

1. Commit the API changes in `node/`
2. Push to `origin main`
3. Run `./deploy-production.sh`
