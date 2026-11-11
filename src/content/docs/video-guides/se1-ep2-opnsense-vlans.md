---
title: "OPNsense: isolate your smart home with VLANs, firewall rules and IPS"
description: Written guide for Technical Chaos SE1-EP2. Install OPNsense in a Proxmox VM (or on a physical box), split IoT and trusted devices into VLANs, write firewall rules, and make Suricata IPS actually block.
sidebar:
  label: "SE1-EP2: OPNsense, VLANs and IPS"
  order: 2
---

Written 11 November 2026, from the SE1-EP2 video.

:::tip[Watch the video]
[OPNsense: Isolate Your Smart Home with VLANs, Firewall Rules and IPS](https://youtu.be/2Xs7TwQtYl4) on YouTube. The timestamps in each heading below match the video.
:::

This is the written companion to **Technical Chaos SE1-EP2**. It follows the video step by step, with timestamps, and gives every setting so you don't have to pause and squint at the screen.

The demo runs OPNsense **in a virtual machine on Proxmox**, so it can be broken and rebuilt without touching a real home network. Every step also says what changes if you're installing on a **physical firewall**. From the web interface onwards, it's all the same.

:::note[Example values]
All addresses, VLAN IDs and names below are the **lab values from the video**. Use your own ranges on a real network.
:::

## What you'll build

```text
                 Internet (or an upstream router)
                              │
                         WAN  │
                     ┌────────┴────────┐
                     │    OPNsense     │  Suricata IPS (Netmap)
                     └────────┬────────┘
          trunk: VLAN 300 + VLAN 310 (tagged)
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
   VLAN 300 · IoT                          VLAN 310 · Safe
   10.30.0.0/24                            10.31.0.0/24
   smart plugs, TVs, cameras               laptops, trusted devices
```

- **IoT devices can't reach the safe network.** A smart plug never needs to talk to the machine holding your files.
- **The safe network can reach specific IoT devices**, and only on the ports you allow.
- **Suricata watches the traffic** and blocks known-bad patterns, not just alerts on them.

## Lab layout vs physical firewall

| | In the video (Proxmox VM) | On a physical firewall |
| --- | --- | --- |
| Install media | DVD image, downloaded straight into Proxmox | VGA image, written to a USB stick |
| Management network | a bridge with no physical port (`vmbr200`) | the LAN port |
| VLANs | a VLAN-aware bridge (`vmbr300`) | a managed switch |
| WAN | an isolated network on the existing LAN acting as a fake ISP | your modem or upstream router |
| Reaching the web interface | an SSH tunnel through Proxmox | plug a computer into the LAN port |

## Part 1: Installing OPNsense <small>(3:31)</small>

### Create two Proxmox bridges (VM only)

In **Proxmox → your node → System → Network → Create → Linux Bridge**:

| Bridge | Purpose | IP on the Proxmox host | Physical port | VLAN aware |
| --- | --- | --- | --- | --- |
| `vmbr200` | firewall management only | `10.20.0.1/24` | none (stays inside this host) | no |
| `vmbr300` | the VLAN "virtual switch" | none | none | **yes**, VLAN IDs `300 310` |

On a physical firewall, skip this: the real ports and your managed switch do this job.

### Download and verify the installer

1. In Proxmox, go to **Datacenter → storage (ISO Images) → Download from URL** and paste the link to the OPNsense **DVD** image (26.7 in the video).
2. Paste the **SHA-256 checksum** from the OPNsense download page and pick **SHA-256**. Proxmox downloads it, verifies it and decompresses it.

:::caution
Always verify the checksum on firewall installers. It takes two seconds, and it proves the image wasn't corrupted or tampered with.
:::

On a physical machine, download the **VGA** image, check its checksum, then write it to a USB stick.

### Create the VM

- **CPU and memory:** 4 cores, 8 GB RAM
- **Disk:** 32 GB, **VirtIO** (SCSI)
- **Network:** one card, **VirtIO**, on `vmbr200` (management) for now

VirtIO devices are made for virtual machines, so no resources are wasted emulating old hardware.

On a physical machine, you need **at least two network ports**: one for WAN and one for LAN.

### Run the installer

1. Boot the VM. OPNsense starts a live environment.
2. Log in as `installer`, password `opnsense` (all lowercase).
3. Choose **ZFS**. Its snapshots are worth having. Pick the disk, and be sure: it **erases** whatever you select.
4. Set the **root password** and reboot. The installer can sit at 90% for a few minutes; that's normal.
5. Remove the ISO from the VM (on a physical machine, pull the USB stick) so it boots from disk.

## Part 2: Setting up the interfaces <small>(7:44)</small>

### Add the WAN card (VM only)

Add a **second network card** to the VM, connected to your existing uplink bridge. In the lab it's tagged into an **isolated network on the existing LAN**, so the home router acts as this firewall's ISP. That keeps the lab completely separate from the real home network. On your setup, you won't normally need a VLAN tag here.

On a physical machine, plug **WAN into your modem or upstream router**, and **LAN into your switch**.

### Assign interfaces (console option 1)

1. In the OPNsense console, choose **1) Assign interfaces**.
2. Skip LAGG and VLAN setup for now. VLANs are easier in the web interface.
3. Match the cards by **MAC address**: compare what OPNsense shows with the VM's hardware tab in Proxmox. In the video, `vtnet1` = WAN and `vtnet0` = LAN (management).

