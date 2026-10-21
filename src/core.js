/* Heartfall: original beat analysis and deterministic animation helpers. */
(function (global) {
  'use strict';
  function analyzePCM(samples, sampleRate) {
    const hop = Math.max(1, Math.round(sampleRate * 0.01));
    const count = Math.ceil(samples.length / hop);
    const energy = new Float32Array(count);
    const flux = new Float32Array(count);
    const waveform = new Float32Array(320);
    let bass = 0, prevBass = 0, prevFull = 0, peak = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
    for (let f = 0; f < count; f++) {
      let low = 0, full = 0;
      const end = Math.min(samples.length, (f + 1) * hop);
      for (let j = f * hop; j < end; j++) {
        const x = samples[j]; bass += alpha * (x - bass);
        low += bass * bass; full += x * x;
        const w = Math.min(319, Math.floor(j / samples.length * 320));
        waveform[w] = Math.max(waveform[w], Math.abs(x));
      }
      low = Math.sqrt(low / hop); full = Math.sqrt(full / hop);
      energy[f] = full; peak = Math.max(peak, full);
      flux[f] = Math.max(0, low - prevBass) * 0.75 + Math.max(0, full - prevFull) * 0.25;
      prevBass = low; prevFull = full;
    }
    if (peak < 0.0001) return { candidates: [], energy, waveform, bpm: 0, step: hop / sampleRate };
    const candidates = [];
    for (let i = 2; i < count - 2; i++) {
      if (flux[i] < flux[i - 1] || flux[i] <= flux[i + 1] || energy[i] < peak * 0.025) continue;
      let sum = 0, sum2 = 0, n = 0;
      for (let j = Math.max(0, i - 35); j <= Math.min(count - 1, i + 35); j++) {
        sum += flux[j]; sum2 += flux[j] * flux[j]; n++;
      }
      const mean = sum / n, dev = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      const score = (flux[i] - mean) / (dev + peak * 0.002);
      if (score > 0.45 && flux[i] > peak * 0.004) {
        const onset = { time: Math.max(0, (i * hop) / sampleRate), score, strength: Math.min(1, energy[i] / peak) };
        const previous = candidates[candidates.length - 1];
        if (previous && onset.time - previous.time < 0.115) {
          if (onset.score > previous.score) candidates[candidates.length - 1] = onset;
        } else candidates.push(onset);
      }
    }
    // Onset autocorrelation: estimate tempo from repeated intervals, not volume.
    const histogram = new Float64Array(201);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < Math.min(candidates.length, i + 9); j++) {
        const delta = candidates[j].time - candidates[i].time;
        if (delta > 3) break;
        let bpm = 60 / delta;
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
        const bin = Math.round(bpm);
        histogram[bin] += Math.min(candidates[i].score, candidates[j].score) / Math.sqrt(j - i);
      }
    }
    let tempo = 0, best = 0;
    for (let b = 70; b <= 180; b++) {
      const score = histogram[b] + 0.5 * (histogram[b - 1] + histogram[b + 1]);
      if (score > best) { best = score; tempo = b; }
    }
    for (let i = 0; i < energy.length; i++) energy[i] /= peak;
    return { candidates, energy, waveform, bpm: tempo, step: hop / sampleRate };
  }
  function makeBeats(analysis, duration, settings) {
    let beats = [];
    if (settings.mode === 'grid') {
      const interval = 60 / Math.max(40, Math.min(240, Number(settings.bpm) || 120));
      const anchor = analysis.candidates.find(x => x.score > 1.5)?.time || 0;
      for (let t = anchor; t < duration; t += interval) beats.push({time: t, strength: 0.8});
    } else {
      const threshold = { sparse: 2.3, normal: 1.4, dense: 0.65 }[settings.density] || 1.4;
      const gap = { sparse: 0.32, normal: 0.21, dense: 0.13 }[settings.density] || 0.21;
      for (const onset of analysis.candidates) {
        if (onset.score < threshold) continue;
        const last = beats[beats.length - 1];
        if (!last || onset.time - last.time >= gap) beats.push({...onset});
        else if (onset.score > last.score) beats[beats.length - 1] = {...onset};
      }
    }
    const shift = (Number(settings.offset) || 0) / 1000;
    return beats.map(b => ({...b, time: b.time + shift})).filter(b => b.time >= 0 && b.time < duration);
  }
  function lowerBound(arr, t) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid].time < t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function random(seed) { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123; return n - Math.floor(n); }
  const api = { analyzePCM, makeBeats, lowerBound, random };
  if (typeof module !== 'undefined') module.exports = api;
  global.HeartfallCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
