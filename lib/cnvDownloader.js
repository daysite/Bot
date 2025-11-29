import path from 'node:path'
import { URL, URLSearchParams } from 'node:url'
import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'

const BASE_URL = 'https://v6.www-y2mate.com'
const FRAME_BASE = 'https://frame.y2meta-uk.com'
const CNV_URL = 'https://cnv.cx'
const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
}

const DEFAULT_CONVERSION = {
  format: 'mp3',
  audioBitrate: '320',
  videoQuality: '720',
  filenameStyle: 'pretty',
  vCodec: 'h264'
}

const CLIENT_TIMEOUT = 15000

function createHttpClient(timeout = CLIENT_TIMEOUT) {
  const jar = new CookieJar()
  return wrapper(axios.create({
    jar,
    withCredentials: true,
    timeout,
    headers: { ...DEFAULT_HEADERS },
    validateStatus: status => status >= 200 && status < 400
  }))
}

export function extractVideoId(input) {
  if (!input) return null
  let url
  try {
    url = new URL(input)
  } catch {
    return input
  }

  if (url.hostname.includes('youtu.be')) {
    return url.pathname.replace('/', '').split('/')[0]
  }

  if (url.hostname.includes('youtube.com')) {
    return url.searchParams.get('v')
  }

  return input
}

async function warmup(client) {
  await client.get(BASE_URL, {
    headers: {
      ...DEFAULT_HEADERS,
      referer: 'https://www.google.com/'
    }
  })
}

async function submitSearch(client, targetUrl) {
  const body = new URLSearchParams({ q: targetUrl, form_submit: '' })
  await client.post(`${BASE_URL}/search/`, body.toString(), {
    headers: {
      ...DEFAULT_HEADERS,
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
    }
  })
}

async function triggerConvert(client, videoId) {
  const body = new URLSearchParams({ videoId })
  await client.post(`${BASE_URL}/convert/`, body.toString(), {
    headers: {
      ...DEFAULT_HEADERS,
      origin: BASE_URL,
      referer: `${BASE_URL}/search/`,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
    }
  })
}

async function fetchSanityKey(client, videoId) {
  const frameReferer = `${FRAME_BASE}/wwwindex.php?videoId=${videoId}`
  const { data } = await client.get(`${CNV_URL}/v2/sanity/key`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      origin: FRAME_BASE,
      referer: frameReferer,
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    }
  })

  if (!data?.key) {
    throw new Error('No se pudo obtener el sanity key de cnv.cx')
  }

  return data.key
}

async function requestDownloadLink(client, { sanityKey, videoUrl, videoId, format, audioBitrate, videoQuality, filenameStyle, vCodec }) {
  const frameReferer = `${FRAME_BASE}/wwwindex.php?videoId=${videoId}`
  const body = new URLSearchParams({
    link: videoUrl,
    format,
    audioBitrate,
    videoQuality,
    filenameStyle,
    vCodec
  })

  const { data } = await client.post(`${CNV_URL}/v2/converter`, body.toString(), {
    headers: {
      accept: '*/*',
      origin: FRAME_BASE,
      referer: frameReferer,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      key: sanityKey
    }
  })

  if (!data?.url) {
    throw new Error(`Respuesta inesperada del convertidor: ${JSON.stringify(data)}`)
  }

  return data
}

function filenameFromHeaders(headers, fallbackUrl, requestedName) {
  if (requestedName) return requestedName
  const disposition = headers['content-disposition']
  if (disposition) {
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/)
    if (utf8Match) {
      return decodeURIComponent(utf8Match[1])
    }
    const asciiMatch = disposition.match(/filename="?([^";]+)"?/)
    if (asciiMatch) {
      return asciiMatch[1]
    }
  }
  try {
    const urlObj = new URL(fallbackUrl)
    const base = path.basename(urlObj.pathname)
    if (base) return base
  } catch {}
  return 'download.bin'
}

async function downloadBinary(downloadUrl, requestedName, requestedFormat) {
  const response = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    headers: {
      ...DEFAULT_HEADERS,
      accept: 'audio/mpeg,video/*;q=0.9,*/*;q=0.8',
      referer: `${FRAME_BASE}/`,
      origin: FRAME_BASE
    },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: status => status >= 200 && status < 400
  })

  const buffer = Buffer.from(response.data)
  const size = Number(response.headers['content-length']) || buffer.length
  const fileName = filenameFromHeaders(response.headers, downloadUrl, requestedName)
  let mime = response.headers['content-type'] || 'application/octet-stream'

  const guessedMime = guessMimeFromFile(fileName, requestedFormat)
  if (!mime || mime === 'application/octet-stream') {
    mime = guessedMime || 'application/octet-stream'
  }
  if (!mime && guessedMime) mime = guessedMime

  return { buffer, mime, size, fileName }
}

export async function convertAndDownload(videoUrl, options = {}) {
  const merged = { ...DEFAULT_CONVERSION, ...options }
  merged.videoUrl = videoUrl || merged.videoUrl
  if (!merged.videoUrl) {
    throw new Error('Debes proporcionar un enlace o ID de video de YouTube')
  }
  const videoId = extractVideoId(merged.videoUrl)
  if (!videoId) {
    throw new Error('No se pudo extraer el videoId. Verifica la URL proporcionada.')
  }

  const client = createHttpClient(options.timeout || CLIENT_TIMEOUT)
  await warmup(client)
  await submitSearch(client, merged.videoUrl)
  await triggerConvert(client, videoId)
  const sanityKey = await fetchSanityKey(client, videoId)
  const conversion = await requestDownloadLink(client, {
    sanityKey,
    videoUrl: merged.videoUrl,
    videoId,
    format: merged.format,
    audioBitrate: merged.audioBitrate,
    videoQuality: merged.videoQuality,
    filenameStyle: merged.filenameStyle,
    vCodec: merged.vCodec
  })

  if (merged.linkOnly) {
    return { videoId, sanityKey, ...conversion }
  }

  const download = await downloadBinary(
    conversion.url,
    merged.outputName ?? conversion.filename,
    merged.format
  )
  return { videoId, sanityKey, ...conversion, ...download }
}

function guessMimeFromFile(fileName = '', requestedFormat = '') {
  const ext = path.extname(fileName).toLowerCase().replace('.', '')
  const format = (requestedFormat || '').toLowerCase()
  const candidate = ext || format
  const map = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    '3gp': 'video/3gpp'
  }
  return map[candidate] || null
}
