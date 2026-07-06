const UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

const MODES = {
  0: { label: "Baseline", total: 20 },
  1: { label: "Left", total: 12 },
  2: { label: "Right", total: 12 },
  3: { label: "Dual Task", total: 20 },
  4: { label: "Fatigue", total: 40 },
  5: { label: "Quick Screen", total: 10 },
};

const ZONES = [
  { id: 0, name: "LF", side: "left" },
  { id: 1, name: "RF", side: "right" },
  { id: 2, name: "LR", side: "left" },
  { id: 3, name: "RR", side: "right" },
  { id: 4, name: "LL", side: "left" },
  { id: 5, name: "RL", side: "right" },
];

const state = {
  device: null,
  server: null,
  rxCharacteristic: null,
  txCharacteristic: null,
  connected: false,
  demo: false,
  mode: 0,
  startTime: null,
  timerId: null,
  textBuffer: "",
  trials: [],
  summary: null,
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  modeSelect: document.querySelector("#modeSelect"),
  baselineInput: document.querySelector("#baselineInput"),
  connectButton: document.querySelector("#connectButton"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  demoButton: document.querySelector("#demoButton"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  bleHint: document.querySelector("#bleHint"),
  timer: document.querySelector("#sessionTimer"),
  trialCounter: document.querySelector("#trialCounter"),
  lastRt: document.querySelector("#lastRt"),
  contactLevel: document.querySelector("#contactLevel"),
  trialTable: document.querySelector("#trialTable"),
  meanRt: document.querySelector("#meanRt"),
  rtInterpretation: document.querySelector("#rtInterpretation"),
  lsiScore: document.querySelector("#lsiScore"),
  lsiInterpretation: document.querySelector("#lsiInterpretation"),
  lsiBar: document.querySelector("#lsiBar"),
  dualCost: document.querySelector("#dualCost"),
  dualInterpretation: document.querySelector("#dualInterpretation"),
  falseAlarmRate: document.querySelector("#falseAlarmRate"),
  withholdRate: document.querySelector("#withholdRate"),
  fatigueIndex: document.querySelector("#fatigueIndex"),
  fatigueInterpretation: document.querySelector("#fatigueInterpretation"),
  zoneHeatmap: document.querySelector("#zoneHeatmap"),
  rtChart: document.querySelector("#rtChart"),
};

function setStatus(label, mode) {
  els.connectionStatus.dataset.state = mode;
  els.connectionStatus.querySelector("strong").textContent = label;
}

function setHint(message) {
  els.bleHint.textContent = message;
}

function validRtTrials() {
  return state.trials.filter((trial) => Number.isFinite(trial.rt_ms) && trial.rt_ms >= 50 && trial.rt_ms <= 2000 && trial.result === "go_correct");
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "-- ms";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function modeLabel(mode) {
  return MODES[mode]?.label ?? `Mode ${mode}`;
}

function beginTimer() {
  state.startTime = Date.now();
  clearInterval(state.timerId);
  state.timerId = setInterval(updateTimer, 500);
  updateTimer();
}

function updateTimer() {
  if (!state.startTime) {
    els.timer.textContent = "00:00";
    return;
  }
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  els.timer.textContent = `${minutes}:${seconds}`;
}

function resetSession() {
  state.trials = [];
  state.summary = null;
  state.mode = Number(els.modeSelect.value);
  clearZones();
  beginTimer();
  render();
}

function clearZones() {
  document.querySelectorAll(".zone").forEach((zone) => {
    zone.classList.remove("active", "go", "nogo", "error");
  });
}

function flashZone(zoneId, stim, result) {
  clearZones();
  const zone = document.querySelector(`.zone[data-zone="${zoneId}"]`);
  if (!zone) return;
  zone.classList.add("active");
  if (stim === "RED") zone.classList.add("go");
  if (stim === "GREEN" || stim === "BLUE") zone.classList.add("nogo");
  if (result === "false_alarm" || result === "miss" || result === "too_fast") zone.classList.add("error");
  window.setTimeout(clearZones, 900);
}

function trialQuality(trial) {
  if (trial.result === "correct_withhold") return { label: "withhold", tone: "ok" };
  if (trial.result === "false_alarm") return { label: "false alarm", tone: "bad" };
  if (trial.result === "miss" || trial.result === "timeout") return { label: "timeout", tone: "bad" };
  if (trial.rt_ms < 50) return { label: "too fast", tone: "warn" };
  if (trial.rt_ms > 2000) return { label: "delayed", tone: "warn" };
  return { label: "valid", tone: "ok" };
}

function handleEvent(event) {
  if (!event || typeof event !== "object") return;

  if (event.event === "status") {
    if (event.mode !== undefined) state.mode = Number(event.mode);
    render();
    return;
  }

  if (event.event === "trial") {
    const trial = normalizeTrial(event);
    state.trials.push(trial);
    state.mode = Number(trial.mode ?? state.mode);
    flashZone(trial.zone, trial.stim, trial.result);
    render();
    return;
  }

  if (event.event === "summary") {
    state.summary = event;
    render();
  }
}

function normalizeTrial(event) {
  const zone = Number(event.zone);
  const zoneName = event.zone_name || ZONES[zone]?.name || `Z${zone + 1}`;
  const result = event.result || inferResult(event);
  return {
    event: "trial",
    trial: Number(event.trial ?? state.trials.length + 1),
    total: Number(event.total ?? MODES[state.mode]?.total ?? 0),
    mode: Number(event.mode ?? state.mode),
    zone,
    zone_name: zoneName,
    stim: event.stim || "RED",
    rt_ms: event.rt_ms === null || event.rt_ms === undefined ? null : Number(event.rt_ms),
    result,
    peak_adc: event.peak_adc === undefined ? null : Number(event.peak_adc),
    timestamp: new Date().toISOString(),
  };
}

function inferResult(event) {
  if (event.rt_ms === null) return "correct_withhold";
  if (event.rt_ms < 50) return "too_fast";
  if (event.rt_ms > 2000) return "miss";
  return "go_correct";
}

function handleNotification(event) {
  const decoder = new TextDecoder();
  state.textBuffer += decoder.decode(event.target.value);
  const lines = state.textBuffer.split("\n");
  state.textBuffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleEvent(JSON.parse(trimmed));
    } catch (error) {
      console.warn("Invalid BLE JSON:", trimmed, error);
    }
  }
}

async function connectBle() {
  if (!navigator.bluetooth) {
    setStatus("Unsupported", "offline");
    setHint("This browser does not expose Web Bluetooth. On iPhone, open the GitHub Pages URL inside Bluefy.");
    return;
  }

  try {
    setHint("Select SmartReactionPad from the Bluetooth device picker.");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "SmartReactionPad" }],
      optionalServices: [UART_SERVICE_UUID],
    });

    device.addEventListener("gattserverdisconnected", onDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(UART_SERVICE_UUID);
    const rxCharacteristic = await service.getCharacteristic(UART_RX_UUID);
    const txCharacteristic = await service.getCharacteristic(UART_TX_UUID);

    await txCharacteristic.startNotifications();
    txCharacteristic.addEventListener("characteristicvaluechanged", handleNotification);

    state.device = device;
    state.server = server;
    state.rxCharacteristic = rxCharacteristic;
    state.txCharacteristic = txCharacteristic;
    state.connected = true;
    state.demo = false;
    setStatus("BLE Connected", "online");
    setHint("Connected. Choose a test mode and press Start.");
  } catch (error) {
    console.error(error);
    setStatus("Offline", "offline");
    setHint(`Connection failed: ${error.message}`);
  }
}

