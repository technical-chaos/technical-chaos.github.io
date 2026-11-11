---
title: "Semaphore"
description: "Run Terraform and Ansible from Semaphore: install, keys, variable groups, repositories, inventory and templates."
sidebar:
  order: 4
---

Semaphore runs both Terraform and Ansible, from Git, with every key in its Key
Store. The Semaphore LXC runs Ubuntu 24.04 and the service runs as **root**.

## Install Terraform on the Semaphore LXC

Semaphore calls `terraform` from the host. Run each command **on its own**:
`apt-get` reads from the terminal while it runs and swallows the rest of a
pasted block.

```bash
curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
```
```bash
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com noble main" > /etc/apt/sources.list.d/hashicorp.list
```
```bash
apt-get update
```
```bash
apt-get install -y terraform
```
```bash
terraform version
```

## Give Semaphore's tasks a HOME

The Proxmox provider opens SSH to upload cloud-init snippets and looks for
`~/.ssh/known_hosts`, which needs `$HOME`. Semaphore starts tasks without it, and
a `HOME` variable in a variable group is **not** passed through. Set it on the
service:

```bash
mkdir -p /etc/systemd/system/semaphore.service.d
printf '[Service]\nEnvironment=HOME=/root\n' > /etc/systemd/system/semaphore.service.d/home.conf
systemctl daemon-reload
systemctl restart semaphore          # stops running tasks; do it while idle
systemctl show semaphore -p Environment
```

And the Proxmox SSH key and host key:

```bash
chmod 600 /root/.ssh/proxmox_terraform_key                     # the key at TF_VAR_pm_ssh_private_key_path
ssh-keyscan -H pve2 >> /root/.ssh/known_hosts            # or the Proxmox IP
```

## Key Store

| Name | Type | Contents | Used by |
|---|---|---|---|
| `github-access` | Login with password | GitHub user + token | Cloning the private repos over HTTPS |
| `vault-pass` | Login with password | Ansible Vault password (password field) | Ansible templates' Vault password |
| `ansible-ssh` | SSH Key | Username `ansible` + **private** key | Ansible logging in to hosts |
| `ansible-become` | Login with password | `ansible` + sudo password | Only for hosts without passwordless sudo |

Only the private half of an SSH key goes in the Key Store. The public half goes
on the hosts (`authorized_keys`) and, for VMs Terraform builds, in
`TF_VAR_ssh_public_keys`.

## Variable groups

All values are stored under **Secrets**. Ansible reads **Extra variables**
(passed as `-e`); Terraform reads **Environment variables** (`TF_VAR_*`).

**`terraform-ubuntu-servers`** (Secrets → Environment variables)

| Name | Value |
|---|---|
| `PG_CONN_STR` | `postgres://terraform:<password>@<postgres-host>:5432/terraform_state?sslmode=require` |
| `TF_VAR_pm_api_url` | Proxmox API URL |
| `TF_VAR_pm_api_token` | Proxmox API token |
| `TF_VAR_pm_ssh_private_key_path` | Path of the Proxmox SSH key **on the Semaphore host**, e.g. `/root/.ssh/proxmox_terraform_key` |
| `TF_VAR_ssh_public_keys` | `["ssh-ed25519 AAAA... one", "ssh-ed25519 AAAA... two"]` |
| `TF_VAR_snippets_datastore_id` | Datastore with Snippets enabled |
| `TF_VAR_image_download_datastore_id` | Datastore for the cloud image |

**`ai-dev-setup`** (Secrets → **Extra variables**)

| Name | Value |
|---|---|
| `vault_ai_dev_github_token` | GitHub token installed on the AI nodes for the agents (`repo`, `read:org`, plus `workflow` if they edit workflows). Use a token separate from `github-access` so it can be limited and revoked on its own |

Semaphore warns that extra-variable secrets may appear in Ansible logs. The
playbook's token tasks suppress their output, so it doesn't show in normal runs;
avoid `-vvv` on this template.

## Repositories

| Name | URL | Branch | Key |
|---|---|---|---|
| `homelab-terraform (branch)` | `https://github.com/example-org/homelab-terraform.git` | the PR branch under test, `main` after merge | `github-access` |
| `homelab-ansible (branch)` | `https://github.com/example-org/homelab-ansible.git` | the PR branch under test, `main` after merge | `github-access` |

One repository entry per branch under test keeps branch runs separate from the
`main` templates.

## Inventory

| Field | Value |
|---|---|
| Name | `home` |
| Type | File |
| Path | `inventory/home/host` |
| User credentials | `ansible-ssh` |
| Sudo credentials | None (Terraform-built VMs have passwordless sudo) |

## Templates

**`ubuntu-servers plan`** (type Terraform)

| Field | Value |
|---|---|
| Repository | `homelab-terraform (...)` |
| Subdirectory | `ubuntu-servers` (no backticks or quotes) |
| Variable group | `terraform-ubuntu-servers` |
| Auto-approve | **off**: Semaphore stops after the plan and waits for Confirm |

**`ai-dev-setup (branch)`** (type Ansible)

| Field | Value |
|---|---|
| Playbook | `ai-dev-setup.yml` |
| Inventory | `home` |
| Repository | `homelab-ansible (branch)` |
| Variable group | `ai-dev-setup` |
| Vault password | `vault-pass` |
| CLI args | `["--limit", "ai-test-01"]` |
| Allow CLI args in task | on |

## Running a branch for real

**Ansible:** `--check --diff` first (preview), then a real run, then a second real
run that should show `changed=0`. Post each `PLAY RECAP` on the PR.

**Terraform:** read the plan before confirming. Search the log for `Plan:`,
`will be`, `must be` and `forces replacement`. Anything destroyed or replaced that
you didn't intend means stop. The note *"You didn't use the -out option…"* only
appears when the plan has changes; with none, Terraform prints `No changes.`

## Planned

- Templates pinned to `main`, plus a monthly `ai-dev-setup` apply (T3 worker
  links expire after 30 days).
- A dump of `terraform_state` before every Terraform apply.
- A restricted Semaphore user with the Task Runner role, and a `semaphore`
  command plus Claude skill so agents can start runs and read logs.
