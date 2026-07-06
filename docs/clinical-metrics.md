# Clinical Metrics Used in the Smart Reaction Pad Dashboard

This dashboard is designed for a biomedical engineering teaching prototype. It supports return-to-play discussion after lower-limb sport injury, especially ACL rehabilitation contexts, but it is not a clinical clearance device.

## Reaction Time

Reaction time (RT) is interpreted as the combined time required for visual perception, decision processing, motor planning, and foot contact on the correct FSR zone. In this project, the timer starts when the LED stimulus is triggered and stops when the target FSR exceeds the pressure threshold.

Rules used in the dashboard:

- RT below 50 ms is flagged as an anticipation or sensor artifact.
- RT above 2000 ms is treated as a missed or delayed response and excluded from valid mean RT.
- Mean and median RT are computed from valid Go responses only.

Physiological meaning:

- Faster RT suggests efficient visual-motor processing.
- Slower RT may indicate fatigue, hesitation, attention loss, pain avoidance, or impaired neuromuscular readiness.

## Limb Symmetry Index

The Limb Symmetry Index (LSI) estimates side-to-side reaction symmetry:

```text
LSI = min(left mean RT, right mean RT) / max(left mean RT, right mean RT) x 100
```

Interpretation:

- 90% or above: acceptable symmetry target.
- 85% to 89%: caution, mild asymmetry.
- Below 85%: deficit flag.

Physiological meaning:

For lower-limb rehabilitation, large side-to-side differences may reflect altered confidence, protective motor strategies, impaired proprioception, or incomplete neuromuscular recovery. A symmetric result does not prove return-to-play readiness, but an asymmetric result is useful for targeted rehabilitation discussion.

## Dual-Task Cost

Dual-task cost compares Go reaction time during the cognitive Go/No-Go condition with the athlete's baseline reaction time:

```text
Dual-task cost = (dual-task Go RT - baseline RT) / baseline RT x 100
```

Dashboard caution threshold:

- Greater than 20% slowing, or
- More than 50 ms slower than baseline.

Physiological meaning:

Sport movement is rarely a single predictable task. A higher dual-task cost may suggest that decision-making or inhibitory control is consuming cognitive resources and reducing motor responsiveness.

## False Alarm Rate

False alarms occur when the athlete steps during a No-Go stimulus.

```text
False alarm rate = false alarms / No-Go trials x 100
```

Physiological meaning:

False alarms reflect reduced response inhibition. In sport rehabilitation, this matters because athletes must often suppress an initial movement plan when the environment changes unexpectedly.

## Correct Withhold Rate

Correct withholds occur when the athlete does not step during a No-Go stimulus.

```text
Correct withhold rate = correct withholds / No-Go trials x 100
```

Physiological meaning:

A high correct-withhold rate suggests better inhibitory control and attention under uncertain visual cues.

## Fatigue Index

The fatigue index compares late-trial reaction time with early-trial reaction time:

```text
Fatigue index = (late block mean RT - early block mean RT) / early block mean RT x 100
```

Dashboard caution threshold:

- Greater than 20% slowing.

Physiological meaning:

Reaction slowing during repeated trials may indicate fatigue-related decline in neuromuscular control, reduced attention, or poorer movement precision under load.

## FSR Contact Confidence

The ESP32 sends `peak_adc` for each trial. This is not a calibrated force measurement, but it provides contact-confidence information.

Interpretation:

- Higher peak ADC generally means stronger FSR compression.
- Low values near the trigger threshold may indicate a light touch or unstable contact.
- Because FSR sensors are nonlinear and can drift, calibrated force claims should not be made unless a separate load calibration is performed.

## Educational Disclaimer

The Smart Reaction Pad is a course prototype for biomedical engineering learning. It can demonstrate reaction testing, symmetry analysis, cognitive-motor load, and fatigue trends, but it cannot independently determine medical return-to-play clearance. Clinical decisions require qualified professionals and a broader assessment battery.
