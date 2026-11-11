---
title: "Terraform state in PostgreSQL"
description: "Move Terraform state from a local file into a shared, locked PostgreSQL database, with migration and rollback steps."
sidebar:
  order: 2
---

Terraform state used to live only on the Coder LXC, as a local
`terraform.tfstate` per root module. That file is the only record of what
Terraform built: lose it and Terraform no longer knows the VMs exist, and two
machines running the same module keep diverging copies. State now lives in the
`terraform_state` database on the PostgreSQL LXC, shared by Coder and Semaphore
and locked while a run writes it.

Why PostgreSQL and not MinIO/S3: the database already existed, locking is built
into the `pg` backend, and Terraform cannot destroy the LXC that holds its own
state (that LXC is not Terraform-managed). S3-style storage would add version
history but is a new service to run; MinIO's free edition was also scaled back
during 2025. HCP Terraform was ruled out because the state includes
`talosconfig` (full cluster control).

## 1. Database and login

On the PostgreSQL LXC, as root. **Run each command on its own.** Inside `psql`,
a backslash command such as `\password` swallows the rest of a pasted line, so
a pasted block of SQL silently does nothing after it.

```bash
# What you're working with
sudo -u postgres psql -Atc "SELECT version();" -c "SHOW hba_file;" \
  -c "SHOW listen_addresses;" -c "SHOW ssl;" -c "SHOW password_encryption;"

# A password of letters and digits only (no URL encoding needed); store it in your password manager
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32; echo

sudo -u postgres psql -c "CREATE ROLE terraform LOGIN;"
sudo -u postgres psql -c '\password terraform'
sudo -u postgres psql -c "CREATE DATABASE terraform_state OWNER terraform;"
sudo -u postgres psql -c "REVOKE ALL ON DATABASE terraform_state FROM PUBLIC;"
sudo -u postgres psql -d terraform_state -c "REVOKE ALL ON SCHEMA public FROM PUBLIC;" -c "ALTER SCHEMA public OWNER TO terraform;"

# Check
sudo -u postgres psql -Atc "SELECT rolname, rolcanlogin, rolpassword IS NOT NULL FROM pg_authid WHERE rolname = 'terraform';"   # terraform|t|t
sudo -u postgres psql -Atc "SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'terraform_state';"         # terraform_state|terraform
```

Terraform creates one schema per root module inside this database, which it can
do because it owns the database.

If `listen_addresses` is `localhost`, set it to `*` and restart PostgreSQL
(other apps' connections drop briefly); access is controlled by `pg_hba.conf`.

## 2. Access: only the runners

The state holds secrets in plain text, so only Semaphore and Coder may connect,
and only as `terraform`. These lines go at the **top** of `pg_hba.conf` (first
match wins, so a broad rule further down can't let others in):

```bash
HBA=$(sudo -u postgres psql -Atc "SHOW hba_file;")
cp -a "$HBA" "$HBA.bak.$(date +%F)"
{
  echo "# Terraform state: only Semaphore and Coder, only the terraform role"
  echo "hostssl terraform_state terraform SEMAPHORE_IP/32 scram-sha-256"
  echo "hostssl terraform_state terraform CODER_IP/32     scram-sha-256"
  echo "host    terraform_state all       0.0.0.0/0       reject"
  echo "host    terraform_state all       ::/0            reject"
  echo
  cat "$HBA.bak.$(date +%F)"
} > "$HBA"
sudo -u postgres psql -c "SELECT pg_reload_conf();"
sudo -u postgres psql -c "SELECT line_number, type, database, user_name, address, error FROM pg_hba_file_rules WHERE error IS NOT NULL OR 'terraform_state' = ANY(database);"
```

Use `host` instead of `hostssl` (and `sslmode=disable` in the connection
string) only if `SHOW ssl` was `off`. Test from a runner:

```bash
psql "postgres://terraform@POSTGRES_HOST:5432/terraform_state?sslmode=require" -c "SELECT current_user;"
```

From any other machine (an AI node) the same command must be refused.

## 3. Backups

- **PBS** backs up the whole LXC: disaster recovery.
- **Optional nightly dump** for restoring only the state without rolling back
  the other apps' databases on the same server. The dumps live on the LXC, so
  PBS carries them off-box.

  ```bash
  install -d -o postgres -g postgres -m 700 /var/backups/terraform_state
  cat > /etc/cron.d/terraform-state-backup <<'EOF'
  15 2 * * * postgres pg_dump -Fc terraform_state > /var/backups/terraform_state/terraform_state-$(date +\%F).dump && find /var/backups/terraform_state -name '*.dump' -mtime +30 -delete
  EOF
  # restore: pg_restore -c -d terraform_state <file>.dump
  ```

  This runs on the **PostgreSQL LXC**, not Semaphore (there is no `postgres`
  user there).
- **Planned:** a dump before every apply, as a step in Semaphore's apply
  template. The `pg` backend keeps only the current state, so dumps are the
  history.

## 4. Backend in the repository

Each root module opts in with a `backend.tf`:

```hcl
terraform {
  backend "pg" {
    schema_name = "ubuntu_servers"
  }
}
```

The connection string never goes in the repository. It comes from the
environment:

```
PG_CONN_STR=postgres://terraform:<password>@<postgres-host>:5432/terraform_state?sslmode=require
```

`homelab-terraform` is published as a sanitized public copy. The promotion workflow
deletes every `backend.tf` (and `lab.auto.tfvars`) before publishing, so public
users keep local state.

| Root module | Schema | State |
|---|---|---|
| `ubuntu-servers/` | `ubuntu_servers` | PostgreSQL |
| `homelab/*` (Talos, HAProxy, Flux) | — | Local for now: `flux` reads `talos-mgmt`'s kubeconfig as a local file, which a fresh Semaphore checkout doesn't have |

## 5. Migrating a module from local state

Done once per module, on the machine that holds its `terraform.tfstate`, with
nobody else running Terraform on it. The migration **is** the branch's real run.

```bash
cd homelab-terraform/ubuntu-servers
git switch main && git pull
terraform plan                      # must say: No changes (still local state)
install -d -m 700 ~/tfstate-backup && cp -p terraform.tfstate ~/tfstate-backup/ubuntu-servers-$(date +%F).tfstate
read -rsp 'terraform DB password: ' P; echo
export PG_CONN_STR="postgres://terraform:${P}@<postgres-host>:5432/terraform_state?sslmode=require"
git fetch && git switch feat/pg-state-backend    # the branch that adds backend.tf
terraform init -migrate-state       # answer: yes
terraform plan                      # must still say: No changes
mv terraform.tfstate terraform.tfstate.backup ~/tfstate-backup/ 2>/dev/null || true
```

If the second plan wants to create anything, **do not apply**. Roll back:

```bash
terraform state pull > ~/tfstate-backup/ubuntu-servers-from-pg.tfstate
mv backend.tf ~/backend.tf.disabled
cp -p ~/tfstate-backup/ubuntu-servers-<date>.tfstate terraform.tfstate
terraform init -reconfigure
terraform plan   # No changes
```

A run interrupted mid-apply can leave a lock; `terraform force-unlock <id>`
clears it once you're sure nothing else is running.
