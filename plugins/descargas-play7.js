import ytSearch from 'yt-search'
import fetch from 'node-fetch'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const execAsync = promisify(exec)

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) return conn.reply(m.chat, `> ⓘ \`Uso:\` *${usedPrefix + command} nombre del video*`, m)

  try {
    await m.react('🕒')

    const search = await ytSearch(text)
    if (!search.videos.length) {
      await m.react('❌')
      return conn.reply(m.chat, '> ⓘ \`No se encontró ningún video\`', m)
    }

    const video = search.videos[0]

    const info = `> ⓘ \`Título:\` *${video.title}*\n> ⓘ \`Autor:\` *${video.author.name}*\n> ⓘ \`Duración:\` *${video.timestamp}*\n> ⓘ \`Vistas:\` *${video.views.toLocaleString()}*`

    await conn.sendMessage(m.chat, {
      image: { url: video.thumbnail },
      caption: info
    }, { quoted: m })

// play11 fixeado por ZzawX

    if (command === 'play11') {
      try {
        const result = await fetch(`https://fgsi.dpdns.org/api/downloader/youtube/v2?apikey=fgsiapi-335898e9-6d&url=${video.url}&type=mp4`).then(r => r.json())
        if (!result?.data?.url) throw new Error('API sin resultado válido')

        const tempInput = join(tmpdir(), `${Date.now()}_input.mp4`)
        const tempOutput = join(tmpdir(), `${Date.now()}_output.mp4`)

        const videoResponse = await fetch(result.data.url)
        const videoBuffer = await videoResponse.buffer()
        writeFileSync(tempInput, videoBuffer)

        await execAsync(`ffmpeg -i "${tempInput}" -c:v libx264 -preset fast -crf 28 -c:a aac -b:a 128k -movflags +faststart "${tempOutput}"`)

        const convertedBuffer = readFileSync(tempOutput)
        
        await conn.sendMessage(m.chat, {
          video: convertedBuffer,
          caption: `> ⓘ \`Video:\` *${video.title}*`,
          fileName: `${video.title}.mp4`,
          mimetype: 'video/mp4'
        }, { quoted: m })

        unlinkSync(tempInput)
        unlinkSync(tempOutput)

        await m.react('✅')
      } catch (err) {
        await m.react('❌')
        try {
          const altResult = await fetch(`https://api.nekolabs.fun/api/ytdl?url=${video.url}`).then(r => r.json())
          if (altResult?.videoUrl) {
            const tempInput = join(tmpdir(), `${Date.now()}_input2.mp4`)
            const tempOutput = join(tmpdir(), `${Date.now()}_output2.mp4`)

            const videoResponse = await fetch(altResult.videoUrl)
            const videoBuffer = await videoResponse.buffer()
            writeFileSync(tempInput, videoBuffer)

            await execAsync(`ffmpeg -i "${tempInput}" -c:v libx264 -preset fast -crf 28 -c:a aac -b:a 128k -movflags +faststart "${tempOutput}"`)

            const convertedBuffer = readFileSync(tempOutput)
            
            await conn.sendMessage(m.chat, {
              video: convertedBuffer,
              caption: `> ⓘ \`Video:\` *${video.title}*`,
              fileName: `${video.title}.mp4`,
              mimetype: 'video/mp4'
            }, { quoted: m })

            unlinkSync(tempInput)
            unlinkSync(tempOutput)
            
            await m.react('✅')
          } else {
            throw new Error('APIs fallaron')
          }
        } catch (e) {
          conn.reply(m.chat, '> ⓘ \`Error al procesar el video. Verifica que ffmpeg esté instalado.\`', m)
        }
      }
    } else {
      try {
        const apiURL = `https://api.nekolabs.web.id/downloader/youtube/v1?url=${video.url}&format=mp3`
        const result = await fetch(apiURL).then(r => r.json())

        let audioUrl
        if (result?.result?.downloadUrl) {
          audioUrl = result.result.downloadUrl
        } else {
          const fallback = await fetch(`https://fgsi.dpdns.org/api/downloader/youtube/v2?apikey=fgsiapi-335898e9-6d&url=${video.url}&type=mp3`).then(r => r.json())
          if (!fallback?.data?.url) throw new Error('No hay URL válida')
          audioUrl = fallback.data.url
        }

        const audioBuffer = await fetch(audioUrl).then(res => res.buffer())

        await conn.sendMessage(m.chat, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: `${video.title}.mp3`,
          ptt: false
        }, { quoted: m })

        await m.react('✅')
      } catch (err) {
        await m.react('❌')
        conn.reply(m.chat, '> ⓘ \`Error al descargar el audio\`', m)
      }
    }

  } catch (error) {
    await m.react('❌')
    conn.reply(m.chat, `> ⓘ \`Error:\` *${error.message}*`, m)
  }
}

handler.help = ['play10', 'play11']
handler.tags = ['downloader']
handler.command = ['play10', 'play11']

export default handler