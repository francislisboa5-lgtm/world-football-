const express=require("express");
const path=require("path");
const Database=require("better-sqlite3");
const crypto=require("crypto");

const app=express();
const db=new Database("world-football.db");
app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname,"public")));

db.exec(`
CREATE TABLE IF NOT EXISTS results(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 home TEXT NOT NULL, away TEXT NOT NULL,
 home_score INTEGER NOT NULL, away_score INTEGER NOT NULL,
 competition TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
 match_date TEXT NOT NULL,
 home_logo TEXT NOT NULL DEFAULT '', away_logo TEXT NOT NULL DEFAULT '',
 views INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admins(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL
);
`);

function addColumn(sql){try{db.exec(sql)}catch(e){}}
addColumn("ALTER TABLE results ADD COLUMN country TEXT NOT NULL DEFAULT ''");
addColumn("ALTER TABLE results ADD COLUMN home_logo TEXT NOT NULL DEFAULT ''");
addColumn("ALTER TABLE results ADD COLUMN away_logo TEXT NOT NULL DEFAULT ''");
addColumn("ALTER TABLE results ADD COLUMN views INTEGER NOT NULL DEFAULT 0");

const hash=p=>crypto.createHash("sha256").update(p).digest("hex");
if(!db.prepare("SELECT 1 FROM admins LIMIT 1").get())
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run("admin",hash("TROQUE-ESTA-SENHA"));

const sessions=new Map();
function auth(req,res,next){
  const token=(req.headers.authorization||"").replace("Bearer ","");
  if(!token||!sessions.has(token)) return res.status(401).json({error:"Não autorizado"});
  req.admin=sessions.get(token); next();
}
function clean(v,max=120){return String(v??"").trim().slice(0,max)}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""))}
function score(v){return Number.isInteger(Number(v)) && Number(v)>=0 && Number(v)<=99}

app.get("/api/results",(req,res)=>{
  const {q="",country="",competition="",date=""}=req.query;
  let sql="SELECT id,home,away,home_score,away_score,competition,country,match_date,home_logo,away_logo,views FROM results WHERE status='approved'";
  const p=[];
  if(q){sql+=" AND (LOWER(home) LIKE LOWER(?) OR LOWER(away) LIKE LOWER(?) OR LOWER(competition) LIKE LOWER(?))"; const x="%"+clean(q,80)+"%";p.push(x,x,x)}
  if(country){sql+=" AND country=?";p.push(clean(country,80))}
  if(competition){sql+=" AND competition=?";p.push(clean(competition,100))}
  if(date){sql+=" AND match_date=?";p.push(date)}
  sql+=" ORDER BY match_date DESC,id DESC LIMIT 200";
  res.json(db.prepare(sql).all(...p));
});

app.get("/api/results/:id",(req,res)=>{
  const r=db.prepare("SELECT id,home,away,home_score,away_score,competition,country,match_date,home_logo,away_logo,views FROM results WHERE id=? AND status='approved'").get(req.params.id);
  if(!r)return res.status(404).json({error:"Jogo não encontrado."});
  db.prepare("UPDATE results SET views=views+1 WHERE id=?").run(req.params.id);
  r.views++;
  res.json(r);
});

app.post("/api/results",(req,res)=>{
  const b=req.body||{};
  const home=clean(b.home),away=clean(b.away),competition=clean(b.competition),country=clean(b.country);
  const match_date=clean(b.match_date,10);
  const home_logo=clean(b.home_logo,500),away_logo=clean(b.away_logo,500);
  if(!home||!away||!competition||!country||!validDate(match_date)||!score(b.home_score)||!score(b.away_score))
    return res.status(400).json({error:"Preencha corretamente todos os campos."});
  const info=db.prepare(`INSERT INTO results(home,away,home_score,away_score,competition,country,match_date,home_logo,away_logo)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(home,away,Number(b.home_score),Number(b.away_score),competition,country,match_date,home_logo,away_logo);
  res.status(201).json({id:info.lastInsertRowid,message:"Resultado enviado para aprovação."});
});

app.post("/api/admin/login",(req,res)=>{
  const {username,password}=req.body||{};
  const a=db.prepare("SELECT * FROM admins WHERE username=? AND password_hash=?").get(clean(username,80),hash(password||""));
  if(!a)return res.status(401).json({error:"Utilizador ou senha incorretos."});
  const token=crypto.randomBytes(32).toString("hex");
  sessions.set(token,a.username);
  res.json({token,username:a.username});
});
app.post("/api/admin/logout",auth,(req,res)=>{
  const token=(req.headers.authorization||"").replace("Bearer ","");sessions.delete(token);res.json({ok:true});
});
app.get("/api/admin/pending",auth,(req,res)=>res.json(db.prepare("SELECT * FROM results WHERE status='pending' ORDER BY id DESC").all()));
app.post("/api/admin/:id/approve",auth,(req,res)=>{
  const r=db.prepare("UPDATE results SET status='approved' WHERE id=? AND status='pending'").run(req.params.id);
  res.json({ok:r.changes===1});
});
app.delete("/api/admin/:id",auth,(req,res)=>{
  const r=db.prepare("DELETE FROM results WHERE id=? AND status='pending'").run(req.params.id);
  res.json({ok:r.changes===1});
});
app.get("/api/admin/stats",auth,(req,res)=>{
  const s=db.prepare(`SELECT
    SUM(status='approved') approved,
    SUM(status='pending') pending,
    COALESCE(SUM(views),0) views
    FROM results`).get();
  res.json(s);
});

app.listen(process.env.PORT||3000,()=>console.log("World Football V5 online"));
