import { upscaleWithIloveimg, VALID_SCALES } from '../lib/iloveimgUpscale.js'

function parseScale(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token) continue
    const direct = token.match(/^([248])(?:x)?$/i)
    if (direct) return Number(direct[1])
    const flag = token.match(/^--?(?:scale|x)(?:=(\d+))?$/i)
    if (flag) {
      if (flag[1]) return Number(flag[1])
      const next = args[i + 1]
      if (next && /^\d+$/.test(next)) return Number(next)
    }
  }
  return 2
}

function pickFileName(mime, scale) {
  if (/png/i.test(mime)) return `iloveimg_x${scale}.png`
  return `iloveimg_x${scale}.jpg`
}

const handler = async (m, { conn, args, usedPrefix, command }) => {
  try {
    let q = m.quoted || m
    let mime = (q.msg || q).mimetype || q.mediaType || ''
    
    // Verificar si hay una imagen citada
    if (!mime || !/image\/(jpe?g|png)/i.test(mime)) {
      const quotedContext = m.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const quotedImage = quotedContext?.imageMessage
      if (quotedImage) {
        q = {
          message: { imageMessage: quotedImage },
          download: async () => conn.downloadMediaMessage({ key: {}, message: { imageMessage: quotedImage } })
        }
        mime = quotedImage.mimetype || 'image/jpeg'
      }
    }

    // Si aún no hay imagen, mostrar ayuda
    if (!mime || !/image\/(jpe?g|png)/i.test(mime)) {
      return conn.reply(m.chat, `> ⓘ *Uso correcto:*\n> ⓘ ${usedPrefix}${command} [2|4|8]\n> ⓘ Responde a una imagen JPG/PNG o envíala con el comando`, m)
    }

    // Descargar la imagen
    let buffer
    try {
      buffer = await q.download?.()
    } catch (_) {
      buffer = null
    }
    
    if (!buffer) {
      try {
        buffer = await conn.downloadMediaMessage(q)
      } catch (err) {
        return conn.reply(m.chat, '> ⓘ Error al descargar la imagen', m)
      }
    }

    if (!buffer) {
      return conn.reply(m.chat, '> ⓘ No se pudo obtener la imagen', m)
    }

    // Verificar tamaño de la imagen
    if (buffer.length > 10 * 1024 * 1024) { // 10MB
      return conn.reply(m.chat, '> ⓘ La imagen es demasiado grande (máximo 10MB)', m)
    }

    // Obtener escala
    let scale = parseScale(args)
    if (!VALID_SCALES.has(scale)) {
      return conn.reply(m.chat, '> ⓘ Escala inválida. Usa: 2, 4 u 8', m)
    }

    await m.react('🕒')

    // Procesar con IloveIMG
    try {
      const result = await upscaleWithIloveimg({
        buffer,
        fileName: pickFileName(mime, scale),
        mimeType: /png/i.test(mime) ? 'image/png' : 'image/jpeg',
        scale,
        verbose: false
      })

      // Enviar imagen mejorada
      await conn.sendMessage(
        m.chat,
        {
          image: result.buffer,
          mimetype: result.contentType,
          fileName: result.fileName
        },
        { quoted: m }
      )
      
      await m.react('✅')
      
    } catch (error) {
      await m.react('❌')
      
      let errorMessage = '> ⓘ Error al procesar la imagen'
      
      if (error.message?.includes('timeout')) {
        errorMessage = '> ⓘ Tiempo de espera agotado. Intenta nuevamente.'
      } else if (error.message?.includes('token') || error.message?.includes('taskId')) {
        errorMessage = '> ⓘ Error del servicio. Intenta más tarde.'
      } else if (error.message?.includes('tamaño') || error.message?.includes('size')) {
        errorMessage = '> ⓘ La imagen es demasiado grande para procesar.'
      }
      
      return conn.reply(m.chat, errorMessage, m)
    }

  } catch (error) {
    await m.react('❌')
    return conn.reply(m.chat, '> ⓘ Error inesperado al ejecutar el comando', m)
  }
}

handler.help = ['hd <2|4|8>']
handler.tags = ['tools']
handler.command = /^(hd|upscale|enhance|iloveimg)$/i

export default handler