On a physical machine, interface names look like `igc0`. If you're not sure which port is which, use the **auto-detect** option: unplug the cables, press **A**, then plug in the port it asks for.

### Set the LAN address (console option 2)

OPNsense defaults the LAN to `192.168.1.1`, which clashes with many home networks. Change it:

1. Choose **2) Set interface IP address**, then pick the **LAN**.
2. Address: `10.20.0.2`, subnet `24`.
3. No gateway, no IPv6, and **no DHCP** (this network is only for managing the firewall).

Leave the **WAN on DHCP**. Most home connections need nothing more. If your ISP uses **PPPoE**, set it up later in the setup wizard.

## Part 3: Logging in and updating <small>(10:44)</small>

### Reach the web interface without exposing it

In the lab, the management network only exists inside the Proxmox host. You *could* open the web interface on the WAN, but you **don't want your firewall's admin page reachable from outside**. Use an **SSH tunnel** through Proxmox instead:

```bash
ssh -N -L 8443:10.20.0.2:443 root@<your-proxmox-host>
```

- `-L 8443:10.20.0.2:443` listens on port 8443 on your computer and forwards it, encrypted, to Proxmox, which connects to port 443 on the firewall. This works because Proxmox has its own address (`10.20.0.1`) on `vmbr200`.
- `-N` means "no shell, just the tunnel".

Open **`https://localhost:8443`** in your browser. Close SSH and the tunnel is gone.

:::caution
Proxmox is reachable from the management network, so never let untrusted devices onto it.
:::

On a physical firewall, plug your computer into the LAN port and browse to the LAN address.

### First login

- A **certificate warning** is normal: OPNsense uses a self-signed certificate at first.
- Run the **setup wizard**: keep the hostname simple, leave the WAN on DHCP, keep the LAN address from before, and leave **both WAN block options** (private and bogon networks) enabled.

### Update before anything else

**System → Firmware → Check for updates.** Even a fresh install reported packages with known vulnerabilities in the video. **Read the release notes** first (this update needed a reboot), then update. After updating, the video was on **OPNsense 26.7.8**.

From here on, everything is the same on a VM or a physical box.

## Part 4: Creating the VLANs <small>(13:39)</small>

### Add the trunk card (VM only)

Add a **third network card** to the VM on `vmbr300`, and leave its **VLAN tag empty**. With no tag, Proxmox passes tagged traffic for both VLANs straight through. The card acts as a **trunk**, and OPNsense handles the VLANs itself.

On a physical firewall, use the port connected to your **managed switch**. That switch port must carry **VLANs 300 and 310 as tagged traffic** (a trunk).

### Create the VLAN devices

**Interfaces → Devices → VLAN**, add one per network:

| VLAN tag | Parent | Description |
| --- | --- | --- |
| `300` | `vtnet2` (the trunk card) | IoT |
| `310` | `vtnet2` | Safe (trusted devices) |

