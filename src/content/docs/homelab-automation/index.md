---
title: "Overview"
description: "How AI agents, Semaphore, Terraform and Ansible fit together to run a Proxmox homelab, and the rules that keep it safe."
sidebar:
  order: 1
---

How the homelab's infrastructure is changed and run: AI agents on the T3 hub
write the Ansible and Terraform changes, Semaphore runs them with the keys, and
a person approves merges and Terraform applies.

Written 10 November 2026, from the first end-to-end setup.

## How a change flows

1. A T3 agent writes and tests the change.
2. It opens a GitHub pull request.
3. Semaphore runs the change for real, from the branch.
4. If that run succeeded, the pull request is merged; if not, back to step 1.
5. Semaphore runs `main` for routine and scheduled work.

## Ground rules

1. **Nothing is merged until it has run successfully from its branch** on real
   hosts or real state. Unit tests, `--syntax-check`, `terraform validate` and
   mocks do not count as that run. Record the result on the PR, then merge.
2. **Semaphore runs both Ansible and Terraform and holds every key.** Agents
   never get the SSH key, Vault password, Proxmox token or state database
   password.
3. **Terraform applies always wait for a person's confirm click.**
4. **No secret is ever committed**, private repo or not.

## Pieces

| Piece | Where | Role |
|---|---|---|
| `example-org/homelab-terraform` | GitHub (private; a sanitized copy is published) | Proxmox VMs (`ubuntu-servers`) and the Talos cluster (`homelab/*`) |
| `example-org/homelab-ansible` | GitHub (private) | Host configuration, including the AI nodes (`ai-dev` role) |
| PostgreSQL LXC | `terraform_state` database | Shared, locked Terraform state |
| Semaphore LXC | Ubuntu 24.04, runs as root | Runs Terraform and Ansible; Key Store and variable groups |
| ai-hub-01 | 192.168.10.5 | T3 hub (main web interface, agents) |
| ai-test-01 | 192.168.10.6 | Disposable test node for real runs before merging |
| Coder | LXC | Hand editing; held the Terraform state before the migration |

## Documents

| | |
|---|---|
| [Terraform state in PostgreSQL](/homelab-automation/terraform-state-postgres/) | Database setup, backend, migration from local state, rollback |
| [Terraform lab values](/homelab-automation/terraform-lab-values/) | Splitting `terraform.tfvars` into committed lab values and Semaphore secrets |
| [Semaphore](/homelab-automation/semaphore/) | Install, keys, variable groups, repositories, inventory, templates |
| [Ansible AI nodes](/homelab-automation/ansible-ai-nodes/) | The `ai-dev` role, inventory groups, T3 service, worker linking, Wake-on-LAN |
| [Adding a node](/homelab-automation/adding-a-node/) | End to end: Terraform entry, apply, Ansible, real runs |
| [Troubleshooting](/homelab-automation/troubleshooting/) | Every error hit during setup, with cause and fix |