function onDisconnected() {
  state.connected = false;
  state.rxCharacteristic = null;
  state.txCharacteristic = null;
  setStatus("Offline", "offline");
  setHint("BLE disconnected. Reconnect before starting another hardware session.");
}

async function sendCommand(command) {
  if (state.demo) return;
  if (!state.connected || !state.rxCharacteristic) {
    setHint("No BLE device connected. Use Run Demo for a hardware-free presentation.");
    return;
  }
  const payload = `${JSON.stringify(command)}\n`;
  const data = new TextEncoder().encode(payload);
  await state.rxCharacteristic.writeValue(data);
}

async function startHardwareSession() {
  resetSession();
  await sendCommand({ cmd: "set_mode", mode: state.mode });
  await sendCommand({ cmd: "start" });
  setHint("Session started. BLE trial events will appear as the ESP32 sends notifications.");
}

async function stopSession() {
  clearInterval(state.timerId);
  await sendCommand({ cmd: "stop" });
  setHint(state.demo ? "Demo stopped." : "Stop command sent.");
  state.demo = false;
}

function render() {
  renderCounters();
  renderTable();
  renderAnalysis();
  renderChart();
  renderHeatmap();
}

function renderCounters() {
  const lastTrial = state.trials.at(-1);
  const total = lastTrial?.total || MODES[state.mode]?.total || 0;
  els.trialCounter.textContent = `${state.trials.length} / ${total}`;
  els.lastRt.textContent = lastTrial && Number.isFinite(lastTrial.rt_ms) ? formatMs(lastTrial.rt_ms) : "-- ms";
  els.contactLevel.textContent = lastTrial?.peak_adc ? `${lastTrial.peak_adc} ADC` : "--";
}