On a physical firewall, pick the real port as the parent.

### Assign and address them

**Interfaces → Assignments**: add both VLAN devices, enable them, and set **IPv4: Static**:

| Interface | Address | Mask |
| --- | --- | --- |
| IoT (VLAN 300) | `10.30.0.1` | `/24` |
| Safe (VLAN 310) | `10.31.0.1` | `/24` |

The mask is the dropdown next to the address field. Easy to miss. These addresses become each network's **default gateway**.

## Part 5: DHCP for each VLAN <small>(16:08)</small>

1. **Disable Dnsmasq's DHCP** first. Two DHCP servers on the same network conflict, and one of them won't start.
2. Use **Kea DHCP** and create a pool per network:

| Network | Pool |
| --- | --- |
| IoT | `10.30.0.10` – `10.30.0.100` |
| Safe | `10.31.0.10` – `10.31.0.100` |

Starting at `.10` leaves the first addresses free for devices you want to give **static IPs**. Keep any static addresses **outside** the pool.

3. Leave **automatic option data** on, so clients get their gateway and DNS from the interface settings. Handy if you run your own DNS later.

## Part 6: Test devices on each VLAN <small>(17:05)</small>

In the lab, two small **Ubuntu containers** in Proxmox stand in for devices:

| Container | Bridge | VLAN tag | IP |
| --- | --- | --- | --- |
| `iot-300-ct` | `vmbr300` | `300` | DHCP |
| `safe-310-ct` | `vmbr300` | `310` | DHCP |

This is the other half of the trunk: OPNsense receives **tagged** traffic, but each container is given **one** VLAN. Proxmox adds and removes the tag, and the container never knows. Kea's lease table should show one lease on each network.

### Tagged vs untagged on real hardware

| Port / link | Setting | Why |
| --- | --- | --- |
| Switch port → **firewall** | **tagged** 300 + 310 (trunk) | one cable carries both networks; OPNsense's VLAN devices need the tags |
| Switch port → **a device** (camera, PC) | **untagged** on its one VLAN (access port, PVID 300 or 310) | most devices don't understand VLAN tags |
| Switch port → **access point** | **tagged** for every VLAN its SSIDs use | the AP maps each SSID to one VLAN |
| Wi-Fi | one **SSID per VLAN** (e.g. an IoT SSID → 300) | wireless devices join the right network by SSID |

Tagged towards network gear, untagged towards end devices.

## Part 7: Firewall rules <small>(18:27)</small>

### Nothing works until you allow it

New VLAN interfaces have **no allow rules**, so traffic is blocked. `apt update` just sits there, and the live log (**Firewall → Log Files → Live View**) shows the blocks in red.

### Allow web and DNS out

Add three pass rules (**inbound**, on the VLAN interface):

| Protocol | Destination port | For |
| --- | --- | --- |
| TCP | `80` | HTTP |
| TCP | `443` | HTTPS |
| TCP/UDP | `53` | DNS |

**Quick** is on by default: the **first matching rule wins** and evaluation stops for that packet, so **rule order matters**.

Both VLANs need the same rules, so the video moves them to **Firewall → Rules → Floating** and applies them to **both interfaces** at once, instead of keeping two copies.

:::danger[Destination "any" includes your private networks]
These rules use **destination: any**, and *any* includes your other VLANs, not just the internet. On a real network, put **block rules for your private ranges above them** (or use an alias like `!RFC1918` as the destination), and double-check rule order and direction. Otherwise "allow web out" also means "allow web to every device on every VLAN".
:::

### Allow specific cross-VLAN traffic

Test isolation first: a ping from the safe container to the IoT container gets **no reply**, and the log shows it blocked. Then open only what's needed, on the **Safe** interface:

| Action | Protocol | Source | Destination | Port |
| --- | --- | --- | --- | --- |
| Pass | ICMP | `10.31.0.10` | `10.30.0.10` | – |
| Pass | TCP | `10.31.0.10` | `10.30.0.10` | `22` (SSH) |

