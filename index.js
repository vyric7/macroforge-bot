require('dotenv').config()
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const express = require('express')
const http    = require('http')
const db      = require('./db')
const panel   = require('./panel')

const BOT_TOKEN  = process.env.BOT_TOKEN
const CLIENT_ID  = process.env.CLIENT_ID
const CHANNEL_ID = process.env.CHANNEL_ID
const commands   = require('./commands')

// ── express app ────────────────────────────────────────────────────────────
const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(panel)

// notification endpoint (from Macro Forge app)
app.post('/notify', async (req, res) => {
  try {
    const { event, key, hwid, plan, expires_at } = req.body
    const channel = await client.channels.fetch(CHANNEL_ID)
    const planStr = plan === 'lifetime' ? '♾️ Lifetime' : plan === '1day' ? '1 Day' : '3 Days'
    const embed = new EmbedBuilder()
      .setTitle(event === 'activation' ? '🔑 New Key Activation' : event === 'expired' ? '⏰ Key Expired' : '👤 Login')
      .setColor(event === 'activation' ? 0x5865f2 : event === 'expired' ? 0xdc2626 : 0x111111)
      .addFields(
        { name: 'Key',     value: `\`${key}\``,                 inline: false },
        { name: 'Plan',    value: planStr,                       inline: true  },
        { name: 'Expires', value: expires_at ? new Date(expires_at).toLocaleString() : 'Never', inline: true },
        { name: 'HWID',    value: hwid ? `\`${hwid}\`` : 'N/A', inline: false },
      ).setTimestamp().setFooter({ text: 'Macro Forge' })
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`revoke:${key}`).setLabel('🚫 Revoke').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`reset:${key}`).setLabel('🔄 Reset HWID').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`info:${key}`).setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary)
    )
    await channel.send({ embeds: [embed], components: [row] })
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// old POST / endpoint for backwards compat
app.post('/', async (req, res) => {
  req.url = '/notify'
  app.handle(req, res)
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log(`📡 Server on port ${PORT}`))

// ── Discord bot ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ]
})

async function registerCommands() {
  const rest = new REST({ version:'10' }).setToken(BOT_TOKEN)
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.data.toJSON()) })
    console.log('✅ Commands registered')
  } catch(e) { console.error('Register failed:', e.message) }
}

client.once('ready', async () => {
  console.log(`✅ Bot online as ${client.user.tag}`)
  await registerCommands()
})

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    const cmd = commands.find(c => c.data.name === interaction.commandName)
    if (!cmd) return
    try { await cmd.execute(interaction) }
    catch(e) {
      const r = { content: `❌ ${e.message}`, ephemeral: true }
      if (interaction.deferred) await interaction.editReply(r)
      else await interaction.reply(r)
    }
  }

  if (interaction.isButton()) {
    const [action, ...parts] = interaction.customId.split(':')
    const key = parts.join(':')
    await interaction.deferUpdate()
    if (action === 'revoke') {
      await db.revokeKey(key)
      await interaction.editReply({ components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`revoke:${key}`).setLabel('✓ Revoked').setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId(`reset:${key}`).setLabel('Reset HWID').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`info:${key}`).setLabel('Info').setStyle(ButtonStyle.Primary)
      )] })
      await interaction.followUp({ content: `🚫 \`${key}\` revoked.` })
    } else if (action === 'reset') {
      await db.resetHWID(key)
      await interaction.followUp({ content: `🔄 HWID reset for \`${key}\`.` })
    } else if (action === 'info') {
      const row = await db.getKey(key)
      if (!row) { await interaction.followUp({ content: 'Not found.' }); return }
      const plan = row.plan === 'lifetime' ? '♾️ Lifetime' : row.plan === '1day' ? '1 Day' : '3 Days'
      await interaction.followUp({ embeds: [new EmbedBuilder().setTitle('🔍 Key Details')
        .setColor(row.active ? 0x16a34a : 0xdc2626)
        .addFields(
          { name: 'Key',       value: `\`${row.key}\``, inline: false },
          { name: 'Plan',      value: plan,             inline: true  },
          { name: 'Status',    value: row.active ? '✅ Active' : '❌ Revoked', inline: true },
          { name: 'HWID',      value: row.hwid ? `\`${row.hwid}\`` : 'Not bound', inline: false },
          { name: 'Activated', value: row.activated_at ? new Date(row.activated_at).toLocaleString() : 'Never', inline: true },
          { name: 'Expires',   value: row.expires_at   ? new Date(row.expires_at).toLocaleString()   : 'Never', inline: true },
        ).setTimestamp()] })
    }
  }
})

