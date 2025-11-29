import { smsg } from './lib/simple.js'
import { format } from 'util'
import { fileURLToPath } from 'url'
import path, { join } from 'path'
import { unwatchFile, watchFile } from 'fs'
import chalk from 'chalk'
import fetch from 'node-fetch'

if (typeof global.__filename !== 'function') global.__filename = u => fileURLToPath(u)
if (typeof global.__dirname !== 'function') global.__dirname = u => path.dirname(fileURLToPath(u))

const { proto } = (await import('@whiskeysockets/baileys')).default
const isNumber = x => typeof x === 'number' && !isNaN(x)
const delay = ms => isNumber(ms) && new Promise(resolve => setTimeout(function () { clearTimeout(this); resolve() }, ms))

const toNum = v => (v + '').replace(/[^0-9]/g, '')
const localPart = v => (v + '').split('@')[0].split(':')[0].split('/')[0].split(',')[0]
const normalizeCore = v => toNum(localPart(v))
const prettyNum = v => { const n = normalizeCore(v); if (!n) return ''; return `+${n}` }

// Función normalizeJid mejorada
const normalizeJid = v => {
    if (!v) return ''
    if (typeof v === 'number') v = String(v)
    v = (v + '').trim()
    if (v.startsWith('@')) v = v.slice(1)
    if (v.endsWith('@g.us')) return v
    if (v.includes('@s.whatsapp.net')) {
        const n = toNum(v.split('@')[0])
        return n ? n + '@s.whatsapp.net' : v
    }
    if (v.includes('@lid')) {
        return v
    }
    const n = toNum(v)
    return n ? n + '@s.whatsapp.net' : v
}

const cleanJid = jid => jid?.split(':')[0] || ''

function decodeJidCompat(jid = '') { 
    if (!jid) return jid; 
    if (/:[0-9A-Fa-f]+@/.test(jid)) { 
        const [user, server] = jid.split('@'); 
        return user.split(':')[0] + '@' + server 
    } 
    return jid 
}

// Inicialización de la base de datos
if (!global.db) global.db = { data: { users: {}, chats: {}, settings: {}, stats: {} } }
if (!global.db.data) global.db.data = { users: {}, chats: {}, settings: {}, stats: {} }
if (typeof global.loadDatabase !== 'function') global.loadDatabase = async () => {}

// Sistema de caché mejorado para LIDs
if (!global.lidResolver) {
    global.lidResolver = {
        cache: new Map(),
        getUserInfo: function(lidKey) {
            const cached = this.cache.get(lidKey);
            if (cached && (Date.now() - cached.timestamp) < 300000) { // 5 minutos de cache
                return cached;
            }
            return null;
        },
        setUserInfo: function(lidKey, userInfo) {
            this.cache.set(lidKey, { ...userInfo, timestamp: Date.now() });
        },
        clearCache: function() {
            this.cache.clear();
        }
    };
}

function pickOwners() {
  const arr = Array.isArray(global.owner) ? global.owner : []
  const flat = []
  for (const v of arr) {
    if (Array.isArray(v)) flat.push({ num: normalizeCore(v[0]), root: !!v[2] })
    else flat.push({ num: normalizeCore(v), root: false })
  }
  return flat
}

function isOwnerJid(jid) {
  const num = normalizeCore(jid)
  return pickOwners().some(o => o.num === num)
}

function isRootOwnerJid(jid) {
  const num = normalizeCore(jid)
  return pickOwners().some(o => o.num === num && o.root)
}

function isPremiumJid(jid) {
  const num = normalizeCore(jid)
  const prems = Array.isArray(global.prems) ? global.prems.map(normalizeCore) : []
  if (prems.includes(num)) return true
  const u = global.db?.data?.users?.[`${num}@s.whatsapp.net`]
  return !!u?.premium
}

