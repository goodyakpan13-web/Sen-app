const express=require('express');
const http=require('http');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const multer=require('multer');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const {Server}=require('socket.io');

const app=express();
const server=http.createServer(app);
const PUBLIC_APP_URL=String(process.env.PUBLIC_APP_URL||process.env.RENDER_EXTERNAL_URL||'').replace(/\/$/,'');
const allowedOrigins=new Set([PUBLIC_APP_URL,'http://localhost','capacitor://localhost','ionic://localhost'].filter(Boolean));
const originAllowedValue=origin=>!origin||!PUBLIC_APP_URL||allowedOrigins.has(origin)||origin.startsWith('http://localhost:')||origin.startsWith('https://localhost:');
const originAllowed=(origin,cb)=>{if(!origin||!PUBLIC_APP_URL||allowedOrigins.has(origin)) return cb(null,true); if(origin.startsWith('http://localhost:')||origin.startsWith('https://localhost:')) return cb(null,true); cb(new Error('CORS origin denied'));};
const io=new Server(server,{cors:{origin:originAllowed,credentials:true}});
const port=Number(process.env.PORT||3000);
const SECRET=process.env.SEN_JWT_SECRET||process.env.JWT_SECRET;
if(!SECRET||SECRET.length<32){console.error('SEN_JWT_SECRET/JWT_SECRET must be set to a strong secret (32+ chars).');process.exit(1)}

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:Number(process.env.DB_POOL_MAX||10),idleTimeoutMillis:30000});
const uploadDir=path.join(__dirname,'uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const videoUpload=multer({storage:multer.diskStorage({destination:uploadDir,filename:(req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:50*1024*1024},fileFilter:(req,file,cb)=>cb(null,Boolean(file.mimetype&&file.mimetype.startsWith('video/')))});

app.use((req,res,next)=>{const origin=req.headers.origin;if(originAllowedValue(origin)){res.setHeader('Access-Control-Allow-Origin',origin||'*');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS')}if(req.method==='OPTIONS')return res.sendStatus(204);next()});
app.use(express.json({limit:'1mb'}));
app.use('/uploads',express.static(uploadDir,{maxAge:'1h'}));
app.use(express.static(path.join(__dirname,'public')));

async function query(text,params=[]){return pool.query(text,params)}
const rateBuckets=new Map();
function rateLimit({windowMs=60_000,max=60,keyFn=req=>req.ip}={}){return (req,res,next)=>{const now=Date.now(),key=keyFn(req);let b=rateBuckets.get(key);if(!b||now-b.start>=windowMs){b={start:now,count:0};rateBuckets.set(key,b)}if(++b.count>max)return res.status(429).json({error:'Too many requests. Please try again shortly.'});next()}}
const authRateLimit=rateLimit({windowMs:60_000,max:20,keyFn:req=>req.ip+'|auth'});
const writeRateLimit=rateLimit({windowMs:60_000,max:120,keyFn:req=>(req.user?.id||req.ip)+'|write'});
async function initDb(){
 await query(`CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS messages(id BIGSERIAL PRIMARY KEY,sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS calls(id BIGSERIAL PRIMARY KEY,caller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS videos(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,caption TEXT NOT NULL DEFAULT '',video_url TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS video_likes(video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(video_id,user_id));
 CREATE TABLE IF NOT EXISTS video_comments(id BIGSERIAL PRIMARY KEY,video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS follows(follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,following_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(follower_id,following_id));
 CREATE TABLE IF NOT EXISTS video_reports(id BIGSERIAL PRIMARY KEY,video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(video_id,user_id));
 CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages(sender_id,receiver_id,id);
 CREATE INDEX IF NOT EXISTS videos_created_idx ON videos(id DESC);
 CREATE INDEX IF NOT EXISTS comments_video_idx ON video_comments(video_id,id DESC);`);
}

const tokenFor=u=>jwt.sign({id:String(u.id),username:u.username,name:u.name},SECRET,{expiresIn:'30d'});
function auth(req,res,next){try{req.user=jwt.verify((req.headers.authorization||'').replace(/^Bearer\s+/i,''),SECRET);next()}catch(e){res.status(401).json({error:'Unauthorized'})}}

app.get('/api/health',async(req,res)=>{try{await query('SELECT 1');res.json({ok:true,service:'SEN',version:'8.1.0',database:'postgresql'})}catch(e){res.status(503).json({ok:false,error:'Database unavailable'})}});
app.get('/api/config',(req,res)=>{const ice=[{urls:process.env.STUN_URL||'stun:stun.l.google.com:19302'}];if(process.env.TURN_URL)ice.push({urls:process.env.TURN_URL,username:process.env.TURN_USERNAME||'',credential:process.env.TURN_PASSWORD||''});res.json({iceServers:ice})});

app.post('/api/signup',authRateLimit,async(req,res)=>{const {name,username,password}=req.body||{};if(!name||!username||!password||password.length<6)return res.status(400).json({error:'Name, username and a 6+ character password are required'});try{const hash=bcrypt.hashSync(password,10);const r=await query('INSERT INTO users(name,username,password) VALUES($1,$2,$3) RETURNING id,name,username',[name.trim(),username.trim().toLowerCase(),hash]);const u=r.rows[0];res.json({token:tokenFor(u),user:{...u,id:String(u.id)}})}catch(e){if(e.code==='23505')return res.status(409).json({error:'Username already exists'});res.status(500).json({error:'Signup failed'})}});
app.post('/api/login',authRateLimit,async(req,res)=>{try{const r=await query('SELECT * FROM users WHERE username=$1',[String(req.body?.username||'').trim().toLowerCase()]);const u=r.rows[0];if(!u||!bcrypt.compareSync(req.body?.password||'',u.password))return res.status(401).json({error:'Invalid username or password'});res.json({token:tokenFor(u),user:{id:String(u.id),name:u.name,username:u.username}})}catch(e){res.status(500).json({error:'Login failed'})}});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/users',auth,async(req,res)=>{const q=`%${String(req.query.q||'').toLowerCase()}%`;const r=await query('SELECT id,name,username FROM users WHERE id<>$1 AND (LOWER(name) LIKE $2 OR LOWER(username) LIKE $2) ORDER BY name LIMIT 50',[req.user.id,q]);res.json({users:r.rows.map(x=>({...x,id:String(x.id)}))})});
app.get('/api/messages/:id',auth,async(req,res)=>{const r=await query('SELECT m.id,m.sender_id,m.receiver_id,m.body,m.created_at,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY m.id',[req.user.id,req.params.id]);res.json({messages:r.rows.map(normalizeMessage)})});
app.post('/api/messages',auth,writeRateLimit,async(req,res)=>{const to=String(req.body?.receiver_id||''),body=String(req.body?.body||'').trim().slice(0,5000);if(!to||!body)return res.status(400).json({error:'Message required'});const recipient=await query('SELECT id FROM users WHERE id=$1',[to]);if(!recipient.rowCount)return res.status(404).json({error:'Recipient not found'});const r=await query('INSERT INTO messages(sender_id,receiver_id,body) VALUES($1,$2,$3) RETURNING id,sender_id,receiver_id,body,created_at',[req.user.id,to,body]);const m=(await query('SELECT m.*,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1',[r.rows[0].id])).rows[0];const msg=normalizeMessage(m);io.to(`user:${to}`).emit('message',msg);res.json({message:msg})});

app.get('/api/videos/feed',auth,async(req,res)=>{const limit=Math.min(Math.max(Number(req.query.limit)||20,1),50);const r=await query(`SELECT v.id,v.caption,v.video_url,v.created_at,u.id user_id,u.name,u.username,(SELECT COUNT(*) FROM video_likes l WHERE l.video_id=v.id) likes,(SELECT COUNT(*) FROM video_comments c WHERE c.video_id=v.id) comments,EXISTS(SELECT 1 FROM video_likes l WHERE l.video_id=v.id AND l.user_id=$1) liked,EXISTS(SELECT 1 FROM follows f WHERE f.following_id=v.user_id AND f.follower_id=$1) following FROM videos v JOIN users u ON u.id=v.user_id ORDER BY v.id DESC LIMIT $2`,[req.user.id,limit]);res.json({videos:r.rows.map(normalizeVideo)})});
app.post('/api/videos',auth,writeRateLimit,videoUpload.single('video'),async(req,res)=>{if(!req.file)return res.status(400).json({error:'A video file is required'});try{const caption=String(req.body?.caption||'').trim().slice(0,220);const r=await query('INSERT INTO videos(user_id,caption,video_url) VALUES($1,$2,$3) RETURNING id',[req.user.id,caption,'/uploads/'+req.file.filename]);const v=(await query(`SELECT v.id,v.caption,v.video_url,v.created_at,u.id user_id,u.name,u.username,0::bigint likes,0::bigint comments,false liked,false following FROM videos v JOIN users u ON u.id=v.user_id WHERE v.id=$1`,[r.rows[0].id])).rows[0];res.json({video:normalizeVideo(v)})}catch(e){try{fs.unlinkSync(path.join(uploadDir,req.file.filename))}catch{}res.status(500).json({error:'Video upload failed'})}});
app.post('/api/videos/:id/report',auth,writeRateLimit,async(req,res)=>{const reason=String(req.body?.reason||'').trim().slice(0,120);if(!reason)return res.status(400).json({error:'Reason required'});try{const v=await query('SELECT 1 FROM videos WHERE id=$1',[req.params.id]);if(!v.rowCount)return res.status(404).json({error:'Video not found'});await query('INSERT INTO video_reports(video_id,user_id,reason) VALUES($1,$2,$3) ON CONFLICT(video_id,user_id) DO NOTHING',[req.params.id,req.user.id,reason]);res.json({reported:true})}catch(e){res.status(500).json({error:'Report failed'})}});
app.delete('/api/videos/:id',auth,async(req,res)=>{const r=await query('SELECT * FROM videos WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);const v=r.rows[0];if(!v)return res.status(404).json({error:'Video not found'});await query('DELETE FROM videos WHERE id=$1',[req.params.id]);const file=path.join(uploadDir,path.basename(v.video_url));if(fs.existsSync(file))fs.unlinkSync(file);res.json({deleted:true})});
app.post('/api/videos/:id/like',auth,writeRateLimit,async(req,res)=>{const existing=await query('SELECT 1 FROM video_likes WHERE video_id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(existing.rowCount)await query('DELETE FROM video_likes WHERE video_id=$1 AND user_id=$2',[req.params.id,req.user.id]);else await query('INSERT INTO video_likes(video_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]);const c=await query('SELECT COUNT(*)::int c FROM video_likes WHERE video_id=$1',[req.params.id]);res.json({liked:!existing.rowCount,likes:c.rows[0].c})});
app.get('/api/videos/:id/comments',auth,async(req,res)=>{const r=await query('SELECT c.id,c.body,c.created_at,u.id user_id,u.name,u.username FROM video_comments c JOIN users u ON u.id=c.user_id WHERE c.video_id=$1 ORDER BY c.id DESC LIMIT 100',[req.params.id]);res.json({comments:r.rows.map(normalizeComment)})});
app.post('/api/videos/:id/comments',auth,writeRateLimit,async(req,res)=>{const body=String(req.body?.body||'').trim().slice(0,500);if(!body)return res.status(400).json({error:'Comment required'});const video=await query('SELECT 1 FROM videos WHERE id=$1',[req.params.id]);if(!video.rowCount)return res.status(404).json({error:'Video not found'});const r=await query('INSERT INTO video_comments(video_id,user_id,body) VALUES($1,$2,$3) RETURNING id',[req.params.id,req.user.id,body]);const c=(await query('SELECT c.id,c.body,c.created_at,u.id user_id,u.name,u.username FROM video_comments c JOIN users u ON u.id=c.user_id WHERE c.id=$1',[r.rows[0].id])).rows[0];res.json({comment:normalizeComment(c)})});
app.post('/api/users/:id/follow',auth,writeRateLimit,async(req,res)=>{if(String(req.params.id)===String(req.user.id))return res.status(400).json({error:'You cannot follow yourself'});const existing=await query('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2',[req.user.id,req.params.id]);if(existing.rowCount)await query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2',[req.user.id,req.params.id]);else await query('INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,req.params.id]);res.json({following:!existing.rowCount})});
app.post('/api/calls',auth,writeRateLimit,async(req,res)=>{const to=String(req.body?.receiver_id||''),kind=req.body?.kind==='video'?'video':'voice';const recipient=await query('SELECT id FROM users WHERE id=$1',[to]);if(!recipient.rowCount)return res.status(404).json({error:'Recipient not found'});const r=await query('INSERT INTO calls(caller_id,receiver_id,kind,status) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,to,kind,'initiated']);const c=normalizeCall(r.rows[0]);io.to(`user:${to}`).emit('incoming-call',c);res.json({call:c})});

const sockets=new Map();
io.use((socket,next)=>{try{socket.user=jwt.verify(socket.handshake.auth.token,SECRET);next()}catch(e){next(new Error('unauthorized'))}});
io.on('connection',s=>{sockets.set(String(s.user.id),s.id);s.join(`user:${s.user.id}`);s.on('typing',d=>{if(d?.to)io.to(`user:${d.to}`).emit('typing',{from:s.user.id})});s.on('call-signal',d=>{if(d?.to)io.to(`user:${d.to}`).emit('call-signal',{from:s.user.id,data:d.data})});s.on('call-hangup',d=>{if(d?.to)io.to(`user:${d.to}`).emit('call-hangup',{from:s.user.id})});s.on('call-state',d=>{if(d?.to)io.to(`user:${d.to}`).emit('call-state',{from:s.user.id,state:d.state})});s.on('disconnect',()=>sockets.delete(String(s.user.id)))});

function normalizeMessage(x){return {...x,id:String(x.id),sender_id:String(x.sender_id),receiver_id:String(x.receiver_id)}}
function normalizeVideo(x){return {...x,id:String(x.id),user_id:String(x.user_id),likes:Number(x.likes||0),comments:Number(x.comments||0),liked:!!x.liked,following:!!x.following}}
function normalizeComment(x){return {...x,id:String(x.id),user_id:String(x.user_id)}}
function normalizeCall(x){return {...x,id:String(x.id),caller_id:String(x.caller_id),receiver_id:String(x.receiver_id)}}

app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

(async()=>{try{await initDb();server.listen(port,()=>console.log(`SEN running on port ${port}`))}catch(e){console.error('Database initialization failed',e);process.exit(1)}})();
