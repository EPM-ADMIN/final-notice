const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),src=path.join(root,'src'),pkg=require('../package.json');
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw new Error('Use a semantic x.y.z version.');
const read=name=>fs.readFileSync(path.join(src,name),'utf8');
let html=read('index.html'),css=read('style.css');
const img=fs.readFileSync(path.join(src,'art/office.jpg')).toString('base64');
css=css.replace("url('art/office.jpg')",()=>`url('data:image/jpeg;base64,${img}')`);
html=html.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css}</style>`)
 .replace('<script src="engine.js"></script>',()=>`<script>${read('engine.js')}</script>`)
 .replace('<script src="app.js"></script>',()=>`<script>${read('app.js')}</script>`)
 .replace('ORIGINAL PLAYABLE PROTOTYPE / 0.1',`ORIGINAL PLAYABLE PROTOTYPE / ${pkg.version}`);
for(const name of ['dist','docs'])fs.mkdirSync(path.join(root,name),{recursive:true});
fs.writeFileSync(path.join(root,'dist/index.html'),html);
fs.writeFileSync(path.join(root,'docs/index.html'),html);
if(process.argv.includes('--archive')){
 const dir=path.join(root,'docs/versions',`v${pkg.version}`);fs.mkdirSync(dir,{recursive:true});const dest=path.join(dir,'index.html');
 if(fs.existsSync(dest)&&fs.readFileSync(dest,'utf8')!==html)throw new Error(`Refusing to overwrite published v${pkg.version}. Increase package.json version.`);
 fs.writeFileSync(dest,html);
 const indexPath=path.join(root,'docs/versions.json'),entries=fs.existsSync(indexPath)?JSON.parse(fs.readFileSync(indexPath,'utf8')):[];
 const sha256=crypto.createHash('sha256').update(html).digest('hex'),existing=entries.find(x=>x.version===pkg.version);
 if(existing&&existing.sha256!==sha256)throw new Error('Version integrity mismatch; old releases are immutable.');
 if(!existing)entries.unshift({version:pkg.version,date:new Date().toISOString().slice(0,10),sha256,play:`versions/v${pkg.version}/`,release:`https://github.com/EPM-ADMIN/final-notice/releases/tag/v${pkg.version}`,windows:`https://github.com/EPM-ADMIN/final-notice/releases/download/v${pkg.version}/Final-Notice-${pkg.version}-Windows-x64.zip`});
 fs.writeFileSync(indexPath,JSON.stringify(entries,null,2)+'\n');
 const rows=entries.map(v=>`<tr><td><strong>v${v.version}</strong><small>${v.date}</small></td><td><a href="${v.play}">Play this version ↗</a></td><td><a href="${v.windows}">Windows ZIP ↓</a></td><td><a href="${v.release}">Release & source ↗</a></td></tr>`).join('');
 fs.writeFileSync(path.join(root,'docs/versions.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Final Notice — Version archive</title><style>body{margin:0;background:#101710;color:#e1dfc5;font:16px/1.7 'Courier New',monospace}main{max-width:1000px;margin:8vh auto;padding:28px}h1{font:64px/.95 Impact,sans-serif;letter-spacing:1px;margin:25px 0;color:#edbe6c}a{color:#edbe6c;text-underline-offset:5px}p{max-width:700px;color:#acb69e}table{width:100%;border-collapse:collapse;margin:42px 0}th,td{text-align:left;padding:18px 12px;border-bottom:1px solid #77825c55}th{font-size:12px;font-weight:normal;color:#abb493}small{display:block;color:#abb493;font-size:12px}nav{display:flex;gap:25px}footer{font-size:12px;color:#8b987d}@media(max-width:650px){main{margin:20px auto;padding:20px}h1{font-size:50px}table{font-size:13px}th,td{padding:12px 5px}nav{flex-wrap:wrap}}</style><main><small>DEPARTMENT OF UNSETTLED ACCOUNTS</small><h1>FINAL NOTICE.<br>THE ARCHIVE.</h1><p>Every released version has its own browser copy, Windows download, source tag, and release notes.</p><nav><a href="./">Play latest version ↗</a><a href="https://github.com/EPM-ADMIN/final-notice">GitHub repository ↗</a></nav><table><thead><tr><th>VERSION</th><th>BROWSER</th><th>WINDOWS 64-BIT</th><th>HISTORY</th></tr></thead><tbody>${rows}</tbody></table><p>For Windows: download the ZIP, extract the entire folder, then open <strong>Final Notice.exe</strong>. No installation or internet connection is needed after download.</p><footer>FINAL NOTICE / ENDLESSPIXEL MEDIA</footer></main></html>`);
}
console.log(`Built Final Notice v${pkg.version}, ${Buffer.byteLength(html)} bytes.`);