// Función parseUserTargets mejorada
function parseUserTargets(input, options = {}) {
    try {
        if (!input || input.trim() === '') return [];

        const defaults = {
            allowLids: true,
            resolveMentions: true,
            groupJid: null,
            maxTargets: 50
        };
        const opts = { ...defaults, ...options };

        if (Array.isArray(input)) {
            return input.map(jid => normalizeJid(jid)).filter(jid => jid);
        }

        if (typeof input === 'string') {
            let targets = [];

            // Procesar menciones del mensaje actual
            if (opts.resolveMentions && m && m._mentionedJidResolved && m._mentionedJidResolved.length > 0) {
                targets.push(...m._mentionedJidResolved.map(jid => normalizeJid(jid)));
            }

            // Procesar texto para extraer números/JIDs
            const textTargets = input.split(/[,;\s\n]+/).map(item => item.trim()).filter(item => item);

            for (let item of textTargets) {
                if (item.startsWith('@')) {
                    const num = item.substring(1);
                    if (num) {
                        const jid = `${num}@s.whatsapp.net`;
                        targets.push(jid);
                    }
                    continue;
                }

                if (/^[\d+][\d\s\-()]+$/.test(item)) {
                    const cleanNum = item.replace(/[^\d+]/g, '');
                    if (cleanNum.length >= 8) {
                        const jid = `${cleanNum.replace(/^\+/, '')}@s.whatsapp.net`;
                        targets.push(jid);
                    }
                    continue;
                }

                if (item.includes('@')) {
                    targets.push(normalizeJid(item));
                    continue;
                }

                if (/^\d+$/.test(item) && item.length >= 8) {
                    targets.push(`${item}@s.whatsapp.net`);
                }
            }

            targets = [...new Set(targets.map(jid => normalizeJid(jid)).filter(jid => jid))];

            if (opts.maxTargets && targets.length > opts.maxTargets) {
                targets = targets.slice(0, opts.maxTargets);
            }

            return targets;
        }

        return [];
    } catch (error) {
        console.error('Error en parseUserTargets:', error);
        return [];
    }
}

// SISTEMA DE RESOLUCIÓN LIDs MEJORADO
async function resolveLidToRealJid(lidJid, groupChatId, conn, maxRetries = 3) {
    if (!lidJid.endsWith('@lid') || !groupChatId?.endsWith('@g.us')) {
        return lidJid.includes('@') ? lidJid : `${lidJid}@s.whatsapp.net`;
    }

    const lidKey = lidJid.split('@')[0];
    const cached = global.lidResolver.getUserInfo(lidKey);
    if (cached && cached.jid && !cached.jid.endsWith('@lid')) {
        return cached.jid;
    }

    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            const metadata = await conn.groupMetadata(groupChatId);
            if (!metadata?.participants) {
                throw new Error('No se pudieron obtener los participantes del grupo');
            }

            // Buscar en los participantes del grupo
            for (const participant of metadata.participants) {
                if (!participant?.id) continue;
                
                try {
                    // Verificar si este participante tiene el LID que buscamos
                    const contactDetails = await conn.onWhatsApp(participant.id);
                    if (!contactDetails?.[0]?.lid) continue;
                    
                    const participantLid = contactDetails[0].lid;
                    const participantLidKey = participantLid.split('@')[0];
                    
                    if (participantLidKey === lidKey) {
                        // Encontramos la coincidencia
                        global.lidResolver.setUserInfo(lidKey, {
                            jid: participant.id,
                            name: participant.name || participant.notify || '',
                            found: true
                        });
                        return participant.id;
                    }
                } catch (e) {
                    continue;
                }
            }

            // Si llegamos aquí, no encontramos el LID en el grupo
            global.lidResolver.setUserInfo(lidKey, {
                jid: lidJid,
                notFound: true,
                error: 'Usuario no encontrado en el grupo'
            });
            return lidJid;

        } catch (error) {
            attempts++;
            if (attempts >= maxRetries) {
                console.error(`Error resolviendo LID ${lidJid} después de ${maxRetries} intentos:`, error);
                global.lidResolver.setUserInfo(lidKey, {
                    jid: lidJid,
                    error: error.message
                });
                return lidJid;
            }
            await delay(1000 * attempts); // Espera incremental
        }
    }
    
    return lidJid;
}

