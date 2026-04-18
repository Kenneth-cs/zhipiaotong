import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

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
  charset: 'utf8mb4',
});

// 测试连接
pool.getConnection()
  .then((conn) => {
    console.log('✅ MySQL 连接成功 - smart_invoice');
    conn.release();
  })
  .catch((err) => {
    console.error('❌ MySQL 连接失败:', err.message);
  });

export default pool;