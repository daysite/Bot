import { promises as fs } from 'fs'

const charactersFilePath = './src/database/characters[1].json'
const haremFilePath = './src/database/harem.json'

const cooldowns = {}

async function loadCharacters() {
    try {
        const data = await fs.readFile(charactersFilePath, 'utf-8')
        return JSON.parse(data)
    } catch (error) {
        throw new Error('> ⓘ \`No se pudo cargar el archivo characters.json\`')
    }
}

async function saveCharacters(characters) {
    try {
        await fs.writeFile(charactersFilePath, JSON.stringify(characters, null, 2), 'utf-8')
    } catch (error) {
        throw new Error('> ⓘ \`No se pudo guardar el archivo characters.json\`')
    }
}

let handler = async (m, { conn }) => {
    const userId = m.sender
    const now = Date.now()

    await m.react('⏳')

    if (cooldowns[userId] && now < cooldowns[userId]) {
        const remainingTime = Math.ceil((cooldowns[userId] - now) / 1000)
        const minutes = Math.floor(remainingTime / 60)
        const seconds = remainingTime % 60
        await conn.reply(m.chat, `> ⓘ \`Debes esperar:\` *${minutes} minutos y ${seconds} segundos*`, m)
        await m.react('❌')
        return
    }

    if (m.quoted && m.quoted.sender === conn.user.jid) {
        try {
            const characters = await loadCharacters()
            
            // PATRÓN CORREGIDO - Busca exactamente "ID: *id*"
            const characterIdMatch = m.quoted.text.match(/ID: \*(.+?)\*/)

            if (!characterIdMatch) {
                await conn.reply(m.chat, '> ⓘ \`No se pudo encontrar el ID del personaje\`', m)
                await m.react('❌')
                return
            }

            const characterId = characterIdMatch[1]
            const character = characters.find(c => c.id === characterId)

            if (!character) {
                await conn.reply(m.chat, '> ⓘ \`El mensaje citado no es un personaje válido\`', m)
                await m.react('❌')
                return
            }

            if (character.user && character.user !== userId) {
                await conn.reply(m.chat, `> ⓘ \`El personaje ya ha sido reclamado por:\` *@${character.user.split('@')[0]}*`, m, { mentions: [character.user] })
                await m.react('❌')
                return
            }

            character.user = userId
            character.status = "Reclamado"

            await saveCharacters(characters)

            await conn.reply(m.chat, `> ⓘ \`Has reclamado a:\` *${character.name}*`, m)
            await m.react('✅')

            cooldowns[userId] = now + 15 * 1000

        } catch (error) {
            await conn.reply(m.chat, `> ⓘ \`Error:\` *${error.message}*`, m)
            await m.react('❌')
        }

    } else {
        await conn.reply(m.chat, '> ⓘ \`Debes citar un personaje válido para reclamar\`', m)
        await m.react('❌')
    }
}

handler.help = ['c']
handler.tags = ['gacha']
handler.command = ['c', 'claim']
handler.group = true

export default handler