- The rules are **one-way**: safe → IoT. For IoT → safe, you'd need a separate rule on the IoT interface, and normally you **don't** want that.
- The firewall log shows **which rule** allowed each connection, which is handy for checking your work.

:::caution
To test SSH, the video enabled root password login on the throwaway container (Ubuntu blocks it by default). Don't do that on anything you care about. Use keys and a normal user.
:::

## Part 8: Intrusion detection and prevention (Suricata) <small>(21:37)</small>

Firewall rules decide **who may talk**. Suricata looks **inside** the traffic for known attack patterns.

### Set it up in detect-only mode

**Services → Intrusion Detection → Administration**:

1. Enable it, and select the **IoT** and **WAN** interfaces.
2. **Capture mode: PCAP** for now. That's detect-only: it alerts but can't block.
3. Under **Download**, enable some **ET (Emerging Threats) Open** rulesets and download them.

### Test it safely

Rule **SID 2100498** (*GPL ATTACK_RESPONSE id check returned root*) matches the text `uid=0(root)`, which is what an attacker sees when checking they're root. Trigger it harmlessly from the IoT container with plain **HTTP**:

```bash
curl --noproxy '*' -H 'User-Agent: uid=0(root)' http://example.com/
```

Suricata can't normally read inside **HTTPS**, so use plain HTTP for the test. The alert shows up **twice**, once on the VLAN and once on the WAN, because the firewall sees the same request on both sides.

## Making the IPS block <small>(23:12)</small>

Set rule `2100498` from **alert** to **drop**, apply, and run the same `curl`. In the video, **the page still loaded and the log still said "allowed"**.

### What *didn't* fix it

- Assuming the VM was the problem. It wasn't.
- Switching the **pattern matcher** (Hyperscan vs Aho-Corasick). That changes how Suricata *searches*, not whether it *can block*.

### What did: the capture mode

**PCAP mode can only watch.** It sees a copy of the traffic, so it can alert but never block, even with rules set to drop. To block, Suricata has to sit **in the traffic path**:

1. **Capture mode: Netmap** (IPS mode).
2. On a physical box, check your network card **supports Netmap**.
3. Per the OPNsense docs, disable **hardware offloading** (CRC, TSO, LRO) under **Interfaces → Settings**.

Run the test again: **`curl` hangs and the log says "blocked"**, with only the **IoT** alert this time. There's no WAN alert, because the packet was stopped before it reached the WAN side. From the **safe** container (no IDS on that interface), the request is still blocked **at the WAN**, which is why that alert shows WAN.

:::note[IPS and VLANs]
The **OPNsense documentation recommends enabling IPS on the parent interface** when you use VLANs. It worked on the VLAN interface in this demo, but keep it in mind for your own setup: see the [OPNsense IPS docs](https://docs.opnsense.org/manual/ips.html).
:::

## Troubleshooting checklist

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Devices get no IP | Dnsmasq and Kea both serving DHCP, or no pool on that VLAN | disable Dnsmasq's DHCP; check the Kea pool and lease table |
| No internet from a VLAN | no allow rules yet (default block) | add pass rules for 80/443/53 (floating or per interface) |
| VLAN devices can reach each other unexpectedly | allow rules with **destination any** above everything | block private ranges first, or use `!RFC1918` as the destination |
| Suricata alerts but never blocks | capture mode is **PCAP** | switch to **Netmap**, set the rule to drop, disable hardware offloading |
| VLAN traffic never reaches OPNsense | the firewall's switch port is untagged, or the VM card has a VLAN tag set | firewall link must be **tagged** (trunk); leave the VM trunk card's tag **empty** |
| Can't reach the web interface in the lab | management bridge has no route from your desktop | use the SSH tunnel; don't open the GUI on WAN |

## What's next

Things the video didn't cover, any of which could be its own guide:

- **DNS** (Unbound) and **mDNS** across VLANs (for casting and AirPlay)
- **NAT** and port forwarding
- **OPNsense high availability** (CARP failover)
- A **5G phone or hotspot as a backup ISP** (multi-WAN failover)

If you're setting this up for the first time, get the VLANs and rules from this guide working and understood first. Then let me know in the video's comments which of these you'd like next.
