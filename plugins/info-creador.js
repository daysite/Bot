import { prepareWAMessageMedia, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'

let handler = async (m, { conn }) => {
  try {
    await conn.sendMessage(m.chat, { react: { text: '👑', key: m.key } })

    const menuText = `> *@Hola Soy Daniel Creador De S3x Legal Bot el Bot Que Estas Usando*\n\n> sᴇʟᴇᴄɪᴏɴᴀ ᴜɴ ᴍᴇᴛᴏᴅᴏ ᴘᴀʀᴀ ᴄᴏᴍᴜɴɪᴄᴀʀᴛᴇ ᴄᴏɴᴍɪɢᴏ 🧃:`

    const imageUrl = 'https://files.catbox.moe/n4npwx.jpg'

    const nativeButtons = [
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({ 
          display_text: 'Instagram 📸', 
          url: 'https://www.instagram.com/Danixffx' 
        })
      },
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({ 
          display_text: 'Owner 👑', 
          url: 'https://wa.me/51994154761' 
        })
      },
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({ 
          display_text: 'Grupo ❤️‍🩹', 
          url: 'https://paypal.me/https://chat.whatsapp.com/B5qa7Gkt00F46fejTWifSB?mode=hqrc' 
        })
      }
    ]

    // === Imagen desde URL ===
    const media = await prepareWAMessageMedia({ image: { url: imageUrl } }, { upload: conn.waUploadToServer })
    const header = proto.Message.InteractiveMessage.Header.fromObject({
      hasMediaAttachment: true,
      imageMessage: media.imageMessage
    })

    // === Crear mensaje interactivo ===
    const interactiveMessage = proto.Message.InteractiveMessage.fromObject({
      body: proto.Message.InteractiveMessage.Body.fromObject({ text: menuText }),
      header,
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
        buttons: nativeButtons
      })
    })

    const msg = generateWAMessageFromContent(m.chat, { interactiveMessage }, { userJid: conn.user.jid, quoted: m })
    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })

  } catch (e) {
    console.error('❌ Error en el comando owner:', e)
    await conn.sendMessage(m.chat, {
      text: `❌ *Error al cargar la información del creador*\n\n🔗 Contacta directamente: https://wa.me/573187418668\n\n⚠️ *Error:* ${e.message}`
    }, { quoted: m })
  }
}

handler.help = ['owner', 'creador']
handler.tags = ['info']
handler.command = ['owner', 'creador', 'contacto']

export default handler
