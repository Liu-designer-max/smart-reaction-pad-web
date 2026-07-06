# Smart Reaction Pad RTP Dashboard

A static Web Bluetooth dashboard for the Smart Reaction Pad biomedical engineering wearable-device project.

The project links an ESP32-based 6-zone reaction mat to a browser UI for return-to-play style reaction testing, live visualization, and educational physiological interpretation.

## Hardware Match

The dashboard is built for the project hardware described in the assembly guide:

- ESP32 Dev Module
- 6 FSR pressure sensors
- 2x 74HC164N shift registers
- 12 zone LEDs: red for Go, green for No-Go
- KY-009 common-anode RGB status LED
- OLED SSD1306 I2C display
- 4-digit seven-segment display
- Button on GPIO 19

Zone layout:

| Zone | Label | Position |
| --- | --- | --- |
| 0 | LF | Left front |
| 1 | RF | Right front |
| 2 | LR | Left rear |
| 3 | RR | Right rear |
| 4 | LL | Left lateral |
| 5 | RL | Right lateral |

## Web Bluetooth

The web app uses BLE UART over GATT. Classic Bluetooth SPP does not work with Web Bluetooth, so the ESP32 firmware in this repository replaces `BluetoothSerial` with BLE notifications.

BLE UUIDs:

| Role | UUID |
| --- | --- |
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX write | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX notify | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

Commands from the browser:

```json
{"cmd":"set_mode","mode":3}
{"cmd":"start"}
{"cmd":"stop"}
```

Trial event from ESP32:

```json
{"event":"trial","trial":1,"total":20,"mode":0,"zone":2,"zone_name":"LR","pressed_zone":2,"pressed_zone_name":"LR","stim":"RED","rt_ms":245.3,"result":"go_correct","peak_adc":1380}
```

## Dashboard Features

- BLE connection and status display
- Mode selection for Baseline, Left, Right, Dual Task, Fatigue, and Quick Screen
- Live 6-zone mat visualization
- Trial stream table
- Mean and median reaction time
- Limb Symmetry Index
- Dual-task cost
- False-alarm and correct-withhold rates
- Fatigue index
- Per-zone reaction heatmap
- CSV and JSON export
- Hardware-free demo mode

## Biomedical Engineering Context

The dashboard frames reaction testing as a neurocognitive-motor assessment relevant to sport rehabilitation and return-to-play discussion. It explains:

- Reaction time as visual perception, decision-making, motor planning, and foot contact
- LSI as side-to-side neuromuscular symmetry
- Dual-task cost as cognitive-motor load
- False alarms as inhibitory-control failures
- Fatigue index as repeated-trial motor-control decline

This is an educational prototype, not a medical clearance tool.

## iPhone + Bluefy

iOS Safari does not natively support Web Bluetooth. For an iPhone demonstration:

1. Upload `firmware/SmartReactionPad_BLE/SmartReactionPad_BLE.ino` to the ESP32.
2. Open the GitHub Pages URL in Bluefy.
3. Tap `Connect BLE`.
4. Select `SmartReactionPad`.
5. Choose a mode and tap `Start`.

See [docs/connection-guide-zh.md](docs/connection-guide-zh.md) for the Chinese setup guide.

## Local Use

Because the app is static, it can be served by any local web server:

```bash
python -m http.server 8080
```

Open `http://localhost:8080` for desktop testing. Web Bluetooth on mobile requires an HTTPS origin, so use GitHub Pages for the iPhone/Bluefy demo.

## Validation

The repository includes a bundled sample session and a lightweight parser/statistics check:

```bash
node tools/validate-sample.mjs
```

Expected output:

```text
Validated 6 sample trials. Mean RT 268 ms.
```

## References

- MDN Web Bluetooth API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- Can I use Web Bluetooth: https://caniuse.com/web-bluetooth
- Chrome Web Bluetooth guide: https://developer.chrome.com/docs/capabilities/bluetooth
- Arduino ESP32 BLE UART example: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ble.html
- Wilk et al. 2023, ACL return-to-play reactive testing model: https://ijspt.scholasticahq.com/article/67988-the-need-to-change-return-to-play-testing-in-athletes-following-acl-injury-a-theoretical-model
- Tahir et al. 2020, FSR smart insole design: https://www.mdpi.com/1424-8220/20/4/957
