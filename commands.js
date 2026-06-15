const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js')
const db = require('./db')

const ADMIN_ROLE = process.env.ADMIN_ROLE_ID
function isAdmin(member) { return member.roles.cache.has(ADMIN_ROLE) || member.permissions.has(PermissionFlagsBits.Administrator) }
function noPerms(i) { return i.reply({ content: '❌ You do not have permission.', ephemeral: true }) }

module.exports = [
  {
    data: new SlashCommandBuilder().setName('genkey').setDescription('Generate a license key')
      .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
        .addChoices({name:'1 Day',value:'1day'},{name:'3 Days',value:'3day'},{name:'Lifetime',value:'lifetime'}))
      .addIntegerOption(o => o.setName('amount').setDescription('How many (default 1)').setRequired(false).setMinValue(1).setMaxValue(20)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.deferReply({ ephemeral: true })
      const plan = i.options.getString('plan')
      const amt  = i.options.getInteger('amount') || 1
      const keys = []
      for (let x = 0; x < amt; x++) { const k = await db.createKey(plan); keys.push(k.key) }
      const planStr = plan === 'lifetime' ? '♾️ Lifetime' : plan === '1day' ? '1 Day' : '3 Days'
      const embed = new EmbedBuilder().setTitle(`🔑 ${amt} Key(s) Generated`).setColor(0x16a34a)
        .setDescription('```\n' + keys.join('\n') + '\n```')
        .addFields({ name: 'Plan', value: planStr, inline: true }, { name: 'Amount', value: String(amt), inline: true })
        .setTimestamp()
      await i.editReply({ embeds: [embed] })
    }
  },
  {
    data: new SlashCommandBuilder().setName('revoke').setDescription('Revoke a license key')
      .addStringOption(o => o.setName('key').setDescription('Key to revoke').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.deferReply({ ephemeral: true })
      const key = i.options.getString('key')
      const row = await db.getKey(key)
      if (!row) return i.editReply({ content: '❌ Key not found.' })
      await db.revokeKey(key)
      await i.editReply({ content: `✅ Key \`${key}\` revoked.` })
    }
  },
  {
    data: new SlashCommandBuilder().setName('resethwid').setDescription('Reset HWID for a key')
      .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.deferReply({ ephemeral: true })
      const key = i.options.getString('key')
      const row = await db.getKey(key)
      if (!row) return i.editReply({ content: '❌ Key not found.' })
      await db.resetHWID(key)
      await i.editReply({ content: `✅ HWID reset for \`${key}\`.` })
    }
  },
  {
    data: new SlashCommandBuilder().setName('lookup').setDescription('Look up a key')
      .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.deferReply({ ephemeral: true })
      const key = i.options.getString('key')
      const row = await db.getKey(key)
      if (!row) return i.editReply({ content: '❌ Key not found.' })
      const plan = row.plan === 'lifetime' ? '♾️ Lifetime' : row.plan === '1day' ? '1 Day' : '3 Days'
      const embed = new EmbedBuilder().setTitle('🔍 Key Lookup').setColor(row.active ? 0x16a34a : 0xdc2626)
        .addFields(
          { name: 'Key',       value: `\`${row.key}\``, inline: false },
          { name: 'Plan',      value: plan,             inline: true  },
          { name: 'Status',    value: row.active ? '✅ Active' : '❌ Revoked', inline: true },
          { name: 'HWID',      value: row.hwid ? `\`${row.hwid}\`` : 'Not bound', inline: false },
          { name: 'Activated', value: row.activated_at ? new Date(row.activated_at).toLocaleString() : 'Never', inline: true },
          { name: 'Expires',   value: row.expires_at ? new Date(row.expires_at).toLocaleString() : 'Never', inline: true },
        ).setTimestamp()
      const btns = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`revoke:${key}`).setLabel('Revoke').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`reset:${key}`).setLabel('Reset HWID').setStyle(ButtonStyle.Secondary),
      )
      await i.editReply({ embeds: [embed], components: row.active ? [btns] : [] })
    }
  },
  {
    data: new SlashCommandBuilder().setName('listkeys').setDescription('List keys')
      .addStringOption(o => o.setName('filter').setDescription('Filter').setRequired(false)
        .addChoices({name:'All',value:'all'},{name:'Active',value:'active'},{name:'Revoked',value:'revoked'},{name:'Unbound',value:'unbound'})),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.deferReply({ ephemeral: true })
      let keys = await db.getAllKeys()
      const f = i.options.getString('filter') || 'all'
      if (f === 'active')  keys = keys.filter(k => k.active)
      if (f === 'revoked') keys = keys.filter(k => !k.active)
      if (f === 'unbound') keys = keys.filter(k => !k.hwid)
      if (!keys.length) return i.editReply({ content: 'No keys found.' })
      const lines = keys.slice(0,20).map(k => `${k.active?'✅':'❌'} \`${k.key}\` — ${k.plan} ${k.hwid?'🔒':'🔓'}`)
      const embed = new EmbedBuilder().setTitle(`🔑 Keys (${keys.length})`).setColor(0x111111)
        .setDescription(lines.join('\n') + (keys.length > 20 ? `\n...+${keys.length-20} more` : ''))
        .setTimestamp()
      await i.editReply({ embeds: [embed] })
    }
  },
  {
    data: new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const user = i.options.getMember('user')
      const reason = i.options.getString('reason') || 'No reason'
      await user.kick(reason)
      await i.reply({ content: `✅ Kicked **${user.user.tag}**`, ephemeral: true })
      const cfg = db.getServerConfig(i.guildId)
      if (cfg.log_channel) {
        const ch = i.guild.channels.cache.get(cfg.log_channel)
        if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xff9900).setTitle('👢 Kicked')
          .addFields({name:'User',value:user.user.tag,inline:true},{name:'By',value:i.user.tag,inline:true},{name:'Reason',value:reason}).setTimestamp()] })
      }
    }
  },
  {
    data: new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const user = i.options.getMember('user')
      const reason = i.options.getString('reason') || 'No reason'
      await user.ban({ reason })
      await i.reply({ content: `✅ Banned **${user.user.tag}**`, ephemeral: true })
      const cfg = db.getServerConfig(i.guildId)
      if (cfg.log_channel) {
        const ch = i.guild.channels.cache.get(cfg.log_channel)
        if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xdc2626).setTitle('🔨 Banned')
          .addFields({name:'User',value:user.user.tag,inline:true},{name:'By',value:i.user.tag,inline:true},{name:'Reason',value:reason}).setTimestamp()] })
      }
    }
  },
  {
    data: new SlashCommandBuilder().setName('unban').setDescription('Unban a user')
      .addStringOption(o => o.setName('userid').setDescription('User ID').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      try { await i.guild.members.unban(i.options.getString('userid')); await i.reply({ content: `✅ Unbanned`, ephemeral: true }) }
      catch(e) { await i.reply({ content: `❌ ${e.message}`, ephemeral: true }) }
    }
  },
  {
    data: new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const user = i.options.getMember('user')
      const reason = i.options.getString('reason')
      try { await user.send(`⚠️ You were warned in **${i.guild.name}**: ${reason}`) } catch {}
      await i.reply({ content: `✅ Warned **${user.user.tag}**`, ephemeral: true })
    }
  },
  {
    data: new SlashCommandBuilder().setName('mute').setDescription('Timeout a member')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const user = i.options.getMember('user')
      const mins = i.options.getInteger('minutes')
      const reason = i.options.getString('reason') || 'No reason'
      await user.timeout(mins * 60000, reason)
      await i.reply({ content: `✅ Timed out **${user.user.tag}** for ${mins}min`, ephemeral: true })
    }
  },
  {
    data: new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.options.getMember('user').timeout(null)
      await i.reply({ content: `✅ Timeout removed`, ephemeral: true })
    }
  },
  {
    data: new SlashCommandBuilder().setName('purge').setDescription('Delete messages')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1).setMaxValue(100)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const d = await i.channel.bulkDelete(i.options.getInteger('amount'), true)
      await i.reply({ content: `✅ Deleted ${d.size} messages.`, ephemeral: true })
    }
  },
  {
    data: new SlashCommandBuilder().setName('lock').setDescription('Lock channel'),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false })
      await i.reply({ content: '🔒 Channel locked.' })
    }
  },
  {
    data: new SlashCommandBuilder().setName('unlock').setDescription('Unlock channel'),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null })
      await i.reply({ content: '🔓 Channel unlocked.' })
    }
  },
  {
    data: new SlashCommandBuilder().setName('setwelcome').setDescription('Set welcome message')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('message').setDescription('Message ({user} {server} {count})').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const ch = i.options.getChannel('channel')
      const msg = i.options.getString('message')
      db.setServerConfig(i.guildId, 'welcome_channel', ch.id)
      db.setServerConfig(i.guildId, 'welcome_message', msg)
      await i.reply({ content: `✅ Welcome set in ${ch}`, ephemeral: true })
    }
  },
  {
    data: new SlashCommandBuilder().setName('setgoodbye').setDescription('Set goodbye message')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('message').setDescription('Message ({user} {server})').setRequired(true)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const ch = i.options.getChannel('channel')
      const msg = i.options.getString('message')
      db.setServerConfig(i.guildId, 'goodbye_channel', ch.id)
      db.setServerConfig(i.guildId, 'goodbye_message', msg)
      await i.reply({ content: `✅ Goodbye set in ${ch}`, ephemeral: true })
    }
  },
  {
    data: new SlashCommandBuilder().setName('setlogs').setDescription('Set mod log channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const ch = i.options.getChannel('channel')
      db.setServerConfig(i.guildId, 'log_channel', ch.id)
      await i.reply({ content: `✅ Logs set to ${ch}`, ephemeral: true })
    }
  },
  {
    data: new SlashCommandBuilder().setName('setstarboard').setDescription('Set starboard')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addIntegerOption(o => o.setName('stars').setDescription('Stars needed').setRequired(false)),
    async execute(i) {
      if (!isAdmin(i.member)) return noPerms(i)
      const ch = i.options.getChannel('channel')
      const stars = i.options.getInteger('stars') || 3
      db.setServerConfig(i.guildId, 'starboard_channel', ch.id)
      db.setServerConfig(i.guildId, 'starboard_stars', stars)
      await i.reply({ content: `✅ Starboard set to ${ch} — ${stars}⭐ needed`, ephemeral: true })
    }
  },
]
