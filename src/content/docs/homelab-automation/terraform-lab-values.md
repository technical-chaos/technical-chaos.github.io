---
title: "Terraform lab values"
description: "Split terraform.tfvars into committed, non-secret lab values and runner-held secrets."
sidebar:
  order: 3
---

When Terraform runs in Semaphore, it needs every value that used to sit in the
gitignored `terraform.tfvars` on Coder. Without the `servers` list a run sees
zero servers and **plans to destroy every VM**. The values are split:

| Kind | Where | Why |
|---|---|---|
| Secrets and per-runner settings | Semaphore variable group, as `TF_VAR_*` environment variables | Never in Git |
| Everything else: `servers`, network, image, VM defaults | `ubuntu-servers/lab.auto.tfvars`, committed | Agents can open PRs that add VMs; Semaphore loads it automatically |

`lab.auto.tfvars` is tracked through a `.gitignore` exception (`!lab.auto.tfvars`)
and deleted by the public promotion, like `backend.tf`. `terraform.tfvars`
stays ignored.

## Variables that live in Semaphore, not the file

```
pm_api_url
pm_api_token
pm_ssh_private_key_path
ssh_public_keys
snippets_datastore_id
image_download_datastore_id
```

## Making `lab.auto.tfvars`

On Coder, in `ubuntu-servers/`:

```bash
cp terraform.tfvars lab.auto.tfvars
```

**Delete** each of the lines above from `lab.auto.tfvars` (for `ssh_public_keys`,
the whole `[ ... ]` list). **Do not leave them empty**: a `.auto.tfvars` value
overrides `TF_VAR_*`, so `pm_api_token = ""` would replace Semaphore's real token
with an empty one.

Check nothing secret is left. Both commands must print nothing:

```bash
grep -nE '^\s*(pm_api_url|pm_api_token|pm_ssh_private_key_path|ssh_public_keys|snippets_datastore_id|image_download_datastore_id)\s*=' lab.auto.tfvars
grep -nE 'PVEAPIToken|@pve|BEGIN .*PRIVATE|ssh-(ed25519|rsa) ' lab.auto.tfvars
```

Then:

```bash
terraform fmt lab.auto.tfvars       # the promotion workflow's fmt -check covers .tfvars
terraform plan                      # still: No changes
git add ubuntu-servers/lab.auto.tfvars   # only this file
git diff --cached                   # read it once before committing
git commit -m "Add lab values" && git push
```

Stage only that file. Unrelated work in the checkout (for example
`another-module/.terraform.lock.hcl`) belongs in its own branch and PR.

## Things that bit during the cleanup

- **A setting deleted by accident changes the plan.** `image_download_node_name`
  was dropped next to `image_download_datastore_id`; the module fell back to its
  default `pve`, and the plan wanted to replace the cloud-image download that the
  state recorded on `pve1` (`node_name = "pve1" -> "pve" # forces replacement`).
  Restored as `image_download_node_name = "pve1"`. After any edit, a plan that
  isn't *No changes* means something is missing.
- **Undeclared variable warning.** A top-level `disk_datastore_id` produced
  `Value for undeclared variable`. The root module has no such variable; each
  entry in `servers` sets its own. Removed.
- **`recreate_on_cloud_init_change` must stay `false`.** With `true`, any change to
  cloud-init inputs (for example adding a key to `ssh_public_keys`) destroys and
  rebuilds every server.
- **`pm_ssh_agent` must be `false` for Semaphore**, so the provider uses the key file
  at `pm_ssh_private_key_path` (there is no SSH agent in a Semaphore run).

## `ssh_public_keys` in Semaphore

The value is just the list, with no `ssh_public_keys =`:

```
["ssh-ed25519 AAAA... you@workstation", "ssh-ed25519 AAAA... semaphore"]
```

Get each line from its private key with `ssh-keygen -y -f <private key>`. The list
replaces the module's whole list, so include every key that should reach new VMs,
and include the public half of Semaphore's Ansible key so new VMs accept it.
Cloud-init only applies keys at first boot; existing VMs need the key added to
`/home/ansible/.ssh/authorized_keys` by hand.
