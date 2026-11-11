---
title: "Troubleshooting"
description: "Every error hit while setting this up, with its cause and fix."
sidebar:
  order: 7
---

Every error hit during the first setup, with what caused it and the fix.

## PostgreSQL

**`\password: extra argument "CREATE" ignored` … `invalid integer value "ON" for connection option "port"`**
A pasted block in `psql`: a backslash command (`\password`, `\c`) takes the rest
of the line as its arguments. The role was created, nothing after it ran. Run
each statement as its own `sudo -u postgres psql -c "..."`.

**`dial tcp: lookup <postgres-host>: no such host`**
`PG_CONN_STR` in Semaphore still had the placeholder. Put in the real host and
password.

## Terraform

**`exec: "terraform": executable file not found in $PATH`**
Terraform isn't installed on the Semaphore host. See [Semaphore](/homelab-automation/semaphore/).

**`terraform: command not found` after running the install block**
`apt-get` swallowed the rest of the pasted commands; only the first ran. Paste
each command on its own.

**`chdir …/`ubuntu-servers`: no such file or directory`**
Backticks typed into the template's Subdirectory field. Enter `ubuntu-servers`
plain.

**`failed to open SSH client: failed to determine the home directory: $HOME is not defined`**
The Proxmox provider's SSH upload needs `$HOME`; Semaphore starts tasks without
it, and a `HOME` variable in a variable group isn't passed through. Set
`Environment=HOME=/root` in a systemd drop-in for `semaphore.service`.

**`timeout while waiting for the QEMU agent on VM "105" to publish the network interfaces`**
VM 105 (ai-hub-01) had no `qemu-guest-agent` installed although Proxmox had the
agent channel enabled. Every plan refreshes every VM and waits for its agent.
Install it (`apt-get install -y qemu-guest-agent`, `systemctl start qemu-guest-agent`)
and check with `qm guest cmd 105 network-get-interfaces`. The `common` role's guest-agent task keeps
it on every VM. The timeout can mark the VM tainted; if a later plan wants to replace
it only for that reason, `terraform untaint 'module.ubuntu_servers.proxmox_virtual_environment_vm.server["<name>"]'`.

**`~ node_name = "pve1" -> "pve" # forces replacement`**
`image_download_node_name` was missing from `lab.auto.tfvars`, so the module used
its default. Restore the value from the state.

**`Value for undeclared variable "disk_datastore_id"`**
A top-level setting the root module doesn't declare. Harmless; removed.

**`Deprecated: Use "proxmox_download_file" instead`**
The bpg/proxmox provider renamed the resource; the old name goes away in its
v1.0. Harmless for now. Renaming needs a `moved` block so the image isn't
re-downloaded.

## Ansible

**`The password file …/sudo_pass.txt was not found`** (or the Vault equivalent)
`ansible.cfg` named a password file that a fresh clone doesn't have; Ansible
stops at startup even when the password is supplied another way. Remove those lines
from `ansible.cfg`; let the runner supply passwords.

**`Set vault_ai_dev_github_token in the encrypted ai_nodes vault and configure the Git identity.`**
The token didn't reach the playbook. In Semaphore it must be under the variable
group's **Extra variables** (not Environment variables), named exactly
`vault_ai_dev_github_token`, and the template must use that group.

**`couldn't resolve module/action 'ansible.posix.mount'`** (syntax check of `common.yml`)
The `ansible.posix` collection isn't installed where the check ran.

**`The 'ansible.builtin.include' action plugin has been removed`** (`home-setup.yml`)
Old roles use `- include:`. Needs `include_tasks`/`import_tasks`. Not fixed yet.

## Git and GitHub on Coder

**`Missing or invalid credentials. Error: connect ECONNREFUSED /tmp/vscode-git-….sock`**
The terminal points at a VS Code Git helper from a session that no longer exists.
Open a new terminal, or:

```bash
unset GIT_ASKPASS VSCODE_GIT_ASKPASS_NODE VSCODE_GIT_ASKPASS_MAIN VSCODE_GIT_ASKPASS_EXTRA_ARGS VSCODE_GIT_IPC_HANDLE
git config --show-origin --get-all credential.helper
git config --global --unset-all credential.helper
gh auth status            # gh auth login if needed
gh auth setup-git
rm -f ~/.git-credentials  # if the old helper was "store"
```

The logout command is `gh auth logout --hostname github.com --user <account>`
(there is no `gh logout`).
