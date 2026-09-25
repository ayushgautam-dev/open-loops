import { useEffect, useState } from 'react'
import { Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudRain, CloudDrizzle, Snowflake, CloudLightning } from 'lucide-react'

/* A small weather mark for the greeting — the sky where you are, right now.
   Location is asked for once (the browser's own prompt) and remembered on this device;
   say no and it falls back to sun or moon by the clock. Weather comes from Open-Meteo,
   which needs no key; only rounded coordinates leave the browser. */

type Sky = { icon: typeof Sun; tone: string; label: string }

const day = () => { const h = new Date().getHours(); return h >= 6 && h < 19 }
const byClock = (): Sky => day()
  ? { icon: Sun, tone: 'sun', label: 'Daytime' }
  : { icon: Moon, tone: 'moon', label: 'Night' }

function fromCode(code: number, isDay: boolean): Sky {
  if (code === 0) return isDay ? { icon: Sun, tone: 'sun', label: 'Clear' } : { icon: Moon, tone: 'moon', label: 'Clear night' }
  if (code <= 2) return isDay ? { icon: CloudSun, tone: 'sun', label: 'Partly cloudy' } : { icon: CloudMoon, tone: 'moon', label: 'Partly cloudy' }
  if (code === 3) return { icon: Cloud, tone: 'cloud', label: 'Overcast' }
  if (code === 45 || code === 48) return { icon: CloudFog, tone: 'cloud', label: 'Fog' }
  if (code >= 51 && code <= 57) return { icon: CloudDrizzle, tone: 'rain', label: 'Drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: CloudRain, tone: 'rain', label: 'Rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: Snowflake, tone: 'snow', label: 'Snow' }
  if (code >= 95) return { icon: CloudLightning, tone: 'storm', label: 'Thunderstorm' }
  return byClock()
}

const KEY = 'ol-sky'
function cached(): { sky: { code: number; isDay: boolean }; at: number } | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}

export function WeatherMark() {
  const [sky, setSky] = useState<Sky>(() => {
    const c = cached()
    return c && Date.now() - c.at < 30 * 60000 ? fromCode(c.sky.code, c.sky.isDay) : byClock()
  })

  useEffect(() => {
    const c = cached()
    if (c && Date.now() - c.at < 30 * 60000) return
    if (!('geolocation' in navigator)) return
    let live = true
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude.toFixed(2), lon = pos.coords.longitude.toFixed(2)
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,is_day`)
        const j = await r.json() as { current?: { weather_code?: number; is_day?: number } }
        const code = Number(j.current?.weather_code ?? 0), isDay = j.current?.is_day === 1
        try { localStorage.setItem(KEY, JSON.stringify({ sky: { code, isDay }, at: Date.now() })) } catch { /* fine */ }
        if (live) setSky(fromCode(code, isDay))
      } catch { /* keep the clock-based mark */ }
    }, () => { /* declined — sun or moon by the clock is fine */ }, { maximumAge: 3600000, timeout: 8000 })
    return () => { live = false }
  }, [])

  const Icon = sky.icon
  return <span className={`sky sky-${sky.tone}`} title={sky.label}><Icon size={22} strokeWidth={1.8} /></span>
}
