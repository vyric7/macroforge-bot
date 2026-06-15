require('dotenv').config()
const https  = require('https')
const crypto = require('crypto')
const fs     = require('fs')

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_KEY

function supabase(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const opts = {
      hostname: URL, path, method,
      headers: { 'apikey':KEY,'Authorization':`Bearer ${KEY}`,'Content-Type':'application/json','Prefer':'return=representation' }
    }
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload)
    const req = https.request(opts, res => {
      let raw = ''
      res.on('data', d => raw += d)
      res.on('end', () => { try { resolve(JSON.parse(raw)) } catch { resolve(raw) } })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// server config
if (!fs.existsSync('./config')) fs.mkdirSync('./config')
const CFG = './config/servers.json'
if (!fs.existsSync(CFG)) fs.writeFileSync(CFG, '{}')
function loadCfg() { try { return JSON.parse(fs.readFileSync(CFG,'utf8')) } catch { return {} } }
function saveCfg(d) { fs.writeFileSync(CFG, JSON.stringify(d,null,2)) }
function getServerConfig(id) { return loadCfg()[id] || {} }
function setServerConfig(id, k, v) { const c=loadCfg(); if(!c[id])c[id]={}; c[id][k]=v; saveCfg(c) }

// key ops
function generateKeyStr() {
  const s = () => crypto.randomBytes(3).toString('hex').toUpperCase()
  return `MF-${s()}-${s()}-${s()}-${s()}`
}
async function createKey(plan) {
  const key = generateKeyStr()
  let expires_at = null
  if (plan === '1day') expires_at = new Date(Date.now()+86400000).toISOString()
  if (plan === '3day') expires_at = new Date(Date.now()+3*86400000).toISOString()
  const res = await supabase('POST', '/rest/v1/license_keys', { key, plan, expires_at, active:true })
  return Array.isArray(res) ? res[0] : res
}
async function getKey(key) {
  const res = await supabase('GET', `/rest/v1/license_keys?key=eq.${encodeURIComponent(key)}&select=*`)
  return Array.isArray(res) ? res[0] : null
}
async function getAllKeys() {
  const res = await supabase('GET', `/rest/v1/license_keys?select=*&order=created_at.desc`)
  return Array.isArray(res) ? res : []
}
async function revokeKey(key) { return supabase('PATCH',`/rest/v1/license_keys?key=eq.${encodeURIComponent(key)}`,{active:false}) }
async function resetHWID(key) { return supabase('PATCH',`/rest/v1/license_keys?key=eq.${encodeURIComponent(key)}`,{hwid:null,activated_at:null}) }
async function getStats() {
  const all = await getAllKeys()
  return { total:all.length, active:all.filter(k=>k.active).length, revoked:all.filter(k=>!k.active).length,
    lifetime:all.filter(k=>k.plan==='lifetime').length, day1:all.filter(k=>k.plan==='1day').length,
    day3:all.filter(k=>k.plan==='3day').length, hwid_bound:all.filter(k=>k.hwid).length }
}

module.exports = { createKey, getKey, getAllKeys, revokeKey, resetHWID, getStats, getServerConfig, setServerConfig }
