---
title: "Adding a node, end to end"
description: "Add a node end to end: Terraform entry, plan and apply in Semaphore, Ansible inventory, and real runs before merging."
sidebar:
  order: 6
---

Worked example: **ai-test-01**, the disposable test node.

## 1. Terraform entry (PR to `homelab-terraform`)

Add an entry to `servers` in `ubuntu-servers/lab.auto.tfvars`, on its own branch:

```hcl
  {
    name              = "ai-test-01"
    node_name         = "pve2"
    ip                = "192.168.10.6"
    gateway           = "192.168.10.1"
    net_vlan          = 10
    net_mac           = "02:00:00:00:00:06"
    groups            = ["ai-servers"]
    disk_datastore_id = "ceph-pool"
    cores             = 4
    memory_mb         = 4096
    disk_size_gb      = 40
  },
```

Before choosing an IP and MAC: check they're unused in `lab.auto.tfvars`, and
that nothing answers on the IP or shows the MAC on that network. Proxmox picks
the VM ID unless you set `vm_id`.

## 2. Plan and apply in Semaphore

Point the Terraform template's repository at the branch and run it. The plan must
show **`2 to add, 0 to change, 0 to destroy`** (the VM and its cloud-init
snippet). Confirm the apply.

Check the VM:

```bash
qm guest cmd <vmid> network-get-interfaces       # on the Proxmox host: the agent answers
ssh ansible@192.168.10.6                         # with Semaphore's key
```

Post the plan summary and apply result on the PR. Merge only after that.

## 3. Ansible inventory (PR to `homelab-ansible`)

```ini
[t3_workers]
ai-test-01 ansible_host=192.168.10.6 ansible_ssh_user=ansible
```

A worker goes in `t3_workers`; only the hub goes in `t3_hub`.

## 4. Real runs in Semaphore

Template `ai-dev-setup (...)` with `--limit ai-test-01`:

1. `--check --diff`
2. real run
3. real run again: `changed=0`

Post each recap on the PR, then merge.

## 5. After the playbook

- Sign in to Claude and Codex once on the node (`sudo -iu ai-dev`, then `claude`
  / `codex`). GitHub is already signed in from the token.
- For a worker, check on the hub that it's linked:
  `sudo -u ai-dev /srv/ai-dev/bin/t3 environment list` → `reachable`,
  `approval-required`.
- For a node that sleeps, add `ai_dev_wol_mac` (see [Ansible AI nodes](/homelab-automation/ansible-ai-nodes/)).

## Physical machines

Physical machines such as gpu-workstation and media-workstation aren't
Terraform-built: skip steps 1 and 2. Make sure `ansible` exists with Semaphore's public key in `authorized_keys`, and add a sudo
credential in Semaphore if `sudo -n true` fails for `ansible`.
