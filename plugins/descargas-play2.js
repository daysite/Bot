import yts from 'yt-search'    
import fetch from 'node-fetch'    

async function apiAdonix(url) {    
  const apiURL = `https://api-adonix.ultraplus.click/download/ytmp4?apikey=${global.apikey}&url=${encodeURIComponent(url)}`    
  const res = await fetch(apiURL)    
  const data = await res.json()    

  if (!data.status || !data.data?.url) throw new Error('API Adonix no devolvió datos válidos')    
  return { url: data.data.url, title: data.data.title || 'Video sin título XD', fuente: 'Adonix' }    
}    

async function apiMayAPI(url) {
  const apiURL = `https://mayapi.ooguy.com/ytdl?url=${encodeURIComponent(url)}&type=mp4&apikey=${global.APIKeys['https://mayapi.ooguy.com']}`
  const res = await fetch(apiURL)
  const data = await res.json()

  if (!data.status || !data.result?.url) throw new Error('API MayAPI no devolvió datos válidos')
  return { url: data.result.url, title: data.result.title || 'Video sin título XD', fuente: 'MayAPI' }
}

async function ytdl(url) {    
  try {    
    console.log('🎬 Intentando con API Adonix...')    
    return await apiAdonix(url)    
  } catch (e1) {    
    console.warn('⚠️ Falló Adonix:', e1.message)    
    console.log('🎞️ Intentando con API MayAPI de respaldo...')    
    return await apiMayAPI(url)    
  }    
}    

let handler = async (m, { conn, text, usedPrefix }) => {    
  if (!text) {    
    return conn.reply(m.chat, 
`> 🎄 *¡NAVIDAD EN YOUTUBE!* 🎅

> 🎵 *DESCARGADOR DE VIDEOS DESDE YOUTUBE-PLAYS*

> ❌ *Uso incorrecto*

> \`\`\`Debes proporcionar el nombre del video\`\`\`

> *Ejemplos navideños:*
> • ${usedPrefix}play2 villancicos navideños
> • ${usedPrefix}play2 canciones de navidad
> • ${usedPrefix}play2 películas navideñas

> 🎅 *¡Itsuki Nakano V3 descargará tu video!* 🎄`, m)    
  }    

  try {    
    await m.react('🎁')
    await m.react('🕑')

    const searchResults = await yts(text)    
    if (!searchResults.videos.length) throw new Error('No se encontraron resultados')    

    const video = searchResults.videos[0]    
    const { url, title, fuente } = await ytdl(video.url)    

    const caption = `> 🎄 *¡VIDEO DESCARGADO!* 🎅

> 📹 *Información del Video*

> 🏷️ *Título:* ${title}
> ⏱️ *Duración:* ${video.timestamp}
> 👤 *Autor:* ${video.author.name}
> 🎬 *Formato:* MP4
> 🎁 *Calidad:* Alta
> 🌐 *Servidor:* ${fuente}

> 🎅 *¡Disfruta tu contenido navideño!*
> 🎄 *¡Feliz Navidad con Itsuki Nakano V3!* 🎁`

    const buffer = await fetch(url).then(res => res.buffer())    

    await conn.sendMessage(    
      m.chat,    
      {    
        video: buffer,    
        mimetype: 'video/mp4',    
        fileName: `${title}_navidad.mp4`,    
        caption    
      },    
      { quoted: m }    
    )    

    await m.react('✅')

  } catch (e) {    
    console.error('🎄 Error en play2:', e)    
    await conn.reply(m.chat, 
`> 🎄 *¡ERROR EN DESCARGA!* 🎅

> ❌ *Error al descargar video*

> 📝 *Detalles:* ${e.message}

> 🔍 *Posibles soluciones:*
> • Verifica el nombre del video
> • Intenta con otro término de búsqueda
> • El video podría no estar disponible

> 🎅 *Itsuki V3 lo intentará de nuevo...*
> 🎄 *¡No te rindas!* 🎁`, m)    
    await m.react('❌')
  }    
}    

handler.help = ['play2']    
handler.tags = ['downloader']    
handler.command = ['play2']
handler.group = true    
// handler.register = false

export default handler