# Gyro Strike

Galaga-style arcade shooter for the browser. Your phone is the controller: tilt to fly, hold FIRE to shoot, shake (or BOMB) for a smart bomb. Up to 2 players co-op.

## Run

```bash
npm install
npm start
```

1. On the computer, open **http://localhost:9080/game/** and click once to enable sound.
2. Scan the QR code with your phone, which must be on the same Wi-Fi. The first time, accept the certificate warning: the server uses a self-signed HTTPS cert because phones only allow tilt sensors on HTTPS.
3. Tap **TAP TO PLAY** and allow motion access if asked (iPhone). Hold the phone sideways and press FIRE to start.

A second phone scanning the same QR becomes 2UP and can join mid-game by pressing FIRE.

Ports: HTTP `9080` (`PORT`), HTTPS `9443` (`HTTPS_PORT`). Set `HOST_IP` if the LAN IP is detected wrongly.

## Controls

| | Phone | Keyboard |
|---|---|---|
| Move | tilt, or **STICK** mode (drag) | arrows / WASD |
| Fire | hold FIRE | Space / F |
| Smart bomb | BOMB / shake | B / G |
| Barrel roll (dodge) | flick the phone, or double-tap the stick | Right Shift / Left Shift |

The keyboard plays whichever slot has no phone. If one phone is connected, a second player can use either key set. With no phones, arrows play 1UP and WASD plays 2UP. Press fire to join mid-game, or to continue after losing all your ships (your score resets).

On the phone, the **TILT / STICK** chip in the top bar switches between gyro steering and an on-screen joystick. **SET** has sensitivity, axis inversion, up/down tilt on/off and vibration. **RECENTER** sets your current hold as neutral. P pauses, M mutes.

## Enemies

| | From stage | |
|---|---|---|
| Bee, Butterfly, Commander | 1 | classic Galaga trio; commanders take 2 hits and bring escorts |
| Zig | 2 | weaves side to side on fast dives |
| Splitter | 3 | splits into two minis that dive at you |
| Tank | 5 | 3 hits, fires a 3-way spread |
| Boss | every 4th | bullet patterns, summons bees |

From stage 7 the rows are mixed randomly.

## Tractor beam

A commander sometimes parks mid-screen and fires a tractor beam. If it catches you, your ship spins up the beam: **shake the phone** (or press bomb) to break free. If you don't break free in time, the commander takes the ship back to the formation and you lose a life. Shoot that commander **while it's flying** to get the ship back as a DOUBLE ship. Shoot it while it sits in formation and the ship is lost.

## Combos

Kills less than 1.5 s apart build a combo: x2 from the 5th kill, up to x5. Getting hit resets it, and bomb kills don't count.

## Power-ups

**S** spread, **R** rapid, **L** laser (hold fire for a piercing beam), **M** homing missiles, **H** shield, **D** double ship (absorbs one hit), **T** slow-motion enemies, **B** extra bomb, **+** extra life. S/R/L/M are timed and replace each other. Picking up the same weapon again levels it up to LV3: more spread shots, a twin-barrel rapid fire, a wider laser, more missiles.

## Notes

- **Volume buttons:** mobile browsers don't pass hardware volume keys to web pages. The controller listens for them anyway in case a browser does, but shake-to-bomb is the reliable trigger.
- **Vibration** works on Android. iOS Safari has no vibration API, so the screen flashes instead.
- The phone plays its own sounds for your player's events. Turn this off with PHONE SOUNDS in SET; FLICK PHONE TO ROLL can be turned off there too.
- High scores are stored in the game screen browser's localStorage.

## Layout

```
server.js                 HTTP + HTTPS static server, WebSocket rooms/relay, QR codes
public/game/              game screen (canvas 224x288)
  main.js                 state machine, loop, collisions, rendering, input
  entities.js             Player, Enemy, Boss, Bullet, PowerUp
  waves.js                formation, entry paths, dive paths
  sprites.js audio.js hiscore.js net.js
public/controller/        phone controller page
```
