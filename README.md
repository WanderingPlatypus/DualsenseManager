# PadBench

A DualSense / DualSense Edge tester with a controller database. Plug a controller in, it reads the serial, opens (or creates) that controller's record, and every test you run can be saved into it: what works, cosmetic defects, dirty parts, hardware faults, repairs, photos, purchase and sale.

Everything is saved on the PC first and synced to your home server whenever it can be reached. If the server is off, the app keeps working and sends the changes later.

## What's in the folder

| Folder | What it is |
|---|---|
| `web/` | The app itself (plain HTML/JS, no build step) |
| `server/` | The sync server for your Proxmox box (Node.js + SQLite, no npm packages) |
| `desktop/` | The Windows app shell (Electron) |

## 1. Server on Proxmox (Debian or Ubuntu LXC)

1. In Proxmox create an LXC from the Debian 12 template (1 core, 512 MB RAM and 4 GB disk is plenty). Give it a fixed IP or a DHCP reservation.
2. Copy `padbench-server.tar.gz` into the container (`scp` or `pct push <id> padbench-server.tar.gz /root/`).
3. In the container console:
   ```bash
   tar xzf padbench-server.tar.gz
   cd padbench
   bash server/install-lxc.sh
   ```
4. It prints two addresses:
   - `http://<ip>:8080` is the sync address for the Windows app, and works in Firefox.
   - `https://<ip>:8443` works in Chrome or Edge with full controller access (accept the self-signed certificate warning once).

Data lives in `/var/lib/padbench` (SQLite database, plus a JSON snapshot every day, 14 kept). Proxmox's own LXC backups cover it.

Optional password: uncomment `PADBENCH_TOKEN` in `/etc/systemd/system/padbench.service`, then `systemctl daemon-reload && systemctl restart padbench`, and type the same token in the app's Sync tab.

Docker instead: `cd server && docker compose up -d` (put your own `cert.pem`/`key.pem` in `server/data` if you want the https port).

## 2. Windows app

Unzip `PadBench-win-x64.zip` anywhere (for example `C:\Apps\PadBench`) and run `PadBench.exe`. Windows SmartScreen may warn the first time because the exe isn't signed; choose *More info → Run anyway*.

Open the **Sync** tab, enter `http://<server-ip>:8080`, press **Save**, then **Test connection**. The dot at the bottom of the side bar shows the sync state: green synced, pink offline with changes waiting.

## Where each feature works

| | Windows app | Chrome / Edge on `https://<server>:8443` | Firefox |
|---|---|---|---|
| Database, search, notes, photos, sale tracking | yes | yes | yes |
| Buttons, sticks, triggers | yes | yes | yes (Gamepad API) |
| Serial number read automatically | USB (Bluetooth once seen over USB) | same | type it |
| Touchpad, motion, battery | yes | yes | no |
| Lightbar, player LEDs, rumble, adaptive triggers | USB and Bluetooth | same | no |
| Speaker and headphone tone, calibration | USB | USB | no |

Firefox has no WebHID support, so it can't talk to the controller beyond the standard gamepad inputs.

## Testing a controller

1. Plug it in by USB and press **Connect controller** (the Windows app reconnects by itself after that).
2. A new controller gets its record right away, with color, board, firmware and Bluetooth address filled in. A controller you've seen before opens its existing record.
3. Press every button, push both triggers all the way, rotate each stick around its edge, drag a finger over the whole touchpad and turn the controller over. All of these tick themselves.
4. Let go of the sticks and press **Measure stick drift**. Under 5% resting offset is healthy.
5. Use the **Play / Resist / Tone / Cycle / Listen** buttons in the checklist for haptics, adaptive triggers, speaker, headphones, lights and the mic, and mark each one OK, Issue or Faulty.
6. Press **Save to record**. Results go into the record's "What works" list and a test session is added to its history. Stick drift and clone detection also add the matching hardware-fault tags.

Over Bluetooth the controller is matched by its Bluetooth address, which the app learns the first time the controller is connected by USB.

### Calibration

Under **Calibration** (USB only): stick centers, stick range, fine-tune of the raw values, then **Save permanently**. Changes are temporary until saved; rebooting the controller discards them. Controllers that don't answer like a genuine DualSense have calibration disabled. On the DualSense Edge the permanent save needs the stick modules flashed, so finish that step in dualshock-tools.

## Updates

New versions go to GitHub. If the server was installed with `proxmox-create.sh`, it pulls them every night at about 04:30. To update it right away, run this in the Proxmox shell, using the container number the setup printed:
```bash
pct exec <container-id> -- bash /opt/padbench-src/server/update.sh
```
The Windows app checks the server every few hours and offers to restart when a new version has been downloaded. You can also check by hand under Sync → About → **Check for updates**. Browsers opened on the server always get the latest version.

## Running from source

```bash
node server/server.js        # Node 22.13+, serves the app on http://localhost:8080
```
For the desktop shell: copy `desktop/main.js`, `desktop/preload.js`, `desktop/package.json` and the `web/` folder into one folder and run it with Electron 33.

## Credits

Controller protocol details and the controller drawing come from [dualshock-tools](https://github.com/dualshock-tools/dualshock-tools.github.io) (MIT, © the_al) and the Linux `hid-playstation` driver. Fonts: Saira and Atkinson Hyperlegible (SIL Open Font License).