// SISTEMA DE PRIMARY BOT
async function handlePrimaryBotSystem(m, conn) {
    if (!m.isGroup) return false;

    const chat = global.db.data.chats[m.chat];
    if (!chat?.primaryBot) return false;

    const universalWords = ['resetbot', 'resetprimario', 'botreset', 'setprimary', 'primary', 'unprimary', 'primarybot'];
    const firstWord = m.text ? m.text.trim().split(' ')[0].toLowerCase().replace(/^[./#]/, '') : '';

    if (universalWords.includes(firstWord)) {
        return false;
    }

    if (conn?.user?.jid !== chat.primaryBot) {
        try {
            const groupMetadata = await conn.groupMetadata(m.chat).catch(() => null);
            const primaryBotInGroup = groupMetadata?.participants?.some(p => p.id === chat.primaryBot);

            if (primaryBotInGroup) {
                return true;
            } else {
                chat.primaryBot = null;
                return false;
            }
        } catch (error) {
            console.error('Error verificando primary bot:', error);
            chat.primaryBot = null;
            return false;
        }
    }

    return false;
}

export async function handler(chatUpdate) {
  this.msgqueque = this.msgqueque || []
  if (!chatUpdate) return
  this.__waCache = this.__waCache || new Map()
  this._groupCache = this._groupCache || {}
  
  // Inicialización de métodos de simple.js si no existen
  if (!this.parseMention) {
      this.parseMention = function(text = "") {
          try {
            return (text.match(/@(\d{5,20})/g) || []).map((m) => {
                const num = m.substring(1);
                return `${num}@s.whatsapp.net`;
            });
          } catch (error) {
            console.error("Error en parseMention:", error);
            return [];
          }
      };
  }

  try {
    const botIdKey = this.user?.jid || (this.user?.id ? this.decodeJid(this.user.id) : 'bot')
    global.db.data.settings[botIdKey] = global.db.data.settings[botIdKey] || {}
    if (typeof global.db.data.settings[botIdKey].autotypeDotOnly !== 'boolean') {
      global.db.data.settings[botIdKey].autotypeDotOnly = false
    }
  } catch {}

  if (!this._presenceWrapped) {
    const origPresence = typeof this.sendPresenceUpdate === 'function' ? this.sendPresenceUpdate.bind(this) : null
    this._presenceGates = this._presenceGates || new Map()
    this.sendPresenceUpdate = async (state, jid) => {
      try {
        const allowed = this._presenceGates?.get(jid)
        if (!allowed) return
      } catch {}
      if (typeof origPresence === 'function') return origPresence(state, jid)
    }
    this._presenceWrapped = true
  }

  const resolveToUserJid = async (id) => {
    try {
      let raw = String(id || '')
      if (!raw) return ''
      raw = (typeof this.decodeJid === 'function' ? this.decodeJid(raw) : decodeJidCompat(raw))
      let num = normalizeJid(raw)
      if (!num) return ''
      const cacheKey = `wa:${num}`
      const now = Date.now()
      const cached = this.__waCache.get(cacheKey)
      if (cached && (now - cached.ts) < 60000) return cached.jid
      let base = `${num}@s.whatsapp.net`
      try {
        const wa = await this.onWhatsApp?.(base)
        const pick = Array.isArray(wa) ? wa[0] : null
        if (pick && (pick.jid || pick.exists)) base = pick.jid || base
      } catch {}
      this.__waCache.set(cacheKey, { ts: now, jid: base })
      return base
    } catch { return '' }
  }

  this.pushMessage(chatUpdate.messages).catch(console.error)
  let m = chatUpdate.messages[chatUpdate.messages.length - 1]
  if (!m) return

  if (!global.db) global.db = { data: { users: {}, chats: {}, settings: {}, stats: {} } }
  if (!global.db.data) global.db.data = { users: {}, chats: {}, settings: {}, stats: {} }
  if (global.db.data == null) await global.loadDatabase()
  if (!global.db.data.users) global.db.data.users = {}
  if (!global.db.data.chats) global.db.data.chats = {}
  if (!global.db.data.settings) global.db.data.settings = {}
  if (!global.db.data.stats) global.db.data.stats = {}

  try {
    m = smsg(this, m) || m
    if (!m) return

    // SISTEMA PRIMARY BOT
    const shouldIgnore = await handlePrimaryBotSystem(m, this);
    if (shouldIgnore) return;

    if (!m.isGroup) return
    m.exp = 0
    m.limit = false

    try {
      const numKey = String(m.sender).split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
      let user = global.db.data.users[m.sender]
      if (!user && numKey && global.db.data.users[numKey] && typeof global.db.data.users[numKey] === 'object') {
        global.db.data.users[m.sender] = global.db.data.users[numKey]
        user = global.db.data.users[m.sender]
      }
      if (typeof user !== 'object') global.db.data.users[m.sender] = {}
      if (user) {
        if (!isNumber(user.exp)) user.exp = 0
        if (!isNumber(user.limit)) user.limit = 10
        if (!('premium' in user)) user.premium = false
        if (!user.premium) user.premiumTime = 0
        if (!('registered' in user)) user.registered = false
        if (!user.registered) {
          if (!('name' in user)) user.name = m.name
          if (user.age === undefined) user.age = null
          if (!isNumber(user.regTime)) user.regTime = -1
        }
        if (!isNumber(user.afk)) user.afk = -1
        if (!('afkReason' in user)) user.afkReason = ''
        if (!('banned' in user)) user.banned = false
        if (!('useDocument' in user)) user.useDocument = false
        if (!isNumber(user.level)) user.level = 0
        if (!isNumber(user.bank)) user.bank = 0
  } else global.db.data.users[m.sender] = { exp: 0, limit: 10, registered: false, name: m.name, age: null, regTime: -1, afk: -1, afkReason: '', banned: false, useDocument: true, bank: 0, level: 0 }
      if (numKey && !global.db.data.users[numKey]) global.db.data.users[numKey] = global.db.data.users[m.sender]
      let chat = global.db.data.chats[m.chat]
      if (typeof chat !== 'object') global.db.data.chats[m.chat] = {}
      const cfgDefaults = (global.chatDefaults && typeof global.chatDefaults === 'object') ? global.chatDefaults : {}
      if (chat) {
        for (const [k, v] of Object.entries(cfgDefaults)) { if (!(k in chat)) chat[k] = v }
        if (!('bienvenida' in chat) && ('welcome' in chat)) chat.bienvenida = !!chat.welcome
        if (!('primaryBot' in chat)) chat.primaryBot = null
      } else {
        global.db.data.chats[m.chat] = { ...cfgDefaults }
        if (!('bienvenida' in global.db.data.chats[m.chat]) && ('welcome' in cfgDefaults)) global.db.data.chats[m.chat].bienvenida = !!cfgDefaults.welcome
        global.db.data.chats[m.chat].primaryBot = null
      }
      const botIdKey = this.user?.jid || (this.user?.id ? this.decodeJid(this.user.id) : 'bot')
      var settings = global.db.data.settings[botIdKey]
      if (typeof settings !== 'object') global.db.data.settings[botIdKey] = {}
      if (settings) {
        if (!('self' in settings)) settings.self = false
        if (!('autoread' in settings)) settings.autoread = false
      } else global.db.data.settings[botIdKey] = { self: false, autoread: false, status: 0 }
    } catch (e) { console.error(e) }

    const mainBot = this.user?.jid || global.conn?.user?.jid
    const chatCfg = global.db.data.chats[m.chat] || {}
    const isSubbs = chatCfg.antiLag === true
    const allowedBots = chatCfg.per || []
    if (!allowedBots.includes(mainBot)) allowedBots.push(mainBot)
    const isAllowed = allowedBots.includes(this.user.jid)
    if (isSubbs && !isAllowed) return

    if (opts['nyimak']) return
    if (!m.fromMe && opts['self']) return
    if (opts['swonly'] && m.chat !== 'status@broadcast') return
    if (typeof m.text !== 'string') m.text = ''

    let _user = global.db.data && global.db.data.users && global.db.data.users[m.sender]

    if (m.isGroup) {
      const now = Date.now()
      const maxAge = 30000
      const cached = this._groupCache[m.chat]
      if (!cached || (now - cached.ts) > maxAge || !cached.data || !cached.data.participants) {
        let gm = await this.groupMetadata(m.chat).catch(_ => (cached?.data || {})) || {}
        this._groupCache[m.chat] = { data: gm, ts: now }
      }
    }
    let groupMetadata = m.isGroup ? (this._groupCache[m.chat]?.data || {}) : {}
    const participants = (m.isGroup ? groupMetadata.participants : []) || []
    const participantsNormalized = participants.map(participant => {
      const rawId = participant.id || ''
      const wid = participant.jid || rawId
      return { id: rawId, wid, widNum: normalizeCore(wid), admin: participant.admin ? 'admin' : null, isAdmin: !!participant.admin }
    })

    // SISTEMA DE RESOLUCIÓN DE MENCIONES MEJORADO
    const resolveMentionLids = async () => {
      try {
        const rawMentionList = Array.isArray(m.message?.extendedTextMessage?.contextInfo?.mentionedJid) ? 
            m.message.extendedTextMessage.contextInfo.mentionedJid : 
            (Array.isArray(m.mentionedJid) ? m.mentionedJid : []);
        
        if (rawMentionList.length === 0) {
          m._mentionedJidResolved = [];
          return;
        }

        const hasLids = rawMentionList.some(j => j && j.endsWith('@lid'));
        
        if (!hasLids) {
          // Si no hay LIDs, simplemente normalizar los JIDs
          m._mentionedJidResolved = rawMentionList.map(j => normalizeJid(j)).filter(j => j);
          return;
        }

        // Resolver LIDs
        const resolved = [];
        for (const jid of rawMentionList) {
          if (!jid) continue;
          
          if (jid.endsWith('@lid')) {
            // Resolver LID
            try {
              const realJid = await resolveLidToRealJid(jid, m.chat, this, 2);
              resolved.push(realJid);
            } catch (error) {
              console.error(`Error resolviendo LID ${jid}:`, error);
              resolved.push(jid); // Mantener el LID original si falla
            }
          } else {
            // JID normal
            resolved.push(normalizeJid(jid));
          }
        }

        m._mentionedJidResolved = resolved.filter(j => j);

        // Actualizar el contexto del mensaje si es necesario
        if (m.message?.extendedTextMessage?.contextInfo) {
          m.message.extendedTextMessage.contextInfo.mentionedJid = m._mentionedJidResolved;
        }

      } catch (error) {
        console.error('Error en resolveMentionLids:', error);
        m._mentionedJidResolved = [];
      }
    };

    await resolveMentionLids();

    const nameOf = async (jid) => {
      let n = ''
      try { n = await this.getName(jid) } catch {}
      if (!n) {
        const c = this.contacts?.[jid] || {}
        n = (c.name || c.verifiedName || c.notify || '').trim()
      }
      return n
    }

    const nameOnlyIfExists = async (jid) => {
      const n = (await nameOf(jid)) || ''
      const num = normalizeCore(jid)
      if (!n) return ''
      const stripped = n.replace(/[^0-9]/g, '')
      if (stripped === num) return ''
      return n
    }

    const displayTag = async (jid) => {
      const real = normalizeJid(jid)
      const num = prettyNum(real)
      const n = await nameOnlyIfExists(real)

      if (n && n.trim() !== '' && !/^\+?[0-9\s\-]+$/.test(n)) {
        return n.trim()
      }

      return num
    }

    const getUserInfo = async (jid, options = {}) => {
        try {
            const normalizedJid = normalizeJid(jid);
            if (!normalizedJid) return null;

            const user = global.db.data.users[normalizedJid];
            const name = await nameOf(normalizedJid);
            const roles = await roleFor(normalizedJid);
            const badges = await badgeFor(normalizedJid);

            return {
                jid: normalizedJid,
                name: name || prettyNum(normalizedJid),
                number: prettyNum(normalizedJid),
                exp: user?.exp || 0,
                limit: user?.limit || 0,
                premium: user?.premium || false,
                registered: user?.registered || false,
                banned: user?.banned || false,
                level: user?.level || 0,
                bank: user?.bank || 0,
                ...roles,
                badges,
                displayTag: await displayTag(normalizedJid)
            };
        } catch (error) {
            console.error('Error en getUserInfo:', error);
            return null;
        }
    }

    const senderNum = normalizeCore(m.sender)
    const senderRaw = m.sender
    const botNumsRaw = [this.user.jid].filter(Boolean)
    const botNums = botNumsRaw.map(j => normalizeCore(j))
    let participantUser = m.isGroup ? participantsNormalized.find(p => p.widNum === senderNum || p.wid === senderRaw) : null
    let botParticipant = m.isGroup ? participantsNormalized.find(p => botNums.includes(p.widNum)) : null
    let isAdmin = !!participantUser?.admin
    let isRAdmin = participantUser?.admin === 'superadmin' || false
    let isBotAdmin = !!botParticipant?.admin
    m.isAdmin = isAdmin
    m.isSuperAdmin = isRAdmin
    m.isBotAdmin = isBotAdmin
    m.adminRole = isRAdmin ? 'superadmin' : (isAdmin ? 'admin' : null)

    if (!m.name) {
      const guess = await nameOf(m.sender)
      m.name = guess || prettyNum(m.sender)
    }

    const roleFor = async (jid) => {
      const num = normalizeCore(jid)
      const base = { 
        isOwner: isOwnerJid(num), 
        isROwner: isRootOwnerJid(num), 
        isPrems: isPremiumJid(num), 
        isAdmin: false, 
        isBotAdmin: false 
      }
      if (m.isGroup) {
        const p = participantsNormalized.find(x => x.widNum === num)
        base.isAdmin = !!p?.isAdmin
        const b = participantsNormalized.find(x => botNums.includes(x.widNum))
        base.isBotAdmin = !!b?.isAdmin
      }
      return base
    }

    const badgeFor = async (jid) => {
      const r = await roleFor(jid)
      const b = []
      if (r.isROwner) b.push('CREATOR')
      else if (r.isOwner) b.push('OWNER')
      if (r.isAdmin) b.push('ADMIN')
      if (r.isPrems) b.push('PREMIUM')
      if (botNums.includes(normalizeCore(jid))) b.push('BOT')
      return b
    }

    m.displayTag = await displayTag(m.sender)
    m.badges = await badgeFor(m.sender)
    m.role = await roleFor(m.sender)
    m.renderDisplay = async jid => await displayTag(jid)

    m.exp += Math.ceil(Math.random() * 10)
    let usedPrefix

    const ___dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), './plugins')
    for (let name in global.plugins) {
      let plugin = global.plugins[name]
      if (!plugin) continue
      if (plugin.disabled) continue
      const __filename = join(___dirname, name)
      if (typeof plugin.all === 'function') {
        try {
          await plugin.all.call(this, m, { chatUpdate, __dirname: ___dirname, __filename })
        } catch (e) { console.error(e) }
      }
      if (!opts['restrict']) if (plugin.tags && plugin.tags.includes('admin')) { continue }

      const str2Regex = str => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')

      let _prefix = plugin.customPrefix ? plugin.customPrefix : /^[./!#]/

      let match = (_prefix instanceof RegExp ?
        [[_prefix.exec(m.text), _prefix]] :
        Array.isArray(_prefix) ?
          _prefix.map(p => { let re = p instanceof RegExp ? p : new RegExp('^' + str2Regex(p)); return [re.exec(m.text), re] }) :
          typeof _prefix === 'string' ?
            [[new RegExp('^' + str2Regex(_prefix)).exec(m.text), new RegExp('^' + str2Regex(_prefix))]] :
            [[[], new RegExp]]
      ).find(p => p[1])

      const rolesCtx = await roleFor(m.sender)
      if (typeof plugin.before === 'function') {
        if (await plugin.before.call(this, m, { 
            match, 
            conn: this, 
            participants, 
            groupMetadata, 
            user: participantUser || {}, 
            bot: botParticipant || {}, 
            isROwner: rolesCtx.isROwner, 
            isOwner: rolesCtx.isOwner, 
            isRAdmin, 
            isAdmin, 
            isBotAdmin, 
            isPrems: rolesCtx.isPrems, 
            chatUpdate, 
            __dirname: ___dirname, 
            __filename 
        })) continue
      }
      if (typeof plugin !== 'function') continue
      if ((usedPrefix = (match[0] || '')[0])) {
        let noPrefix = m.text.replace(usedPrefix, '')
        let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
        args = args || []
        let _args = noPrefix.trim().split` `.slice(1)
        let text = _args.join` `
        command = (command || '').toLowerCase()
        let fail = plugin.fail || global.dfail
        let isAccept = plugin.command instanceof RegExp ? plugin.command.test(command) : Array.isArray(plugin.command) ? plugin.command.some(cmd => cmd instanceof RegExp ? cmd.test(command) : cmd === command) : typeof plugin.command === 'string' ? plugin.command === command : false
        if (!isAccept) continue
        m.plugin = name
        if (m.chat in global.db.data.chats || m.sender in global.db.data.users) {
          let chat = global.db.data.chats[m.chat]
          let user = global.db.data.users[m.sender]
          const botIdKey = this.user?.jid || (this.user?.id ? this.decodeJid(this.user.id) : 'bot')
          let setting = global.db.data.settings[botIdKey]
          if (name != 'nable-bot.js' && chat?.isBanned) return
          if (name != 'owner-unbanuser.js' && user?.banned) return
          if (name != 'owner-unbanbot.js' && setting?.banned) return
        }
        if (plugin.rowner && !rolesCtx.isROwner) { fail('rowner', m, this); continue }
        if (plugin.owner && !(rolesCtx.isOwner || rolesCtx.isROwner)) { fail('owner', m, this); continue }
        if (plugin.mods) { fail('mods', m, this); continue }
        if (plugin.premium && !rolesCtx.isPrems) { fail('premium', m, this); continue }
        if (plugin.group && !m.isGroup) { fail('group', m, this); continue }
        else if (plugin.botAdmin && !isBotAdmin) { fail('botAdmin', m, this); continue }
        else if (plugin.admin && !isAdmin) { fail('admin', m, this); continue }
        if (plugin.private && m.isGroup) { fail('private', m, this); continue }
        if (plugin.register == true && _user.registered == false) { fail('unreg', m, this); continue }
        m.isCommand = true
        let xp = 'exp' in plugin ? parseInt(plugin.exp) : 17
        if (xp > 200) m.reply('chirrido -_-')
        else m.exp += xp
        if (plugin.limit && global.db.data.users[m.sender].limit < plugin.limit * 1) { this.reply(m.chat, `Se agotaron tus *Dolares 💲*`, m); continue }
        
        let extra = { 
            match, 
            usedPrefix, 
            noPrefix, 
            _args, 
            args, 
            command, 
            text, 
            conn: this, 
            participants, 
            groupMetadata, 
            user: participantUser || {}, 
            bot: botParticipant || {}, 
            isROwner: rolesCtx.isROwner, 
            isOwner: rolesCtx.isOwner, 
            isRAdmin, 
            isAdmin, 
            isBotAdmin, 
            isPrems: rolesCtx.isPrems, 
            chatUpdate, 
            __dirname: ___dirname, 
            __filename, 
            displayTag: m.displayTag, 
            badges: m.badges, 
            role: m.role, 
            parseUserTargets: (input, opts) => parseUserTargets.call(this, input, { ...opts, m }),
            getUserInfo,
            resolveLidToRealJid: (lidJid) => resolveLidToRealJid(lidJid, m.chat, this),
            serializeM: () => smsg(this, m),
            cMod: this.cMod?.bind(this),
            copyNForward: this.copyNForward?.bind(this),
            downloadM: this.downloadM?.bind(this)
        }
        
        let didPresence = false
        try {
          const botIdKey = this.user?.jid || (this.user?.id ? this.decodeJid(this.user.id) : 'bot')
          const autotypeEnabled = !!global.db?.data?.settings?.[botIdKey]?.autotypeDotOnly
          if (autotypeEnabled && usedPrefix === '.' && typeof this.sendPresenceUpdate === 'function') {
            this._presenceGates.set(m.chat, true)
            didPresence = true
            await this.sendPresenceUpdate('composing', m.chat)
          }
          await plugin.call(this, m, extra)
          m.limit = m.limit || plugin.limit || false
        } catch (e) {
          m.error = e
          console.error(e)
          if (e) {
            let text = format(e)
            for (let key of Object.values(global.APIKeys || {})) text = text.replace(new RegExp(key, 'g'), '#HIDDEN#')
            m.reply(text)
          }
        } finally {
          if (didPresence) {
            try { await this.sendPresenceUpdate('paused', m.chat) } catch {}
            try { this._presenceGates.delete(m.chat) } catch {}
          }
          if (typeof plugin.after === 'function') {
            try { await plugin.after.call(this, m, extra) } catch (e) { console.error(e) }
          }
          if (m.limit) this.reply(m.chat, `Utilizaste *${+m.limit}* Dolares 💲`, m)
        }
        break
      }
    }

  } catch (e) {
    console.error(e)
  } finally {
    if (opts['queque'] && m.text) {
      const quequeIndex = this.msgqueque.indexOf(m.id || m.key.id)
      if (quequeIndex !== -1) this.msgqueque.splice(quequeIndex, 1)
    }
    let user, stats = global.db.data.stats
    if (m) {
      if (m.sender && (user = global.db.data.users[m.sender])) {
        user.exp += m.exp
        user.limit -= m.limit * 1
      }
      let stat
      if (m.plugin) {
        let now = +new Date
        if (m.plugin in stats) {
          stat = stats[m.plugin]
          if (!isNumber(stat.total)) stat.total = 1
          if (!isNumber(stat.success)) stat.success = m.error != null ? 0 : 1
          if (!isNumber(stat.last)) stat.last = now
          if (!isNumber(stat.lastSuccess)) stat.lastSuccess = m.error != null ? 0 : now
        } else stat = stats[m.plugin] = { total: 1, success: m.error != null ? 0 : 1, last: now, lastSuccess: m.error != null ? 0 : now }
        stat.total += 1
        stat.last = now
        if (m.error == null) { stat.success += 1; stat.lastSuccess = now }
      }
    }
    try { if (!opts['noprint']) await (await import('./lib/print.js')).default(m, this) } catch (e) { console.log(m, m.quoted, e) }
    const botIdKey = this.user?.jid || (this.user?.id ? this.decodeJid(this.user.id) : 'bot')
    const settingsREAD = global.db.data.settings[botIdKey] || {}
    if (opts['autoread']) await this.readMessages([m.key])
    if (settingsREAD.autoread) await this.readMessages([m.key])
  }
}

global.dfail = (type, m, conn, usedPrefix) => {
  const ctxDenied = global.rcanalden || {}
  const ctxDev    = global.rcanaldev || {}
  const ctxInfo   = global.rcanalx   || {}
  const cfg = {
    rowner:   { text: '🌸 𝗝𝗮𝗷𝗮𝗷𝗮 𝗲𝘀𝘁𝗲 𝗰𝗼𝗺𝗮𝗻𝗱𝗼 𝘀𝗼𝗹𝗼 𝗽𝘂𝗲𝗱𝗲 𝘂𝘀𝗮𝗿𝗹𝗼 𝗺𝗶 𝗰𝗿𝗲𝗮𝗱𝗼𝗿 😤', ctx: ctxDenied },
    owner:    { text: '🌸 𝗘𝘀𝘁𝗲 𝗰𝗼𝗺𝗮𝗻𝗱𝗼 𝗲𝘀𝘁𝗮́ 𝗿𝗲𝘀𝗲𝗿𝘃𝗮𝗱𝗼 𝗽𝗮𝗿𝗮 𝗺𝗶 𝗰𝗿𝗲𝗮𝗱𝗼𝗿 𝘆 𝗹𝗼𝘀 𝘀𝘂𝗯-𝗯𝗼𝘁𝘀 🙄', ctx: ctxDenied },
    mods:     { text: '🌸 𝗘𝘀𝘁𝗲 𝗰𝗼𝗺𝗮𝗻𝗱𝗼 𝘀𝗼𝗹𝗼 𝗹𝗼 𝗽𝘂𝗲𝗱𝗲𝗻 𝘂𝘀𝗮𝗿 𝗹𝗼𝘀 𝗺𝗼𝗱𝗲𝗿𝗮𝗱𝗼𝗿𝗲𝘀 💢', ctx: ctxDev },
    premium:  { text: '🌸 𝗘𝘀𝘁𝗲 𝗰𝗼𝗺𝗮𝗻𝗱𝗼 𝗲𝘀 𝗲𝘅𝗰𝗹𝘂𝘀𝗶𝘃𝗼 𝗽𝗮𝗿𝗮 𝘂𝘀𝘂𝗮𝗿𝗶𝗼𝘀 𝗽𝗿𝗲𝗺𝗶𝘂𝗺 💖', ctx: ctxDenied },
    group:    { text: '🌸 𝗘𝘀𝘁𝗲 𝗰𝗼𝗺𝗮𝗻𝗱𝗼 𝘀𝗼𝗹𝗼 𝘀𝗲 𝗽𝘂𝗲𝗱𝗲 𝘂𝘀𝗮𝗿 𝗲𝗻 𝗴𝗿𝘂𝗽𝗼𝘀 😡', ctx: ctxInfo },
    private:  { text: '🌸 𝗘𝘀𝘁𝗲 𝗰𝗼𝗺𝗮𝗻𝗱𝗼 𝘀𝗼𝗹𝗼 𝗳𝘂𝗻𝗰𝗶𝗼𝗻𝗮 𝗲𝗻 𝗺𝗶 𝗰𝗵𝗮𝘁 𝗽𝗿𝗶𝘃𝗮𝗱𝗼 😏', ctx: ctxInfo },
    admin:    { text: '🌸 𝗦𝗼𝗹𝗼 𝗹𝗼𝘀 𝗮𝗱𝗺𝗶𝗻𝗶𝘀𝘁𝗿𝗮𝗱𝗼𝗿𝗲𝘀 𝗱𝗲𝗹 𝗴𝗿𝘂𝗽𝗼 𝗽𝘂𝗲𝗱𝗲𝗻 𝘂𝘀𝗮𝗿 𝗲𝘀𝘁𝗼 😤', ctx: ctxDenied },
    botAdmin: { text: '🌸 𝗡𝗲𝗰𝗲𝘀𝗶𝘁𝗼 𝘀𝗲𝗿 𝗮𝗱𝗺𝗶𝗻𝗶𝘀𝘁𝗿𝗮𝗱𝗼𝗿𝗮 𝗽𝗮𝗿𝗮 𝗲𝗷𝗲𝗰𝘂𝘁𝗮𝗿 𝗲𝘀𝘁𝗲 𝗰𝗼𝗺𝗮𝗻𝗱𝗼 🙄', ctx: ctxInfo },
    unreg:    { text: '🌸 𝗡𝗼 𝗲𝘀𝘁𝗮́𝘀 𝗿𝗲𝗴𝗶𝘀𝘁𝗿𝗮𝗱𝗼 𝗮𝘂́𝗻\n\n𝗥𝗲𝗴𝗶́𝘀𝘁𝗿𝗮𝘁𝗲 𝗽𝗿𝗶𝗺𝗲𝗿𝗼 𝗰𝗼𝗻:\n\n.𝗿𝗲𝗴 𝗻𝗼𝗺𝗯𝗿𝗲.𝗲𝗱𝗮𝗱\n\n𝗘𝗷𝗲𝗺𝗽𝗹𝗼: .𝗿𝗲𝗴 𝗜𝘁𝘀𝘂𝗸𝗶.𝟭𝟴\n\n𝗬 𝗻𝗮𝗱𝗮 𝗱𝗲 𝗷𝘂𝗴𝗮𝗿 𝗰𝗼𝗻 𝗹𝗼𝘀 * * 😒', ctx: ctxInfo },
    restrict: { text: '🌸 𝗘𝘀𝘁𝗮 𝗰𝗮𝗿𝗮𝗰𝘁𝗲𝗿𝗶́𝘀𝘁𝗶𝗰𝗮 𝗲𝘀𝘁𝗮́ 𝗱𝗲𝘀𝗵𝗮𝗯𝗶𝗹𝗶𝘁𝗮𝗱𝗮 💢', ctx: ctxInfo },
}[type]
if (!cfg) return
return conn.reply(m.chat, cfg.text, m, cfg.ctx).then(() => m.react('✖️'))
}

let file = global.__filename(import.meta.url, true)
watchFile(file, async () => {
  unwatchFile(file)
  console.log(chalk.magenta("Se actualizo 'handler.js'"))
  if (global.reloadHandler) console.log(await global.reloadHandler())
})