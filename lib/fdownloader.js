import axios from 'axios'
import { load as loadHtml } from 'cheerio'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BASE_PAGE = 'https://fdownloader.net/es'
const VERIFY_ENDPOINT = 'https://fdownloader.net/api/userverify'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchConfigFromPage = async () => {
  const response = await axios.get(BASE_PAGE, {
    headers: {
      'User-Agent': USER_AGENT
    }
  })

  const $ = loadHtml(response.data)
  const scripts = []

  $('script').each((_, script) => {
    const content = $(script).html()
    if (content && content.includes('var k_url_search')) {
      scripts.push(content)
    }
  })

  const blob = scripts.join('\n')

  const extract = (name) => {
    const pattern = new RegExp(`${name}\\s*=\\s*"([^"]+)"`)
    const match = blob.match(pattern)
    return match ? match[1] : ''
  }

  return {
    k_exp: extract('k_exp'),
    k_token: extract('k_token'),
    k_url_search: extract('k_url_search'),
    k_url_convert: extract('k_url_convert'),
    k_lang: extract('k_lang') || 'es',
    c_token: extract('c_token'),
    k_prefix_name: extract('k_prefix_name')
  }
}

const getCFTurnstileToken = async (targetUrl) => {
  const params = new URLSearchParams({ url: targetUrl })
  const { data } = await axios.post(VERIFY_ENDPOINT, params.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://fdownloader.net',
      Referer: BASE_PAGE
    }
  })

  if (!data?.success || !data.token) {
    throw new Error('No se pudo obtener el token de verificación.')
  }
  return data.token
}

const postAjaxSearch = async (config, targetUrl, cftoken) => {
  const payload = new URLSearchParams({
    k_exp: config.k_exp,
    k_token: config.k_token,
    q: targetUrl,
    html: '',
    lang: config.k_lang,
    web: 'fdownloader.net',
    v: 'v2',
    w: '',
    cftoken
  })

  const { data } = await axios.post(config.k_url_search, payload.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://fdownloader.net',
      Referer: BASE_PAGE
    }
  })

  if (data?.status !== 'ok') {
    throw new Error(`Respuesta inesperada del API: ${JSON.stringify(data)}`)
  }

  return data
}

const parseRows = (html) => {
  const $ = loadHtml(html)
  const rows = []

  $('.table tbody tr').each((_, tr) => {
    const row = $(tr)
    const quality = row.find('.video-quality').text().trim()
    const cells = row.find('td')
    const actionCell = cells.eq(2)
    const link = actionCell.find('a')

    if (link.length) {
      rows.push({
        quality,
        requiresRender: false,
        label: link.text().trim(),
        url: link.attr('href')
      })
      return
    }

    const button = actionCell.find('button')
    if (button.length) {
      rows.push({
        quality,
        requiresRender: true,
        label: button.text().trim(),
        videourl: button.data('videourl'),
        videocodec: button.data('videocodec'),
        videotype: button.data('videotype'),
        fquality: button.data('fquality')
      })
    }
  })

  return rows
}

export const getFacebookDownloadInfo = async (targetUrl) => {
  if (!targetUrl.startsWith('http')) {
    throw new Error('Proporciona un enlace válido de Facebook.')
  }

  // Recopila la configuración dinámica y token anti-bot antes de consultar las calidades.
  const config = await fetchConfigFromPage()
  const cftoken = await getCFTurnstileToken(targetUrl)

  await delay(500)

  const searchResponse = await postAjaxSearch(config, targetUrl, cftoken)
  const formats = parseRows(searchResponse.data || '')

  return {
    target: targetUrl,
    config,
    cftoken,
    formats
  }
}

export default getFacebookDownloadInfo
