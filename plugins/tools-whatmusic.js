import fs from 'fs'
import acrcloud from 'acrcloud'

let handler = async (m, { usedPrefix, command, conn, text }) => {

    // Configuración del token
    let acr = new acrcloud({
        host: 'identify-eu-west-1.acrcloud.com',
        access_key: 'c33c767d683f78bd17d4bd4991955d81',
        access_secret: 'bvgaIAEtADBTbLwiPGYlxupWqkNGIjT7J9Ag2vIu'
    })

    let mimes = (m.quoted ? m.quoted : m.msg).mimetype || ''

    if (/audio|video/.test(mimes)) {

        let q = m.quoted ? m.quoted : m
        let mime = (m.quoted ? m.quoted : m.msg).mimetype || ''

        m.reply(wait)

        let media = await q.download()
        let ext = mime.split('/')[1]

        fs.writeFileSync(`./tmp/${m.sender}.${ext}`, media)

        let res = await acr.identify(
            fs.readFileSync(`./tmp/${m.sender}.${ext}`)
        )

        let { code, msg } = res.status
        if (code !== 0) return m.reply('> ❌ No se encontró ninguna canción.')

        let { title, artists, album, genres, release_date } = res.metadata.music[0]

        let txt = `*🎵 IDENTIFICADOR DE MÚSICA 🎵*

> 🎶 *Título:* ${title}
> 👨‍🎤 *Artista(s):* ${artists ? artists.map(v => v.name).join(', ') : 'Desconocido'}
> 💿 *Álbum:* ${album?.name || 'Desconocido'}
> 🎼 *Género:* ${genres ? genres.map(v => v.name).join(', ') : 'Desconocido'}
> 📅 *Fecha de lanzamiento:* ${release_date || 'Desconocido'}

`.trim()

        fs.unlinkSync(`./tmp/${m.sender}.${ext}`)

        m.reply(txt)

        // Agregar reacción de emoji
        try {
            await conn.sendMessage(m.chat, { react: { text: '🎵', key: m.key } })
        } catch (e) {
            console.log('Error al enviar reacción:', e)
        }

    } else {
        m.reply(`> ⚠️ Responde a un *audio o video* con el comando *${command}*`)
        
        // Agregar reacción de error
        try {
            await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
        } catch (e) {
            console.log('Error al enviar reacción:', e)
        }
    }
}

handler.help = ['whatmusic']
handler.tags = ['tools']
handler.command = /^(whatmusic)$/i

export default handler