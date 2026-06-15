const express = require('express')
const session = require('express-session')
const fetch   = require('node-fetch')
const path    = require('path')
const db      = require('./db')

const CLIENT_ID     = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const ADMIN_ROLE    = process.env.ADMIN_ROLE_ID
const REDIRECT_URI  = 'https://macroforge-bot-production.up.railway.app/callback'
const SESSION_SECRET = process.env.PANEL_SECRET || 'mf_secret_2024'

const router = express.Router()

router.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}))

function requireAuth(req, res, next) {
  if (req.session.user) return next()
  res.redirect('/login')
}

// ── auth routes ────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify+guilds+guilds.members.read`
  res.redirect(url)
})

router.get('/callback', async (req, res) => {
  const code = req.query.code
  if (!code) return res.redirect('/login')
  try {
    // exchange code for token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI
      })
    })
    const token = await tokenRes.json()
    if (!token.access_token) return res.redirect('/login')

    // get user
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    })
    const user = await userRes.json()

    // check if user has admin role in any guild the bot is in
    // Simple approach: check guilds
    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    })
    const guilds = await guildsRes.json()

    // check if user is admin (has MANAGE_GUILD permission = 0x20)
    const isAdmin = guilds.some(g => (parseInt(g.permissions) & 0x20) !== 0)
    if (!isAdmin) return res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:100px">❌ Access Denied — You need Manage Server permission.</h2>')

    req.session.user = { id: user.id, username: user.username, avatar: user.avatar, token: token.access_token }
    res.redirect('/panel')
  } catch(e) {
    console.error('OAuth error:', e.message)
    res.redirect('/login')
  }
})

router.get('/logout', (req, res) => {
  req.session.destroy()
  res.redirect('/login')
})

// ── panel page ─────────────────────────────────────────────────────────────
router.get('/panel', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'panel.html'))
})

router.get('/', (req, res) => {
  if (req.session.user) res.redirect('/panel')
  else res.redirect('/login')
})

// ── API routes ─────────────────────────────────────────────────────────────
router.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user)
})

router.get('/api/stats', requireAuth, async (req, res) => {
  try { res.json(await db.getStats()) }
  catch(e) { res.status(500).json({ error: e.message }) }
})

router.get('/api/keys', requireAuth, async (req, res) => {
  try { res.json(await db.getAllKeys()) }
  catch(e) { res.status(500).json({ error: e.message }) }
})

router.post('/api/genkey', requireAuth, async (req, res) => {
  try {
    const { plan, qty = 1 } = req.body
    const keys = []
    for (let i = 0; i < Math.min(qty, 50); i++) {
      const k = await db.createKey(plan)
      keys.push(k.key)
    }
    res.json({ keys })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

router.post('/api/revoke', requireAuth, async (req, res) => {
  try { await db.revokeKey(req.body.key); res.json({ ok: true }) }
  catch(e) { res.status(500).json({ error: e.message }) }
})

router.post('/api/resethwid', requireAuth, async (req, res) => {
  try { await db.resetHWID(req.body.key); res.json({ ok: true }) }
  catch(e) { res.status(500).json({ error: e.message }) }
})

router.post('/api/config', requireAuth, async (req, res) => {
  try {
    const { guildId, key, val } = req.body
    db.setServerConfig(guildId || 'default', key, val)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

router.get('/api/config/:guildId', requireAuth, async (req, res) => {
  try { res.json(db.getServerConfig(req.params.guildId)) }
  catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
