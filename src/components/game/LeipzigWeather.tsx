"use client";

import { useEffect, useState } from "react";
import { RainRadar } from "./RainRadar";

/**
 * Wetterbericht für Leipzig neben der Haustür: jetzt, die nächsten Stunden (mit Regenwahrscheinlichkeit),
 * die nächsten Tage – und ein Vorschlag, was man anziehen sollte. Daten von Open-Meteo (kostenlos, ohne Schlüssel).
 */

const LAT = 51.34, LON = 12.37;
const URL_ = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
  + "&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day"
  + "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index"
  + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset"
  + "&timezone=Europe%2FBerlin&forecast_days=4";

export type Weather = {
  current: { time: string; temperature_2m: number; apparent_temperature: number; precipitation: number; weather_code: number; wind_speed_10m: number; is_day: number };
  hourly: {
    time: string[]; temperature_2m: number[]; apparent_temperature: number[]; precipitation_probability: number[]; precipitation: number[];
    weather_code: number[]; wind_speed_10m: number[]; wind_gusts_10m: number[]; uv_index: number[];
  };
  daily: {
    time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[];
    precipitation_probability_max: number[]; precipitation_sum: number[]; sunrise: string[]; sunset: string[];
  };
};

/** Wetter-Code (WMO) → Symbol und Text */
export function describe(code: number, day = true): { icon: string; text: string } {
  if (code === 0) return day ? { icon: "☀️", text: "Sonnig" } : { icon: "🌙", text: "Klar" };
  if (code === 1) return { icon: day ? "🌤️" : "🌙", text: "Überwiegend klar" };
  if (code === 2) return { icon: "⛅", text: "Teils bewölkt" };
  if (code === 3) return { icon: "☁️", text: "Bedeckt" };
  if (code === 45 || code === 48) return { icon: "🌫️", text: "Nebel" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", text: "Nieselregen" };
  if (code >= 61 && code <= 65) return { icon: "🌧️", text: code === 65 ? "Starker Regen" : "Regen" };
  if (code === 66 || code === 67) return { icon: "🧊", text: "Gefrierender Regen" };
  if (code >= 71 && code <= 77) return { icon: "🌨️", text: "Schnee" };
  if (code >= 80 && code <= 82) return { icon: "🌦️", text: "Regenschauer" };
  if (code === 85 || code === 86) return { icon: "🌨️", text: "Schneeschauer" };
  if (code >= 95) return { icon: "⛈️", text: "Gewitter" };
  return { icon: "🌡️", text: "" };
}
const isSnow = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;

/** Die nächsten Stunden ab jetzt (Index in hourly) */
function upcoming(w: Weather, hours: number) {
  const now = w.current.time.slice(0, 13); // "2026-11-12T14"
  const from = Math.max(0, w.hourly.time.findIndex((t) => t.slice(0, 13) >= now));
  return Array.from({ length: hours }, (_, i) => from + i).filter((i) => i < w.hourly.time.length);
}

/** Was sollte man anziehen? Betrachtet die nächsten 12 Stunden (gefühlte Temperatur, Regen, Wind, Sonne). */
export function outfit(w: Weather): { main: string; extras: string[] } {
  const idx = upcoming(w, 12);
  const pick = <T,>(arr: T[]) => idx.map((i) => arr[i]);
  const feels = pick(w.hourly.apparent_temperature);
  const minF = Math.min(w.current.apparent_temperature, ...feels), maxF = Math.max(w.current.apparent_temperature, ...feels);
  const rain = Math.max(0, ...pick(w.hourly.precipitation_probability));
  const gusts = Math.max(0, ...pick(w.hourly.wind_gusts_10m));
  const uv = Math.max(0, ...pick(w.hourly.uv_index));
  const codes = [w.current.weather_code, ...pick(w.hourly.weather_code)];
  const minT = Math.min(...pick(w.hourly.temperature_2m), w.current.temperature_2m);
  const mid = (minF + maxF) / 2;

  const main =
    mid <= -5 ? "🧥🧣🧤 Dicke Winterjacke, Mütze, Schal und Handschuhe – richtig kalt!"
    : mid <= 3 ? "🧥🧣 Winterjacke, Mütze und Handschuhe"
    : mid <= 9 ? "🧥 Warme Jacke und ein Pulli drunter"
    : mid <= 14 ? "🧶 Pulli und Übergangsjacke"
    : mid <= 19 ? "👕 Langarmshirt oder Hoodie, leichte Jacke dabei"
    : mid <= 25 ? "👕 T-Shirt reicht"
    : "🩳 Kurze Hose und T-Shirt – Wasser mitnehmen!";

  const extras: string[] = [];
  if (codes.some((c) => c >= 95)) extras.push("⚡ Gewitter möglich – lieber drinnen bleiben, wenn's losgeht");
  if (codes.some(isSnow)) extras.push("👢 Schnee – wasserfeste Schuhe anziehen");
  if (rain >= 60) extras.push(gusts >= 45 ? "🧥 Regenjacke mit Kapuze – bei dem Wind bringt ein Schirm wenig" : "☔ Regenjacke oder Schirm – es wird sehr wahrscheinlich nass");
  else if (rain >= 30) extras.push("🌂 Schirm einpacken – sicher ist sicher");
  if (gusts >= 55) extras.push("💨 Stürmische Böen – Fahrrad lieber stehen lassen");
  else if (gusts >= 40) extras.push("💨 Windig – etwas Winddichtes anziehen");
  if (minT <= 0) extras.push("🧊 Frost – Glätte möglich, mit dem Rad vorsichtig");
  if (maxF - minF >= 8 && mid > 3) extras.push("🔄 Großer Temperatur-Unterschied – Zwiebellook");
  if (uv >= 6) extras.push("🧴 Starke Sonne – Sonnencreme und Sonnenbrille");
  else if (uv >= 4 && rain < 30) extras.push("😎 Sonnenbrille lohnt sich");
  return { main, extras };
}

const hourLabel = (iso: string) => iso.slice(11, 13);
const dayName = (iso: string, i: number) => i === 0 ? "Heute" : i === 1 ? "Morgen" : new Date(iso + "T12:00").toLocaleDateString("de-DE", { weekday: "short" });
const isDayAt = (w: Weather, iso: string) => {
  const d = w.daily.time.indexOf(iso.slice(0, 10));
  return d < 0 || (iso >= w.daily.sunrise[d] && iso < w.daily.sunset[d]);
};
const rainColor = (p: number) => p >= 60 ? "text-sky-600 dark:text-sky-400 font-semibold" : p >= 30 ? "text-sky-600/80 dark:text-sky-400/80" : "text-muted";

export function LeipzigWeather() {
  const [w, setW] = useState<Weather | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stop = false;
    setErr(false);
    fetch(URL_).then((r) => (r.ok ? r.json() : Promise.reject())).then((d: Weather) => { if (!stop) setW(d); }).catch(() => { if (!stop) setErr(true); });
    return () => { stop = true; };
  }, [tick]);

  if (err && !w) return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-muted">Das Wetter konnte gerade nicht geladen werden.</p>
      <button onClick={() => setTick((t) => t + 1)} className="rounded-xl border border-line px-4 py-2 text-sm font-medium">Nochmal versuchen</button>
    </div>
  );
  if (!w) return <p className="py-8 text-center text-sm text-muted">Schaue aus dem Fenster … 🌦️</p>;

  const c = w.current, now = describe(c.weather_code, c.is_day === 1);
  const hours = upcoming(w, 12);
  const rainToday = w.daily.precipitation_probability_max[0] ?? 0;
  const rainNext = Math.max(0, ...hours.map((i) => w.hourly.precipitation_probability[i]));
  const fit = outfit(w);

  return (
    <div className="space-y-4">
      {/* Jetzt */}
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-sky-400/20 to-indigo-400/10 p-4">
        <span className="text-6xl leading-none">{now.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-muted">Leipzig · jetzt</p>
          <p className="text-4xl font-bold tabular-nums">{Math.round(c.temperature_2m)}°</p>
          <p className="text-sm">{now.text} · gefühlt {Math.round(c.apparent_temperature)}°</p>
        </div>
        <div className="text-right text-sm">
          <p className={rainColor(rainNext)}>☔ {rainNext} %</p>
          <p className="text-xs text-muted">Regen in den nächsten 12 h</p>
          <p className="mt-1 text-xs text-muted">💨 {Math.round(c.wind_speed_10m)} km/h</p>
        </div>
      </div>

      {/* Was anziehen? */}
      <div className="rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Was ziehe ich an?</p>
        <p className="mt-1 font-semibold">{fit.main}</p>
        {fit.extras.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {fit.extras.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}
      </div>

      {/* Nächste Stunden */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Die nächsten Stunden</p>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {hours.map((i) => {
            const t = w.hourly.time[i], d = describe(w.hourly.weather_code[i], isDayAt(w, t)), p = w.hourly.precipitation_probability[i];
            return (
              <div key={t} className="flex w-12 shrink-0 flex-col items-center gap-0.5 rounded-xl bg-card py-2 text-xs ring-1 ring-line">
                <span className="text-muted">{hourLabel(t)} Uhr</span>
                <span className="text-xl" title={d.text}>{d.icon}</span>
                <span className="font-semibold tabular-nums">{Math.round(w.hourly.temperature_2m[i])}°</span>
                <span className={`tabular-nums ${rainColor(p)}`}>☔{p}%</span>
              </div>
            );
          })}
        </div>
      </div>

      <RainRadar />

      {/* Nächste Tage */}
      <div className="divide-y divide-line rounded-2xl border border-line bg-card">
        {w.daily.time.map((day, k) => {
          const d = describe(w.daily.weather_code[k]), p = w.daily.precipitation_probability_max[k], mm = w.daily.precipitation_sum[k];
          return (
            <div key={day} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-16 font-medium">{dayName(day, k)}</span>
              <span className="text-xl" title={d.text}>{d.icon}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{d.text}</span>
              <span className={`w-20 text-right tabular-nums ${rainColor(p)}`}>☔ {p} %{mm >= 0.5 ? <span className="block text-[10px] text-muted">{mm.toFixed(mm < 10 ? 1 : 0)} mm</span> : null}</span>
              <span className="w-16 text-right tabular-nums"><b>{Math.round(w.daily.temperature_2m_max[k])}°</b> <span className="text-muted">{Math.round(w.daily.temperature_2m_min[k])}°</span></span>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[11px] text-muted">
        Heute insgesamt {rainToday} % Regenrisiko · Sonne {w.daily.sunrise[0]?.slice(11, 16)}–{w.daily.sunset[0]?.slice(11, 16)} Uhr · Daten: Open-Meteo
      </p>
    </div>
  );
}
