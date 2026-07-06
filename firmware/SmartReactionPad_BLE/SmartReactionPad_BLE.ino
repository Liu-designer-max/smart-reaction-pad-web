/*
 * Smart Reaction Pad BLE Firmware
 * Full 6-Zone RTP System for Web Bluetooth / Bluefy
 *
 * Hardware:
 *   ESP32 Dev Module + 6 FSR + 2x 74HC164N + 12 Zone LEDs
 *   4-digit 7-segment display + OLED SSD1306 + KY-009 RGB + button
 *
 * BLE UART:
 *   Service: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   RX write: 6E400002-B5A3-F393-E0A9-E50E24DCCA9E
 *   TX notify: 6E400003-B5A3-F393-E0A9-E50E24DCCA9E
 *
 * Commands, newline-delimited JSON:
 *   {"cmd":"set_mode","mode":3}
 *   {"cmd":"start"}
 *   {"cmd":"stop"}
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ==================== BLE UUIDs ====================
#define DEVICE_NAME "SmartReactionPad"
#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

BLEServer *pServer = nullptr;
BLECharacteristic *pTxCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;
String pendingCommand = "";

// ==================== Pins ====================
const int FSR_PINS[6] = {36, 39, 34, 35, 32, 33};
const char* ZONE_NAMES[6] = {"LF", "RF", "LR", "RR", "LL", "RL"};

const int PIN_164_DATA  = 23;
const int PIN_164_CLOCK = 27;

const int SEG[7] = {13, 14, 15, 16, 17, 26, 12};
const int DIG[4] = {2, 25, 4, 5};

const int BTN = 19;

#define OLED_ADDR 0x3C
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

// ==================== Display ====================
const uint8_t FONT[] = {
  0b00111111, // 0
  0b00000110, // 1
  0b01011011, // 2
  0b01001111, // 3
  0b01100110, // 4
  0b01101101, // 5
  0b01111101, // 6
  0b00000111, // 7
  0b01111111, // 8
  0b01101111, // 9
  0b01110111, // A
  0b01111001, // E
  0b01000000, // -
  0b00000000, // blank
};

volatile uint8_t dispBuf[4] = {13, 13, 13, 13};
hw_timer_t *dispTimer = nullptr;

// ==================== 74HC164N ====================
byte ledBuf[2] = {0, 0};

// ==================== Parameters ====================
const int FSR_THRESHOLD = 500;
const unsigned long MIN_DELAY = 2000;
const unsigned long MAX_DELAY = 7000;
const unsigned long TIMEOUT_MS = 2000;
const unsigned long DEBOUNCE_MS = 20;
int modeTrials[6] = {20, 12, 12, 20, 40, 10};

enum Mode  { MODE_BASELINE=0, MODE_LEFT, MODE_RIGHT, MODE_DUAL, MODE_FATIGUE, MODE_QUICK };
enum State { IDLE, READY, STIMULUS, RESULT, DONE };

Mode currentMode = MODE_BASELINE;
State state = IDLE;
int trial = 0;
float rtData[60];
int zoneData[60];
int stimData[60];
int resultData[60];
int peakData[60];
unsigned long stimStart_us = 0;
unsigned long armStart_ms = 0;
unsigned long randomDelay_ms = 0;
unsigned long stateStart_ms = 0;
int activeZone = -1;
int stimLED = 0; // 0=RED Go, 1=GREEN No-Go, 2=BLUE No-Go
int peakAdc = 0;

// ==================== Display Functions ====================
void IRAM_ATTR refreshDisplay() {
  static uint8_t d = 0;
  for (int i = 0; i < 4; i++) digitalWrite(DIG[i], HIGH);

  uint8_t start = d;
  while (dispBuf[d] == 13) {
    d = (d + 1) % 4;
    if (d == start) return;
  }

  uint8_t pattern = dispBuf[d];
  for (int s = 0; s < 7; s++) digitalWrite(SEG[s], (pattern >> s) & 1);
  digitalWrite(DIG[d], LOW);
  d = (d + 1) % 4;
}

void setRaw(uint8_t d3, uint8_t d2, uint8_t d1, uint8_t d0) {
  noInterrupts();
  dispBuf[0] = d3;
  dispBuf[1] = d2;
  dispBuf[2] = d1;
  dispBuf[3] = d0;
  interrupts();
}

void showNum(int n) {
  if (n < 0 || n > 9999) {
    setRaw(13, 13, 13, 13);
    return;
  }

  int d3 = n / 1000 % 10;
  int d2 = n / 100 % 10;
  int d1 = n / 10 % 10;
  int d0 = n % 10;
  bool show = false;
  uint8_t p3 = 13, p2 = 13, p1 = 13, p0 = 13;

  if (n >= 1000) show = true;
  if (show) p3 = FONT[d3];
  if (n >= 100 || show) { show = true; p2 = FONT[d2]; }
  if (n >= 10 || show) { show = true; p1 = FONT[d1]; }
  p0 = FONT[d0];
  setRaw(p3, p2, p1, p0);
}

void showDash() { setRaw(12, 12, 12, 12); }
void showErr()  { setRaw(11, 11, 11, 11); }
void showAvg(int a) { setRaw(FONT[10], FONT[a / 100 % 10], FONT[a / 10 % 10], FONT[a % 10]); }
void showMode(int m) { setRaw(13, 13, 13, FONT[m]); }

// ==================== LED Functions ====================
void shiftOut164() {
  shiftOut(PIN_164_DATA, PIN_164_CLOCK, LSBFIRST, ledBuf[1]);
  shiftOut(PIN_164_DATA, PIN_164_CLOCK, LSBFIRST, ledBuf[0]);
}

void zoneLED(int z, bool red, bool green) {
  int base;
  if (z < 4) {
    base = z * 2;
    if (red) ledBuf[0] |= (1 << base); else ledBuf[0] &= ~(1 << base);
    if (green) ledBuf[0] |= (1 << (base + 1)); else ledBuf[0] &= ~(1 << (base + 1));
  } else {
    base = (z - 4) * 2;
    if (red) ledBuf[1] |= (1 << base); else ledBuf[1] &= ~(1 << base);
    if (green) ledBuf[1] |= (1 << (base + 1)); else ledBuf[1] &= ~(1 << (base + 1));
  }
  shiftOut164();
}

void ky009(bool r, bool g, bool b) {
  if (r) ledBuf[1] &= ~(1 << 4); else ledBuf[1] |= (1 << 4);
  if (g) ledBuf[1] &= ~(1 << 5); else ledBuf[1] |= (1 << 5);
  if (b) ledBuf[1] &= ~(1 << 6); else ledBuf[1] |= (1 << 6);
  shiftOut164();
}

void allZoneOff() {
  ledBuf[0] = 0;
  ledBuf[1] = 0;
  shiftOut164();
  ky009(false, false, false);
}

// ==================== OLED ====================
void oledLine(int line, const String &text, int size = 1) {
  oled.setTextSize(size);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, line * 10);
  oled.print(text);
}

void oledIdle() {
  oled.clearDisplay();
  oledLine(0, "Smart Reaction Pad");
  oledLine(1, "BLE: " + String(deviceConnected ? "Connected" : "Waiting"));
  oledLine(2, "Mode: " + String((int)currentMode));
  oledLine(3, "Trials: " + String(modeTrials[currentMode]));
  oledLine(5, "Btn: short start");
  oled.display();
}

// ==================== BLE ====================
void notifyLine(const String &line) {
  Serial.println(line);
  if (!deviceConnected || pTxCharacteristic == nullptr) return;

  String payload = line + "\n";
  const size_t chunkSize = 180;
  for (size_t i = 0; i < payload.length(); i += chunkSize) {
    size_t endIndex = i + chunkSize;
    if (endIndex > payload.length()) endIndex = payload.length();
    String chunk = payload.substring(i, endIndex);
    pTxCharacteristic->setValue((uint8_t*)chunk.c_str(), chunk.length());
    pTxCharacteristic->notify();
    delay(8);
  }
}

void sendStatus() {
  notifyLine("{\"event\":\"status\",\"state\":\"" + String(state == IDLE ? "IDLE" : state == READY ? "READY" : state == STIMULUS ? "STIMULUS" : state == RESULT ? "RESULT" : "DONE") + "\",\"mode\":" + String((int)currentMode) + ",\"trial\":" + String(trial + 1) + "}");
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) {
    deviceConnected = true;
    ky009(false, true, false);
  }

  void onDisconnect(BLEServer *server) {
    deviceConnected = false;
    ky009(false, false, true);
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) {
    String value = characteristic->getValue();
    if (value.length() > 0) pendingCommand += value;
  }
};

void setupBle() {
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *service = pServer->createService(SERVICE_UUID);
  pTxCharacteristic = service->createCharacteristic(CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_NOTIFY);
  pTxCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic *rxCharacteristic = service->createCharacteristic(CHARACTERISTIC_UUID_RX, BLECharacteristic::PROPERTY_WRITE);
  rxCharacteristic->setCallbacks(new RxCallbacks());

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
}

// ==================== Controls ====================
int checkButton() {
  static bool last = HIGH;
  bool b = digitalRead(BTN);
  if (last == HIGH && b == LOW) {
    delay(30);
    if (digitalRead(BTN) == LOW) {
      unsigned long t = millis();
      while (digitalRead(BTN) == LOW) {
        if (millis() - t > 800) {
          while (digitalRead(BTN) == LOW) delay(10);
          delay(50);
          last = HIGH;
          return 2;
        }
        delay(10);
      }
      delay(50);
      last = HIGH;
      return 1;
    }
  }
  last = b;
  return 0;
}

void resetAll() {
  trial = 0;
  for (int i = 0; i < 60; i++) {
    rtData[i] = 0;
    zoneData[i] = -1;
    stimData[i] = -1;
    resultData[i] = 0;
    peakData[i] = 0;
  }
  allZoneOff();
  showMode((int)currentMode);
  state = IDLE;
  oledIdle();
  sendStatus();
}

void startTest();
void nextTrial();

void parseCommand(const String &cmd) {
  if (cmd.indexOf("\"set_mode\"") >= 0) {
    int modePos = cmd.indexOf("\"mode\"");
    if (modePos >= 0) {
      int colon = cmd.indexOf(':', modePos);
      if (colon >= 0) {
        int m = cmd.substring(colon + 1).toInt();
        if (m >= 0 && m <= 5 && state == IDLE) {
          currentMode = (Mode)m;
          showMode(m);
          oledIdle();
          sendStatus();
        }
      }
    }
    return;
  }

  if (cmd.indexOf("\"start\"") >= 0 && (state == IDLE || state == DONE)) {
    if (state == DONE) resetAll();
    startTest();
    return;
  }

  if (cmd.indexOf("\"stop\"") >= 0) {
    resetAll();
  }
}

void processCommands() {
  int newline = pendingCommand.indexOf('\n');
  while (newline >= 0) {
    String cmd = pendingCommand.substring(0, newline);
    cmd.trim();
    pendingCommand = pendingCommand.substring(newline + 1);
    if (cmd.length()) parseCommand(cmd);
    newline = pendingCommand.indexOf('\n');
  }
}

// ==================== Test Flow ====================
void startTest() {
  trial = 0;
  for (int i = 0; i < 60; i++) {
    rtData[i] = 0;
    zoneData[i] = -1;
    stimData[i] = -1;
    resultData[i] = 0;
    peakData[i] = 0;
  }
  notifyLine("{\"event\":\"status\",\"state\":\"STARTED\",\"mode\":" + String((int)currentMode) + ",\"total\":" + String(modeTrials[currentMode]) + "}");
  nextTrial();
}

void nextTrial() {
  if (trial >= modeTrials[currentMode]) {
    state = DONE;
    return;
  }

  allZoneOff();
  peakAdc = 0;

  if (currentMode == MODE_LEFT) {
    const int leftZones[3] = {0, 2, 4};
    activeZone = leftZones[random(0, 3)];
  } else if (currentMode == MODE_RIGHT) {
    const int rightZones[3] = {1, 3, 5};
    activeZone = rightZones[random(0, 3)];
  } else {
    activeZone = random(0, 6);
  }

  randomDelay_ms = random(MIN_DELAY, MAX_DELAY + 1);
  armStart_ms = millis();

  zoneLED(activeZone, true, true);
  delay(200);
  allZoneOff();
  showDash();
  state = READY;
  sendStatus();
}

void fireStimulus() {
  if (currentMode == MODE_DUAL) {
    int r = random(100);
    if (r < 60) stimLED = 0;
    else if (r < 80) stimLED = 1;
    else stimLED = 2;

    if (stimLED == 0) zoneLED(activeZone, true, false);
    else if (stimLED == 1) zoneLED(activeZone, false, true);
    else ky009(false, false, true);
  } else {
    stimLED = 0;
    zoneLED(activeZone, true, false);
  }

  stimStart_us = micros();
  state = STIMULUS;
  showNum(0);
}

void recordTrial(float rt, const String &result) {
  allZoneOff();
  ky009(false, false, false);

  rtData[trial] = rt;
  zoneData[trial] = activeZone;
  stimData[trial] = stimLED;
  peakData[trial] = peakAdc;
  if (result == "go_correct") resultData[trial] = 0;
  else if (result == "false_alarm") resultData[trial] = 1;
  else if (result == "correct_withhold") resultData[trial] = 2;
  else resultData[trial] = 3;

  String stimName = stimLED == 0 ? "RED" : stimLED == 1 ? "GREEN" : "BLUE";
  String rtField = rt < 0 ? "null" : String(rt, 1);
  String payload = "{\"event\":\"trial\",\"trial\":" + String(trial + 1) +
    ",\"total\":" + String(modeTrials[currentMode]) +
    ",\"mode\":" + String((int)currentMode) +
    ",\"zone\":" + String(activeZone) +
    ",\"zone_name\":\"" + String(ZONE_NAMES[activeZone]) + "\"" +
    ",\"stim\":\"" + stimName + "\"" +
    ",\"rt_ms\":" + rtField +
    ",\"result\":\"" + result + "\"" +
    ",\"peak_adc\":" + String(peakAdc) + "}";
  notifyLine(payload);

  trial++;
  state = RESULT;
  stateStart_ms = millis();
}

void handleResponse() {
  float rt = (micros() - stimStart_us) / 1000.0;
  bool falseAlarm = currentMode == MODE_DUAL && stimLED != 0;

  if (falseAlarm) {
    showErr();
    ky009(true, false, false);
    recordTrial(rt, "false_alarm");
  } else if (rt < 50) {
    showNum((int)rt);
    ky009(true, true, false);
    recordTrial(rt, "too_fast");
  } else if (rt > 2000) {
    showDash();
    ky009(true, false, false);
    recordTrial(rt, "miss");
  } else {
    showNum((int)rt);
    ky009(false, true, false);
    recordTrial(rt, "go_correct");
  }
}

void handleTimeout() {
  bool correctWithhold = currentMode == MODE_DUAL && stimLED != 0;
  showDash();
  if (correctWithhold) {
    ky009(false, true, false);
    recordTrial(-1, "correct_withhold");
  } else {
    ky009(true, false, false);
    recordTrial(-1, "miss");
  }
}

void summary() {
  float sum = 0;
  int valid = 0;
  int errors = 0;
  int withholds = 0;

  for (int i = 0; i < modeTrials[currentMode]; i++) {
    if (rtData[i] >= 50 && rtData[i] <= 2000 && resultData[i] == 0) {
      sum += rtData[i];
      valid++;
    }
    if (resultData[i] == 1) errors++;
    if (resultData[i] == 2) withholds++;
  }

  int avg = valid ? (int)(sum / valid + 0.5) : 0;
  showAvg(avg);

  oled.clearDisplay();
  oledLine(0, "Complete");
  oledLine(2, "Avg: " + String(avg) + " ms", 2);
  oledLine(5, "Valid: " + String(valid) + "/" + String(modeTrials[currentMode]));
  oled.display();

  notifyLine("{\"event\":\"summary\",\"mode\":" + String((int)currentMode) +
    ",\"avg_ms\":" + String(avg) +
    ",\"valid\":" + String(valid) +
    ",\"total\":" + String(modeTrials[currentMode]) +
    ",\"errors\":" + String(errors) +
    ",\"correct_withholds\":" + String(withholds) + "}");
  state = DONE;
}

// ==================== Setup / Loop ====================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_164_DATA, OUTPUT);
  pinMode(PIN_164_CLOCK, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);
  for (int i = 0; i < 7; i++) {
    pinMode(SEG[i], OUTPUT);
    digitalWrite(SEG[i], LOW);
  }
  for (int i = 0; i < 4; i++) {
    pinMode(DIG[i], OUTPUT);
    digitalWrite(DIG[i], HIGH);
  }

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  randomSeed(analogRead(34));

  Wire.begin(21, 22);
  oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  oled.clearDisplay();
  oled.display();

  dispTimer = timerBegin(1000000);
  timerAttachInterrupt(dispTimer, &refreshDisplay);
  timerAlarm(dispTimer, 1000, true, 0);

  allZoneOff();
  ky009(false, false, true);
  setRaw(FONT[8], FONT[8], FONT[8], FONT[8]);
  delay(600);
  ky009(false, false, false);
  showMode((int)currentMode);

  setupBle();
  oledIdle();

  Serial.println("Smart Reaction Pad BLE ready");
}

void loop() {
  processCommands();

  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    oldDeviceConnected = false;
    oledIdle();
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = true;
    oledIdle();
    sendStatus();
  }

  int btn = checkButton();

  switch (state) {
    case IDLE:
      if (btn == 2) {
        currentMode = (Mode)(((int)currentMode + 1) % 6);
        showMode((int)currentMode);
        oledIdle();
        sendStatus();
      } else if (btn == 1) {
        startTest();
      }
      break;

    case READY:
      if (millis() - armStart_ms >= randomDelay_ms) fireStimulus();
      break;

    case STIMULUS: {
      unsigned long elapsed = (micros() - stimStart_us) / 1000;
      int adc = analogRead(FSR_PINS[activeZone]);
      if (adc > peakAdc) peakAdc = adc;
      if (elapsed > TIMEOUT_MS) {
        handleTimeout();
      } else if (adc > FSR_THRESHOLD && elapsed > DEBOUNCE_MS) {
        handleResponse();
      } else if (elapsed < 10000) {
        showNum((int)elapsed);
      }
      break;
    }

    case RESULT:
      if (millis() - stateStart_ms > 1800) {
        if (trial >= modeTrials[currentMode]) summary();
        else nextTrial();
      }
      break;

    case DONE:
      if (btn == 1) resetAll();
      else if (btn == 2) {
        currentMode = (Mode)(((int)currentMode + 1) % 6);
        resetAll();
      }
      break;
  }
}
