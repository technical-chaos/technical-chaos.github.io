---
title: "Ansible: AI nodes"
description: "The ai-dev Ansible role: AI development nodes running T3, Claude Code and Codex, with shared GitHub auth, linked workers and Wake-on-LAN."
sidebar:
  order: 5
---

The `ai-dev` role (`example-org/homelab-ansible`, playbook `ai-dev-setup.yml`) turns a
Debian/Ubuntu or Fedora host into an AI development node running T3, Claude
Code and Codex.

## Accounts

- **`ansible`**: the SSH user Ansible connects as, with sudo. Terraform-built VMs
  create it key-only with passwordless sudo.
- **`ai-dev`**: the restricted user every tool runs as. No sudo, password locked.

Never use one for the other.

## Inventory (`inventory/home/host`)

```ini
[t3_hub]
ai-hub-01 ansible_host=192.168.10.5 ansible_ssh_user=ansible

[t3_workers]
ai-test-01 ansible_host=192.168.10.6 ansible_ssh_user=ansible
#gpu-workstation ansible_host=192.168.10.x ansible_ssh_user=ansible ai_dev_wol_mac=xx:xx:xx:xx:xx:xx
#media-workstation     ansible_host=192.168.10.y ansible_ssh_user=ansible ai_dev_wol_mac=xx:xx:xx:xx:xx:xx

[ai_nodes:children]
t3_hub
t3_workers
```

Exactly one host goes in `t3_hub`. Set `ansible_ssh_user` per host: a `:vars`
block for a group with no members takes the whole inventory down.

`common.yml` and `home-setup.yml` target `all`, so running them without `--limit`
also reaches the AI nodes (`home-setup.yml` applies ufw, Docker, Docker Swarm and
Ceph).

## What the role does

- Separate tool homes: `/srv/ai-dev/claude`, `/srv/ai-dev/code-x`,
  `/srv/ai-dev/t3code`. Root-owned launchers in `/srv/ai-dev/bin` set `HOME`, clear
  inherited overrides and token variables, and put the wrappers first on `PATH`.
- `git` and `gh` from GitHub's official APT/RPM repositories.
- **Shared GitHub login.** One `GH_CONFIG_DIR` (`~ai-dev/.config/gh`) for every
  tool, provisioned from `vault_ai_dev_github_token` through `gh auth login` on
  stdin. Output is suppressed; an unchanged token isn't re-applied; rotate by
  changing the secret and rerunning. Git identity `example-user` is managed in
  `~ai-dev/.gitconfig`, with gh as the HTTPS credential helper.
- herdr is no longer installed; its old data is left alone.

## Passwords come from the runner

`ansible.cfg` names **no** password files. Ansible stops at startup when a
configured password file is missing, even if the password arrives another way,
and Semaphore's fresh clone never has those files.

| | Semaphore | Workstation (Coder) |
|---|---|---|
| Vault password | template's Vault password (`vault-pass`) | `ANSIBLE_VAULT_PASSWORD_FILE` → file outside the checkout |
| Sudo password | inventory sudo credentials (only if needed) | `ANSIBLE_BECOME_PASSWORD_FILE` or `--ask-become-pass` |
| GitHub token for the nodes | `ai-dev-setup` group, Extra variable `vault_ai_dev_github_token` | encrypted `inventory/home/group_vars/ai_nodes/vault` |

## T3 service and worker linking

- Every AI node gets `t3-server.service` running as `ai-dev`:
  `/srv/ai-dev/bin/t3 serve --lan --port 3773`, through the launcher so T3 starts
  Claude and Codex the managed way. Port 3773 is opened if firewalld or ufw is
  active.
- A running T3 server is **not** restarted when its unit changes (that ends agent
  sessions); the run reports a pending restart. `ai_dev_t3_service_restart_on_change: true`
  changes that.
- **Linking:** each `t3_workers` host is linked into the hub's *Linked
  environments* with `approval-required` access. The worker issues a one-time
  pairing code (`t3 auth pairing create`, 5 minutes); the hub redeems it with
  `t3 environment link http://<worker>:3773 …`. Codes are hidden from output and
  revoked if linking fails.
- Links expire after 30 days. Each run relinks a worker that is missing,
  unreachable or within 7 days of expiry, so run the playbook at least monthly.
- **On the hub, turn on Settings → Labs → Linked environments once.** The run stops
  with that instruction if it's off.
- To pair a browser with a node's T3: `sudo -u ai-dev /srv/ai-dev/bin/t3 pair`.

## Wake-on-LAN workers

For physical workers that stay suspended (gpu-workstation, media-workstation), set
`ai_dev_wol_mac` in the inventory. The playbook then:

- sends a magic packet from the hub and waits up to 5 minutes for SSH;
- keeps WoL on across reboots (ethtool, `/etc/systemd/network/50-ai-dev-wol.link`,
  a NetworkManager default);
- adds `wake <name>` (and `wake --list`, `wake <name> --wait`) on the hub.

By hand on each machine: WoL on and ErP off in BIOS/UEFI, wired Ethernet on
192.168.10.x with a DHCP reservation, and GNOME automatic suspend checked so it
can't sleep mid-render.

## QEMU guest agent on every VM

The Proxmox Terraform provider waits for the guest agent to report a VM's
addresses; a VM without it stalls every plan. ai-hub-01 had no agent and
Terraform timed out on it. The `common` role now installs and starts
`qemu-guest-agent` on KVM guests (LXC and bare metal skip it):

```
common.yml --tags qemu-guest-agent
```

It reports VMs whose Proxmox options don't enable the agent channel.

## Known issues

- `home-setup.yml` fails on current ansible-core: the `users`, `docker-svc`, `ufw`,
  `hosts-file` and `ceph-client` roles still use the removed `- include:`.
- The `node-exporter` include in `common` is tagged without `apply:`, so
  `--tags node-exporter` runs nothing inside it.
