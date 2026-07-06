# Smart Reaction Pad 蓝牙连接与 Arduino IDE 教程

这份教程用于把 ESP32 版本的 Smart Reaction Pad 连接到网页 Dashboard。网页使用 Web Bluetooth，因此 ESP32 必须运行 BLE/GATT 固件，而不是旧版 `BluetoothSerial` 经典蓝牙串口固件。

## 1. 准备 Arduino IDE

1. 打开 Arduino IDE。
2. 在 Boards Manager 中安装 `esp32 by Espressif Systems`。
3. 选择开发板：`ESP32 Dev Module`。
4. 推荐上传设置：
   - Upload Speed: `921600` 或 `115200`
   - CPU Frequency: `240MHz`
   - Flash Frequency: `80MHz`
   - Partition Scheme: `Default 4MB with spiffs`
   - Core Debug Level: `None`
5. 安装库：
   - `Adafruit SSD1306`
   - `Adafruit GFX Library`
   - `Adafruit BusIO`
6. ESP32 BLE 库随 ESP32 Arduino Core 提供，通常不需要额外安装。

## 2. 上传 BLE 固件

1. 打开 `firmware/SmartReactionPad_BLE/SmartReactionPad_BLE.ino`。
2. 用 USB 连接 ESP32。
3. 点击 Upload。
4. 上传后打开 Serial Monitor，波特率设置为 `115200`。
5. 如果看到 `Smart Reaction Pad BLE ready`，说明固件启动成功。

设备上电后的预期表现：

- 数码管先显示 `8888`，随后显示当前模式号。
- OLED 显示 `Smart Reaction Pad`、BLE 状态、模式和轮次数。
- 中央 RGB 蓝灯短暂亮起，表示 BLE 广播已启动。

## 3. 为什么不能直接用旧版经典蓝牙？

你原来的固件使用 `BluetoothSerial`，它属于经典蓝牙 SPP 串口。很多串口调试 App 可以连接它，但网页的 Web Bluetooth API 只支持 BLE GATT 设备。

Bluefy/Chrome 这类浏览器寻找的是 BLE Service 和 Characteristic，不会把经典蓝牙串口暴露给网页。所以要让网页直接接收 ESP32 数据，必须改为 BLE UART 方案。

本项目使用的 BLE UART UUID：

- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX write: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX notify: `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

## 4. iPhone + Bluefy 连接步骤

1. 确认 iPhone 蓝牙已打开。
2. 打开 Bluefy。
3. 在 Bluefy 地址栏输入 GitHub Pages 的 HTTPS 页面地址。
4. 打开网页后点击 `Connect BLE`。
5. 在弹出的设备选择框中选择 `SmartReactionPad`。
6. 允许网页访问蓝牙设备。
7. 连接成功后，网页右上角应显示 `BLE Connected`。
8. 选择测试模式，例如 `Baseline - 20 Go trials`。
9. 点击 `Start`。
10. ESP32 会随机点亮目标区域，踩对应 FSR 后，网页会收到实时 trial JSON 并更新图表。

## 5. 常见问题

### 网页找不到设备

- 确认 ESP32 已上传 BLE 固件，不是旧版 `BluetoothSerial` 固件。
- 按 ESP32 的 EN/Reset 键重启。
- 确认 Bluefy 有蓝牙权限。
- 设备名应显示为 `SmartReactionPad`。

### 页面提示 Web Bluetooth 不可用

- iOS Safari 本身不支持 Web Bluetooth。
- 必须在 Bluefy 中打开网页。
- 页面必须通过 HTTPS 加载。GitHub Pages 可以满足这个要求。

### 已连接但没有数据

- 确认点击了网页的 `Start`。
- 确认 ESP32 OLED 显示测试已开始或数码管进入 `----` 预备状态。
- 确认 FSR 分压电路接地正确，踩踏时 ADC 能超过阈值。
- 用 Serial Monitor 检查是否打印 JSON trial event。

### 模式不正确

- 在网页选择模式后，只有 ESP32 处于 IDLE 状态时才会接受 `set_mode`。
- 如果刚完成一次测试，先点击 `Stop` 或按 ESP32 按钮复位到 IDLE。

### BLE 中途断开

- 让手机靠近 ESP32。
- 避免 ESP32 USB 供电不稳。
- 刷新 Bluefy 页面后重新点击 `Connect BLE`。

## 6. 课堂演示建议

如果现场蓝牙环境不稳定，可以先点击网页的 `Run Demo` 展示完整 UI、图表和临床分析逻辑；随后再切换到 BLE 实机演示。Demo 模式不会影响 ESP32。
