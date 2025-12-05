import { search, download } from 'aptoide-scraper'
import fetch from 'node-fetch'
import Jimp from 'jimp'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return conn.reply(m.chat, `> ⓘ USO INCORRECTO

> ❌ Debes ingresar el nombre de la aplicación

> 📝 Ejemplos:
> • ${usedPrefix + command} WhatsApp
> • ${usedPrefix + command} TikTok

> 💡 Busca y descarga APKs desde Aptoide`, m)
  }

  try {
    await conn.sendMessage(m.chat, { react: { text: '🕛', key: m.key } })

    let searchA = await search(text)
    if (!searchA.length) {
      await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
      return conn.reply(m.chat, `> ⓘ SIN RESULTADOS

> ❌ No se encontraron aplicaciones para: ${text}

> 💡 Verifica la ortografía o usa otro nombre`, m)
    }

    let data5 = await download(searchA[0].id)

    // Primero enviar solo la imagen/portada del APK
    let txtPortada = `> 🎴 𝐈𝐍𝐅𝐎 𝐃𝐄𝐋 𝐀𝐏𝐊

> 📱 *Nombre:* ${data5.name}
> 📦 *Paquete:* ${data5.package}
> ⭐ *Puntuación:* ${data5.rating || 'N/A'}
> 📅 *Última actualización:* ${data5.lastup}
> 💾 *Tamaño:* ${data5.size}
> 📥 *Descargas:* ${data5.downloads || 'N/A'}
    
> 💡 *La imagen muestra el icono oficial de la aplicación*`

    // Enviar primero la imagen de portada
    await conn.sendFile(m.chat, data5.icon, 'portada-apk.jpg', txtPortada, m)

    // Esperar un momento antes de enviar el APK
    await new Promise(resolve => setTimeout(resolve, 1000))

    if (data5.size.includes('GB') || parseFloat(data5.size.replace(' MB', '')) > 999) {
      await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
      return conn.reply(m.chat, `> ⓘ ARCHIVO DEMASIADO GRANDE

> ❌ El archivo pesa: ${data5.size}

> 💡 Límite máximo: 999 MB
> 💡 Busca una versión más ligera`, m)
    }

    // Preparar miniatura para el documento
    let thumbnail = null
    try {
      const img = await Jimp.read(data5.icon)
      img.resize(300, Jimp.AUTO)
      thumbnail = await img.getBufferAsync(Jimp.MIME_JPEG)
    } catch (err) {
      console.log('Error al crear miniatura:', err)
    }

    // Enviar el documento APK
    await conn.sendMessage(
      m.chat,
      {
        document: { url: data5.dllink },
        mimetype: 'application/vnd.android.package-archive',
        fileName: `${data5.name}.apk`,
        caption: `> ✅ 𝐀𝐏𝐊 𝐃𝐄𝐒𝐂𝐀𝐑𝐆𝐀𝐃𝐀

> 📱 *Aplicación:* ${data5.name}
> 📦 *Paquete:* ${data5.package}
> 🏷️ *Versión:* ${data5.version || 'N/A'}
> 💾 *Tamaño:* ${data5.size}
    
> 🔐 *Recuerda:* 
> • Verificar permisos antes de instalar
> • Descargar solo aplicaciones confiables
> • Escanear con antivirus si es necesario`,
        ...(thumbnail ? { jpegThumbnail: thumbnail } : {})
      },
      { quoted: m }
    )

    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })

  } catch (error) {
    console.error(error)
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
    return conn.reply(m.chat, `> ⓘ ERROR

> ❌ ${error.message || 'Error al procesar la descarga'}

> 💡 Verifica el nombre o intenta más tarde`, m)
  }
}

handler.tags = ['downloader']
handler.help = ['modoapk']
handler.command = ['modapk2', 'apk2']
handler.group = true

export default handler