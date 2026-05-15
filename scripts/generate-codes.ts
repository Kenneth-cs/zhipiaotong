import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smart_invoice',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

function generateCode(): string {
  // 格式: XCQ-XXXX-XXXX-XXXX
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789'; // 移除易混淆的 I, L, O
  const getRandom = (len: number) => {
    let res = '';
    for (let i = 0; i < len; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  };
  return `XCQ-${getRandom(4)}-${getRandom(4)}-${getRandom(4)}`;
}

async function main() {
  const args = process.argv.slice(2);
  let count = 0;
  let quota = 0;
  let output = '';

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      count = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--quota=')) {
      quota = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    }
  }

  if (count <= 0 || quota <= 0) {
    console.error('用法: npx tsx scripts/generate-codes.ts --count=50 --quota=10 [--output=codes.txt]');
    process.exit(1);
  }

  console.log(`准备生成 ${count} 个兑换码，每个面值 ${quota} 次...`);

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateCode());
  }

  try {
    const conn = await pool.getConnection();
    
    // 批量插入
    const values = codes.map(c => [c, quota, 'unused']);
    await conn.query(
      'INSERT INTO redeem_codes (code, quota, status) VALUES ?',
      [values]
    );
    
    conn.release();
    console.log(`✅ 成功将 ${count} 个兑换码写入数据库！`);

    // 写入文件
    const defaultOutput = `codes_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.txt`;
    const fileName = output || defaultOutput;
    const filePath = path.resolve(process.cwd(), fileName);
    
    fs.writeFileSync(filePath, codes.join('\n') + '\n', 'utf-8');
    console.log(`✅ 兑换码已保存至文件: ${filePath}`);

  } catch (err: any) {
    console.error('写入数据库失败:', err.message);
  } finally {
    pool.end();
  }
}

main();
