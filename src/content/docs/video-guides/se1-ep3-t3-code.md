---
title: "T3 Code: Claude and Codex in one app"
description: Written guide for Technical Chaos SE1-EP3. Install T3 Code, connect Claude Code and Codex, have them review each other's work, and a basic start with the other tools from the video.
sidebar:
  label: "SE1-EP3: T3 Code, Claude and Codex"
  order: 3
---

Written 17 November 2026, updated 18 November.

:::tip[Watch the video]
[Claude + Codex Work Together in T3 Code. I Keep Them in Check.](https://youtu.be/9y21U-UY9Ak) on YouTube.
:::

This is the written companion to **Technical Chaos SE1-EP3**. It covers the tools from the video with a basic setup for each, and links to each tool's own docs for the rest.

## Tools used

| Tool | What it's for |
| --- | --- |
| [T3 Code](https://t3.codes) | One app for your coding agents, on your own machine |
| [Claude Code](https://claude.com/product/claude-code) | Anthropic's coding agent: plans and writes the code |
| [Codex CLI](https://developers.openai.com/codex/cli) | OpenAI's coding agent: plans and reviews |
| [Semaphore UI](https://semaphoreui.com) | Runs Ansible and Terraform from a web UI |
| [Ansible](https://docs.ansible.com) | Configures servers from playbooks |
| [Terraform](https://developer.hashicorp.com/terraform) | Creates VMs and other infrastructure from code |
| [herdr](https://herdr.dev) | Runs coding agents in the terminal |
| [OPNsense](https://opnsense.org) | Firewall and VLANs to wall the agents off ([guide](/video-guides/se1-ep2-opnsense-vlans/)) |
| [Wake-on-LAN](https://wiki.archlinux.org/title/Wake-on-LAN) | Wakes a sleeping machine over the network |

## The basic setup

```text
  Your computer, or a small VM
 ┌──────────────────────────────┐
 │ T3 Code                      │
 │   ├─ Claude Code (signed in) │ ──► open T3 in your browser
 │   └─ Codex CLI (signed in)   │
 └──────────────────────────────┘
```

That's all you need to start. Putting the machine on its own VLAN (below) is a good next step.

## Install T3 Code

T3 Code runs the coding agents you already use and puts them in one window, so you can switch between them or have one hand work to the other. It doesn't sell tokens: it uses your own Claude and ChatGPT subscriptions.

1. **Install at least one agent and sign in:**
   - [Claude Code](https://claude.com/product/claude-code), then `claude auth login`
   - [Codex CLI](https://developers.openai.com/codex/cli), then `codex login`
2. **Install T3 Code**, either:
   - the desktop app from [t3.codes/download](https://t3.codes/download) (macOS, Windows, Linux), or
   - the command line, which runs T3 as a server you open in a browser:

     ```bash
     curl -fsSL https://t3.codes/install.sh | sh
     t3
     ```

   To try it once without installing anything, run `npx t3@latest`.
3. **Start a thread,** pick Claude or Codex, and give it a task.

More: [install and first run](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md), and [remote access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md) to use it from another computer or your phone.

## Have them check each other's work

The idea from the video: both agents plan, they agree before any code is written, Claude writes it, Codex reviews it, and when they disagree they stop and ask you. Paste this into the first message of a thread and put your task at the top:

```text
Task: <describe the task or list the issues here>

Roles
- Claude: plans, codes and reviews.
- Codex: plans and reviews only. Codex never writes code.

1. Planning (before any code)
   - Claude and Codex each review the task on their own and write down
     anything unclear, missing or risky.
   - Compare the two reviews. Claude starts coding only when both agree
     on the approach.

2. Build and review
   - Claude implements it.
   - Codex reviews the work and checks it fully meets the task.
   - It is done only when both sign off.

3. Disagreements
   - If Claude and Codex disagree, stop and ask me. Explain the
     disagreement and give both recommendations.
```

## Keep the agents walled off

Agents can run commands, so don't give them a path into everything else on your network. Run T3 on its own machine or VM, on its own VLAN, with firewall rules that block it from the rest of your devices.

How to set up the VLAN and the firewall rules: [SE1-EP2: OPNsense, VLANs and IPS](/video-guides/se1-ep2-opnsense-vlans/).

## Semaphore

[Semaphore UI](https://semaphoreui.com) is a web app for running Ansible playbooks and Terraform from one place, with the keys stored in it and a log of every run. In the video, the agents ask Semaphore to run their changes instead of logging in to servers themselves.

Try it locally with Docker (from Semaphore's own README):

```bash
docker run -p 3000:3000 --name semaphore \
  -e SEMAPHORE_DB_DIALECT=sqlite \
  -e SEMAPHORE_ADMIN=admin \
  -e SEMAPHORE_ADMIN_PASSWORD=changeme \
  -e SEMAPHORE_ADMIN_NAME=Admin \
  -e SEMAPHORE_ADMIN_EMAIL=admin@localhost \
  -d semaphoreui/semaphore:latest
```

Open `http://localhost:3000`, sign in as `admin` and change the password. If you connect an agent later, give it its own user with the **Task Runner** role, so it can run tasks but not change them.

More: [other install options](https://semaphoreui.com/install) and the [Semaphore docs](https://docs.semaphoreui.com).

## herdr: agents in the terminal

herdr runs your coding agents in the terminal, and it's an impressive tool: it's what the video's setup used before T3. After testing both, T3 stays for now because of its UI. If you live in the terminal, give herdr a try.

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

Or `brew install herdr`. More: [herdr.dev](https://herdr.dev), the [quick start](https://herdr.dev/docs/quick-start/) and [GitHub](https://github.com/herdrdev/herdr).

## Wake-on-LAN

A power-hungry machine can sleep until you need it, then be woken over the network. The basics on Linux:

1. Turn on **Wake-on-LAN** in the machine's BIOS or UEFI.
2. On that machine, find the network interface and its MAC address with `ip link`, then turn on wake-up by magic packet:

   ```bash
   sudo ethtool -s <interface> wol g
   ```

   With NetworkManager, make it stick across reboots:
   `nmcli connection modify "<connection>" 802-3-ethernet.wake-on-lan magic`
3. Put it to sleep with `systemctl suspend`.
4. From another computer on the same network, wake it with `wakeonlan <MAC address>` (from the `wakeonlan` package).

The magic packet stays on the local network, so the computer sending it has to be on the same subnet or VLAN. More: the [Arch Wiki page on Wake-on-LAN](https://wiki.archlinux.org/title/Wake-on-LAN).

## Safety checklist

- [ ] The agents run on a separate machine, VM or VLAN, not on the computer with your passwords and files.
- [ ] No passwords or keys in prompts or in the files the agents can read.
- [ ] You review changes before they're merged or run.
- [ ] New things are tried in a test setup first, never straight on anything you depend on.
- [ ] You make the final call when the agents disagree.