function renderTable() {
  if (!state.trials.length) {
    els.trialTable.innerHTML = `<tr><td colspan="7" class="empty">No trials yet</td></tr>`;
    return;
  }

  els.trialTable.innerHTML = state.trials
    .slice()
    .reverse()
    .map((trial) => {
      const quality = trialQuality(trial);
      return `
        <tr>
          <td>${trial.trial}</td>
          <td>${modeLabel(trial.mode)}</td>
          <td>${trial.zone_name}</td>
          <td>${trial.stim}</td>
          <td>${Number.isFinite(trial.rt_ms) ? trial.rt_ms.toFixed(1) : "--"}</td>
          <td><span class="tag ${quality.tone}">${quality.label}</span></td>
          <td>${trial.peak_adc ?? "--"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAnalysis() {
  const valid = validRtTrials();
  const rtValues = valid.map((trial) => trial.rt_ms);
  const meanRt = mean(rtValues);
  const medRt = median(rtValues);
  const total = state.trials.length;
  const validRate = total ? (valid.length / total) * 100 : null;

  els.meanRt.textContent = formatMs(meanRt);
  els.rtInterpretation.textContent = meanRt
    ? `Median ${formatMs(medRt)}. Valid trial rate ${formatPercent(validRate)} after excluding anticipations, misses, and No-Go withholds.`
    : "Start a session to evaluate visual perception, decision speed, and motor initiation.";

  renderLsi(valid);
  renderDualTask(valid, meanRt);
  renderFatigue(valid);
}

function renderLsi(valid) {
  const left = valid.filter((trial) => ZONES[trial.zone]?.side === "left").map((trial) => trial.rt_ms);
  const right = valid.filter((trial) => ZONES[trial.zone]?.side === "right").map((trial) => trial.rt_ms);
  const leftMean = mean(left);
  const rightMean = mean(right);

  if (!leftMean || !rightMean) {
    els.lsiScore.textContent = "--%";
    els.lsiInterpretation.textContent = "Run both left and right zones to estimate side-to-side neuromuscular symmetry.";
    els.lsiBar.style.width = "0";
    return;
  }

  const lsi = (Math.min(leftMean, rightMean) / Math.max(leftMean, rightMean)) * 100;
  els.lsiScore.textContent = `${lsi.toFixed(0)}%`;
  els.lsiBar.style.width = `${Math.min(100, lsi)}%`;

  if (lsi >= 90) {
    els.lsiInterpretation.textContent = `Acceptable symmetry. Left ${formatMs(leftMean)}, right ${formatMs(rightMean)}.`;
  } else if (lsi >= 85) {
    els.lsiInterpretation.textContent = `Caution: mild asymmetry. Left ${formatMs(leftMean)}, right ${formatMs(rightMean)}.`;
  } else {
    els.lsiInterpretation.textContent = `Deficit flag: clear side-to-side RT asymmetry. Left ${formatMs(leftMean)}, right ${formatMs(rightMean)}.`;
  }
}

function renderDualTask(valid, currentMean) {
  const baseline = Number(els.baselineInput.value);
  const dualValid = valid.filter((trial) => trial.mode === 3);
  const dualMean = mean(dualValid.map((trial) => trial.rt_ms)) ?? currentMean;
  const falseAlarms = state.trials.filter((trial) => trial.result === "false_alarm").length;
  const noGoTrials = state.trials.filter((trial) => trial.stim === "GREEN" || trial.stim === "BLUE").length;
  const withholds = state.trials.filter((trial) => trial.result === "correct_withhold").length;

  const cost = dualMean && baseline ? ((dualMean - baseline) / baseline) * 100 : null;
  els.dualCost.textContent = Number.isFinite(cost) ? `${cost.toFixed(0)}%` : "--";
  els.falseAlarmRate.textContent = noGoTrials ? formatPercent((falseAlarms / noGoTrials) * 100) : "--";
  els.withholdRate.textContent = noGoTrials ? formatPercent((withholds / noGoTrials) * 100) : "--";

  if (!Number.isFinite(cost)) {
    els.dualInterpretation.textContent = "Dual-task cost and false alarms reflect inhibitory control under sport-like uncertainty.";
  } else if (cost > 20 || (dualMean - baseline) > 50) {
    els.dualInterpretation.textContent = `Caution: dual-task slowing is ${formatMs(dualMean - baseline)} above baseline, suggesting added cognitive-motor load.`;
  } else {
    els.dualInterpretation.textContent = `Within target: dual-task slowing is ${formatMs(dualMean - baseline)} above baseline.`;
  }
}

function renderFatigue(valid) {
  if (valid.length < 8) {
    els.fatigueIndex.textContent = "--";
    els.fatigueInterpretation.textContent = "Repeated-trial slowing can indicate reduced neuromuscular control under fatigue.";
    return;
  }

  const half = Math.floor(valid.length / 2);
  const earlyMean = mean(valid.slice(0, half).map((trial) => trial.rt_ms));
  const lateMean = mean(valid.slice(half).map((trial) => trial.rt_ms));
  const index = ((lateMean - earlyMean) / earlyMean) * 100;
  els.fatigueIndex.textContent = `${index.toFixed(0)}%`;

  if (index > 20) {
    els.fatigueInterpretation.textContent = `Caution: late trials slowed by ${formatMs(lateMean - earlyMean)}, indicating fatigue-sensitive motor control.`;
  } else {
    els.fatigueInterpretation.textContent = `Stable: late-trial change is ${formatMs(lateMean - earlyMean)} compared with early trials.`;
  }
}

function renderChart() {
  const canvas = els.rtChart;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafb";
  ctx.fillRect(0, 0, width, height);

  const values = state.trials.map((trial) => Number.isFinite(trial.rt_ms) ? trial.rt_ms : null);
  if (!values.some(Number.isFinite)) {
    ctx.fillStyle = "#5d6b78";
    ctx.font = "24px sans-serif";
    ctx.fillText("Reaction-time trend appears here", 34, height / 2);
    return;
  }

  const max = Math.max(600, ...values.filter(Number.isFinite));
  const min = 0;
  const stepX = width / Math.max(1, values.length - 1);
  ctx.strokeStyle = "#d8e0e4";
  ctx.lineWidth = 2;
  for (let y = 40; y < height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 4;
  ctx.beginPath();
  let started = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = index * stepX;
    const y = height - 26 - ((value - min) / (max - min)) * (height - 52);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = index * stepX;
    const y = height - 26 - ((value - min) / (max - min)) * (height - 52);
    ctx.fillStyle = value < 50 || value > 2000 ? "#d97706" : "#0f766e";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function renderHeatmap() {
  els.zoneHeatmap.innerHTML = "";
  for (const zone of ZONES) {
    const values = validRtTrials().filter((trial) => trial.zone === zone.id).map((trial) => trial.rt_ms);
    const zoneMean = mean(values);
    const cell = document.createElement("div");
    cell.className = "heat-cell";
    const intensity = zoneMean ? Math.min(1, Math.max(0, (zoneMean - 200) / 500)) : 0;
    cell.style.background = zoneMean ? `rgba(15, 118, 110, ${0.10 + (1 - intensity) * 0.30})` : "#f8fafb";
    cell.innerHTML = `<span>${zone.name}</span><strong>${formatMs(zoneMean)}</strong>`;
    els.zoneHeatmap.appendChild(cell);
  }
}

function buildDemoTrial(index, mode) {
  const total = MODES[mode].total;
  const zonePool = mode === 1 ? [0, 2, 4] : mode === 2 ? [1, 3, 5] : [0, 1, 2, 3, 4, 5];
  const zone = zonePool[index % zonePool.length];
  let stim = "RED";
  let result = "go_correct";
  let rt = Math.round(220 + Math.random() * 150 + (mode === 4 ? index * 3.2 : 0));

  if (mode === 3) {
    const roll = Math.random();
    if (roll > 0.8) {
      stim = "BLUE";
      result = Math.random() > 0.25 ? "correct_withhold" : "false_alarm";
      rt = result === "false_alarm" ? Math.round(260 + Math.random() * 190) : null;
    } else if (roll > 0.6) {
      stim = "GREEN";
      result = Math.random() > 0.22 ? "correct_withhold" : "false_alarm";
      rt = result === "false_alarm" ? Math.round(260 + Math.random() * 190) : null;
    } else {
      rt += 70;
    }
  }

  if (Math.random() < 0.04 && result === "go_correct") {
    result = "miss";
    rt = 2100;
  }

  return normalizeTrial({
    event: "trial",
    trial: index + 1,
    total,
    mode,
    zone,
    zone_name: ZONES[zone].name,
    stim,
    rt_ms: rt,
    result,
    peak_adc: Math.round(850 + Math.random() * 2500),
  });
}

function runDemo() {
  resetSession();
  state.demo = true;
  setStatus("Demo", "demo");
  setHint("Demo mode is generating realistic BLE JSON events without hardware.");
  const mode = state.mode;
  const total = MODES[mode].total;
  let index = 0;
  const id = setInterval(() => {
    const trial = buildDemoTrial(index, mode);
    state.trials.push(trial);
    flashZone(trial.zone, trial.stim, trial.result);
    render();
    index += 1;
    if (index >= total) {
      clearInterval(id);
      const valid = validRtTrials();
      state.summary = {
        event: "summary",
        avg_ms: Math.round(mean(valid.map((trial) => trial.rt_ms)) || 0),
        valid: valid.length,
        total,
        errors: state.trials.filter((trial) => trial.result === "false_alarm").length,
        correct_withholds: state.trials.filter((trial) => trial.result === "correct_withhold").length,
      };
      render();
    }
  }, 450);
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  const payload = {
    exported_at: new Date().toISOString(),
    mode: state.mode,
    trials: state.trials,
    summary: state.summary,
  };
  download("smart-reaction-pad-session.json", JSON.stringify(payload, null, 2), "application/json");
}

function exportCsv() {
  const header = ["trial", "total", "mode", "zone", "zone_name", "stim", "rt_ms", "result", "peak_adc", "timestamp"];
  const rows = state.trials.map((trial) => header.map((key) => trial[key] ?? "").join(","));
  download("smart-reaction-pad-session.csv", [header.join(","), ...rows].join("\n"), "text/csv");
}

els.connectButton.addEventListener("click", connectBle);
els.startButton.addEventListener("click", startHardwareSession);
els.stopButton.addEventListener("click", stopSession);
els.demoButton.addEventListener("click", runDemo);
els.exportJsonButton.addEventListener("click", exportJson);
els.exportCsvButton.addEventListener("click", exportCsv);
els.modeSelect.addEventListener("change", () => {
  state.mode = Number(els.modeSelect.value);
  sendCommand({ cmd: "set_mode", mode: state.mode });
  renderCounters();
});

if (!navigator.bluetooth) {
  setHint("Web Bluetooth is not available in this browser. Use Bluefy on iPhone or Chrome/Edge on desktop/Android.");
}

setStatus("Offline", "offline");
render();