// welcome/goodbye/starboard
client.on('guildMemberAdd', async member => {
  const cfg = db.getServerConfig(member.guild.id)
  if (!cfg.welcome_channel || !cfg.welcome_message) return
  const ch = member.guild.channels.cache.get(cfg.welcome_channel)
  if (ch) ch.send(cfg.welcome_message.replace(/{user}/g,`<@${member.id}>`).replace(/{server}/g,member.guild.name).replace(/{count}/g,member.guild.memberCount))
})
client.on('guildMemberRemove', async member => {
  const cfg = db.getServerConfig(member.guild.id)
  if (!cfg.goodbye_channel || !cfg.goodbye_message) return
  const ch = member.guild.channels.cache.get(cfg.goodbye_channel)
  if (ch) ch.send(cfg.goodbye_message.replace(/{user}/g,member.user.tag).replace(/{server}/g,member.guild.name))
})
const starred = new Set()
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.emoji.name !== '⭐') return
  if (reaction.partial) try { await reaction.fetch() } catch { return }
  const cfg = db.getServerConfig(reaction.message.guild?.id)
  if (!cfg.starboard_channel || reaction.count < (cfg.starboard_stars || 3) || starred.has(reaction.message.id)) return
  starred.add(reaction.message.id)
  const ch = reaction.message.guild.channels.cache.get(cfg.starboard_channel)
  if (!ch) return
  const msg = reaction.message
  const embed = new EmbedBuilder().setColor(0xfbbf24).setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() })
    .setDescription(msg.content || '').addFields({ name: 'Source', value: `[Jump](${msg.url})` }).setTimestamp(msg.createdAt)
  if (msg.attachments.size) embed.setImage(msg.attachments.first().url)
  ch.send({ content: `⭐ **${reaction.count}** in <#${msg.channel.id}>`, embeds: [embed] })
})

client.login(BOT_TOKEN)

// ── prefix message commands ────────────────────────────────────────────────
client.on('messageCreate', async msg => {
  if (msg.author.bot) return
  const cfg    = db.getServerConfig(msg.guildId)
  const prefix = cfg.prefix || '!'
  if (!msg.content.startsWith(prefix)) return

  const args    = msg.content.slice(prefix.length).trim().split(/\s+/)
  const command = args.shift().toLowerCase()

  // check admin role
  const member = msg.member
  if (!member) return
  const isAdmin = member.roles.cache.has(process.env.ADMIN_ROLE_ID) || member.permissions.has(8n)
  if (!isAdmin) return

  if (command === 'genkey') {
    const plan = args[0] || 'lifetime'
    if (!['1day','3day','lifetime'].includes(plan)) return msg.reply('Usage: `!genkey [1day/3day/lifetime]`')
    const k = await db.createKey(plan)
    msg.reply(`✅ Key generated:\n\`\`\`${k.key}\`\`\`Plan: **${plan}**`)
  }
  else if (command === 'revoke') {
    if (!args[0]) return msg.reply('Usage: `!revoke <key>`')
    const row = await db.getKey(args[0])
    if (!row) return msg.reply('❌ Key not found.')
    await db.revokeKey(args[0])
    msg.reply(`✅ Key \`${args[0]}\` revoked.`)
  }
  else if (command === 'resethwid') {
    if (!args[0]) return msg.reply('Usage: `!resethwid <key>`')
    const row = await db.getKey(args[0])
    if (!row) return msg.reply('❌ Key not found.')
    await db.resetHWID(args[0])
    msg.reply(`✅ HWID reset for \`${args[0]}\`.`)
  }
  else if (command === 'lookup') {
    if (!args[0]) return msg.reply('Usage: `!lookup <key>`')
    const row = await db.getKey(args[0])
    if (!row) return msg.reply('❌ Key not found.')
    msg.reply(`🔍 **Key:** \`${row.key}\`\n**Plan:** ${row.plan}\n**Status:** ${row.active?'✅ Active':'❌ Revoked'}\n**HWID:** ${row.hwid||'Not bound'}`)
  }
  else if (command === 'kick') {
    const target = msg.mentions.members.first()
    if (!target) return msg.reply('Usage: `!kick @user [reason]`')
    const reason = args.slice(1).join(' ') || 'No reason'
    await target.kick(reason)
    msg.reply(`✅ Kicked **${target.user.tag}**`)
  }
  else if (command === 'ban') {
    const target = msg.mentions.members.first()
    if (!target) return msg.reply('Usage: `!ban @user [reason]`')
    const reason = args.slice(1).join(' ') || 'No reason'
    await target.ban({ reason })
    msg.reply(`✅ Banned **${target.user.tag}**`)
  }
  else if (command === 'mute') {
    const target = msg.mentions.members.first()
    const mins   = parseInt(args[1]) || 10
    if (!target) return msg.reply('Usage: `!mute @user [minutes]`')
    await target.timeout(mins * 60000)
    msg.reply(`✅ Timed out **${target.user.tag}** for ${mins}min`)
  }
  else if (command === 'unmute') {
    const target = msg.mentions.members.first()
    if (!target) return msg.reply('Usage: `!unmute @user`')
    await target.timeout(null)
    msg.reply(`✅ Timeout removed from **${target.user.tag}**`)
  }
  else if (command === 'purge') {
    const n = Math.min(parseInt(args[0]) || 10, 100)
    const d = await msg.channel.bulkDelete(n, true)
    const reply = await msg.channel.send(`✅ Deleted ${d.size} messages.`)
    setTimeout(() => reply.delete().catch(()=>{}), 3000)
  }
  else if (command === 'lock') {
    await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: false })
    msg.reply('🔒 Channel locked.')
  }
  else if (command === 'unlock') {
    await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: null })
    msg.reply('🔓 Channel unlocked.')
  }
  else if (command === 'help') {
    msg.reply(`**Macro Forge Commands** (prefix: \`${prefix}\`)\n\`\`\`
${prefix}genkey [1day/3day/lifetime]
${prefix}revoke <key>
${prefix}resethwid <key>
${prefix}lookup <key>
${prefix}kick @user [reason]
${prefix}ban @user [reason]
${prefix}mute @user [minutes]
${prefix}unmute @user
${prefix}purge [amount]
${prefix}lock / ${prefix}unlock
\`\`\``)
  }
})
