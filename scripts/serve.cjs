const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../dist/index.html');
if(!fs.existsSync(file))throw new Error('Run node scripts/build.cjs first.');
http.createServer((req,res)=>{
 if(req.url.split('?')[0]!=='/'){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(file));
}).listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log('Final Notice: http://127.0.0.1:'+(process.env.PORT||4173)));
