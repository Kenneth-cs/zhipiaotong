/**
 * 管理员脚本：批量生成兑换码
 * 用法: npx tsx scripts/generate-codes.ts --count=50 --quota=10 --output=batch1.txt
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// 字符集: A-Z0-9 去掉 O I L
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789';

function randomChar(): string {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)];
}

function generateCode(): string {
  const segments = [];
  for (let s = 0; s < 3; s++) {
    let seg = '';
    for (let i = 0; i < 4; i++) {
      seg += randomChar();
    }
    segments.push(seg);
  }
  return `XCQ-${segments.join('-')}`;
}

function parseArgs(): { count: number; quota: number; output: string } {
  const args: Record<string, string> = {};
  process.argv.slice(2).forEach((arg) => {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  });

  return {
    count: parseInt(args.count || '10'),
    quota: parseInt(args.quota || '10'),
    output: args.output || `codes_${Date.now()}.txt`,
  };
}

async function main() {
  const { count, quota, output } = parseArgs();

  console.log(`🎫 开始生成兑换码`);
  console.log(`   数量: ${count}`);
  console.log(`   每张额度: ${quota} 次`);
  console.log(`   输出文件: ${output}`);
  console.log('');

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smart_invoice',
    charset: 'utf8mb4',
  });

  // 生成不重复的兑换码
  const codes: string[] = [];
  const codeSet = new Set<string>();

  while (codes.length < count) {
    const code = generateCode();
    if (!codeSet.has(code)) {
      codeSet.add(code);
      codes.push(code);
    }
  }

  // 批量写入数据库
  const values = codes.map((code) => [code, quota]);
  const placeholders = values.map(() => '(?, ?)').join(', ');
  const flatValues = values.flat();

  try {
    await pool.query(
      `INSERT INTO redeem_codes (code, quota) VALUES ${placeholders}`,
      flatValues
    );

    console.log(`✅ 成功写入 ${codes.length} 条兑换码到数据库`);

    // 输出到文件
    const outputPath = path.resolve(output);
    const content = [
      `# 小财犬兑换码 - 生成于 ${new Date().toLocaleString()}`,
      `# 每张额度: ${quota} 次`,
      `# 总计: ${count} 张`,
      '',
      ...codes,
      '',
    ].join('\n');

    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`📄 兑换码已输出到: ${outputPath}`);
  } catch (err: any) {
    console.error('❌ 写入失败:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();